import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { router, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

import { getSettings, useAppStore } from '@/src/core/store';
import { providerDisplayName, translateCueList } from '@/src/core/translate';
import { Cue, SubtitleMode } from '@/src/core/types';
import {
  fetchCaptionCues,
  getVideoMeta,
  pickCaptionTrack,
} from '@/src/core/youtube/innertube';
import { fontWeightFor, fontFamilyFor, sentenceCues } from '@/src/ui/subtitleStyle';
import { useAppTheme } from '@/src/ui/theme';

const AnyWebView: any = WebView;

const WATCH_UA =
  Platform.OS === 'ios'
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const WATCH_CSS = `
html,body,ytm-app,ytm-app-root,#page-container,#content{background:#000!important;margin:0!important;padding:0!important;overflow:hidden!important;height:100%!important;width:100%!important;}
ytm-header,ytm-header-bar,ytm-app-header,ytm-mobile-topbar-renderer,ytm-nav-bar,ytm-menu,#header,#masthead-container,
#watch7-content,.watch-main-col,
ytm-single-column-watch-next-results-renderer,ytm-watch-metadata,ytm-comments,ytm-comments-entry-point-header-renderer,
ytm-item-section-renderer,#comments,#secondary,#below,#related,#chat,#chat-container,#meta,#info,#owner,#actions,#description,
ytm-clarification-renderer,ytm-merch-shelf-renderer,ytm-donation-shelf-renderer,#ticker,ytm-miniplayer,
#player-control-container,#player-endscreen-container,#player-shorts-container,#player-thumbnail-overlay,#player-cinematics-container,
.app-promo,ytm-app-promo,#app-promo,.ytp-chrome-bottom,.ytp-gradient-bottom,.ytp-caption-window-container,
.ytp-pause-overlay,.ytp-ce-element,.ytp-ad-overlay-container,.ytp-paid-content-overlay,.ytp-share-button,
.ytp-watch-later-button,.ytp-title,.ytp-watermark,.ytp-large-play-button,.ytm-player-controls,.player-controls,
ytm-pivot-bar-renderer,ytm-pivot-bar,ytm-topbar,[class*="pivot-bar"],[class*="topbar"],[id*="watch-next"],[class*="watch-next"]{display:none!important;}
#player-base,#player-container,#player-container-id,#player-container-outer,#player-container-inner,#player,
ytm-player,.html5-video-player{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;
max-width:none!important;max-height:none!important;min-height:0!important;padding:0!important;margin:0!important;z-index:2!important;}
.html5-video-container,video{width:100%!important;height:100%!important;left:0!important;top:0!important;}
video{object-fit:contain!important;background:#000!important;}
`;

function playerBridgeScript() {
  return `
(function(){
  try {
    if (window.__kissBridge && window.__kissBridge.timer) clearInterval(window.__kissBridge.timer);
    if (window.__kissBridge && window.__kissBridge.cssTimer) clearInterval(window.__kissBridge.cssTimer);
    var bridge = window.__kissBridge = { mode: 'mobile-watch' };
    function injectCss(){
      try {
        var old = document.getElementById('kiss-watch-css');
        if (old) return;
        var style = document.createElement('style');
        style.id = 'kiss-watch-css';
        style.textContent = ${JSON.stringify(WATCH_CSS)};
        (document.head || document.documentElement).appendChild(style);
      } catch(e) {}
    }
    injectCss();
    bridge.cssTimer = setInterval(injectCss, 3000);
    function send(payload){
      try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); } catch(e) {}
    }
    function getPlayer(){
      return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    }
    function getVideo(){ return document.querySelector('video'); }
    function setQuality(){
      try {
        var p = getPlayer();
        if (p && p.setPlaybackQualityRange) {
          p.setPlaybackQualityRange('hd1080','hd1080');
          if (p.setPlaybackQuality) p.setPlaybackQuality('hd1080');
        }
      } catch(e) {}
    }
    function report(){
      var v = getVideo();
      var p = getPlayer();
      if (!v) return;
      var quality = '';
      try { quality = p && p.getPlaybackQuality ? p.getPlaybackQuality() : ''; } catch(e) {}
      send({
        type: 'time',
        current: Number(v.currentTime) || 0,
        duration: Number(v.duration) || 0,
        playing: !v.paused && !v.ended,
        ready: v.readyState >= 2,
        rate: v.playbackRate,
        quality: quality
      });
    }
    var bindTries = 0;
    function bind(){
      var v = getVideo();
      if (!v) {
        bindTries++;
        if (bindTries < 14) setTimeout(bind, 700);
        return;
      }
      if (!v.__kissBound) {
        v.__kissBound = true;
        ['timeupdate','play','playing','pause','ended','durationchange','loadedmetadata','seeking','seeked','ratechange'].forEach(function(name){
          v.addEventListener(name, report);
        });
        v.addEventListener('error', function(){
          send({ type:'problem', reason:'video-error', code: v.error ? v.error.code : 0 });
        });
        try { v.playsInline = true; } catch(e) {}
        send({ type:'ready' });
        setQuality();
        var playPromise = null;
        try { playPromise = v.play(); } catch(e) {}
        if (playPromise && playPromise.catch) playPromise.catch(function(){ send({type:'blocked'}); });
        report();
      }
      if (!bridge.timer) {
        bridge.timer = setInterval(report, 900);
        bridge.qualityTimer = setInterval(setQuality, 5000);
      }
      setQuality();
    }
    window.__kiss = {
      play: function(){ var v=getVideo(); try{ var r=v&&v.play(); if(r&&r.catch)r.catch(function(){}); }catch(e){}; return true; },
      pause: function(){ var v=getVideo(); try{ v&&v.pause(); }catch(e){}; return true; },
      seek: function(seconds){ var v=getVideo(); try{ if(v){ v.currentTime=Math.max(0, Number(seconds)||0); } }catch(e){}; return true; },
      rate: function(rate){ var v=getVideo(); try{ if(v)v.playbackRate=Number(rate)||1; }catch(e){}; return true; },
      mute: function(muted){ var v=getVideo(); try{ if(v)v.muted=!!muted; }catch(e){}; return true; },
      quality: function(){ setQuality(); return true; }
    };
    bind();
    document.addEventListener('yt-navigate-finish', function(){ bindTries = 0; setTimeout(bind, 400); }, true);
    setTimeout(function(){
      var v=getVideo();
      var p=getPlayer();
      var state=-1;
      try{ state = p && p.getPlayerState ? p.getPlayerState() : -1; }catch(e){}
      var text='';
      try{ text=(document.body&&document.body.innerText||'').toLowerCase(); }catch(e){}
      var bad = !v || state===5 ||
        text.indexOf('video unavailable')>=0 ||
        text.indexOf('playback on other websites has been disabled')>=0 ||
        text.indexOf('this video is unavailable')>=0 ||
        text.indexOf('error 101')>=0 || text.indexOf('error 150')>=0 || text.indexOf('error 153')>=0;
      if (bad) send({ type:'problem', reason:'unavailable', state: state, text: text.slice(0,160) });
    }, 6500);
  } catch (error) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({type:'problem', reason:'bridge', text:String(error)})); } catch(e) {}
  }
})();
true;
`;
}

function formatTime(value: number) {
  if (!isFinite(value) || value < 0) value = 0;
  const total = Math.floor(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const FONT_STEPS = [14, 16, 18, 20, 22, 24, 26, 30, 34];
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export default function PlayerScreen() {
  const params = useLocalSearchParams<{ videoId?: string; title?: string; author?: string }>();
  const videoId = String(params.videoId ?? '');
  const initialTitle = String(params.title ?? '');
  const initialAuthor = String(params.author ?? '');
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const windowSize = useWindowDimensions();
  const landscape = windowSize.width > windowSize.height;
  const settings = useAppStore((state) => state.settings);
  const patchSettings = useAppStore((state) => state.patchSettings);
  const favorites = useAppStore((state) => state.favorites);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const recordHistory = useAppStore((state) => state.recordHistory);
  const webRef = useRef<any>(null);
  const scrollRef = useRef<any>(null);
  const cueOffsets = useRef<Record<number, number>>({});
  const recordedRef = useRef(false);
  const progressRef = useRef({ current: 0, duration: 0 });

  // A top-level watch page always has a real youtube.com origin. Loading an
  // embed URL directly has no HTTP Referer and YouTube rejects it with Error
  // 153, which was the root cause of the old "video unavailable" screen.
  const [ready, setReady] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const videoLoadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [quality, setQuality] = useState('');
  const [videoProblem, setVideoProblem] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [sheetPanel, setSheetPanel] = useState<
    'main' | 'scroll' | 'sentence' | 'font' | 'fontSize' | 'listening'
  >('main');
  const [fontSizeTarget, setFontSizeTarget] = useState<'portrait' | 'landscape'>('portrait');
  const [controlsVisible, setControlsVisible] = useState(true);
  const [sourceCues, setSourceCues] = useState<Cue[]>([]);
  const [translatedCues, setTranslatedCues] = useState<Cue[] | null>(null);
  const [metaTitle, setMetaTitle] = useState(initialTitle);
  const [metaAuthor, setMetaAuthor] = useState(initialAuthor);
  const [metaChannelId, setMetaChannelId] = useState('');
  const [status, setStatus] = useState('正在读取字幕…');
  const [progressWidth, setProgressWidth] = useState(0);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [trackKey, setTrackKey] = useState('');
  const [toast, setToast] = useState('');
  const [rate, setRate] = useState(1);
  const [loopSentence, setLoopSentence] = useState(false);
  const [muted, setMuted] = useState(false);
  const [blindMode, setBlindMode] = useState(false);
  const [blindReveal, setBlindReveal] = useState(false);
  const [modeMenu, setModeMenu] = useState(false);
  const [providerLabel, setProviderLabel] = useState('');
  const [repeatPass, setRepeatPass] = useState(0);
  const loopGuardRef = useRef(0);
  const blindGuardRef = useRef('');
  const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatBusyRef = useRef(false);
  const transcriptScrollRef = useRef(0);
  const transcriptHeightRef = useRef(0);
  const fontTrackWidthRef = useRef(0);

  const isFavorite = favorites.some((item) => item.videoId === videoId);
  const subtitleMode = settings.subtitle.mode;
  const showTranslation = subtitleMode !== 'original';
  const showOriginal = subtitleMode !== 'translation';
  const fontSize = settings.subtitle.fontSize ?? 20;
  const landscapeFontSize = settings.subtitle.landscapeFontSize ?? 24;
  const hideVideo = settings.subtitle.hideVideo;
  const scrollMode = settings.subtitle.scrollMode;
  const learningLang = settings.learningLang;
  const originalFont = fontFamilyFor(settings.subtitle.originalFont, 'source');
  const translationFont = fontFamilyFor(settings.subtitle.translationFont, 'translation');
  const originalWeight = fontWeightFor(settings.subtitle.originalWeight);
  const translationWeight = fontWeightFor(settings.subtitle.translationWeight);
  const cues = useMemo(
    () => sentenceCues(translatedCues ?? sourceCues, settings.subtitle.sentenceMode),
    [settings.subtitle.sentenceMode, sourceCues, translatedCues]
  );

  const activeIndex = useMemo(() => {
    if (!cues.length) return -1;
    const t = current;
    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i];
      if (cue.start <= t + 0.12 && t <= cue.end + 0.2) return i;
      if (cue.start > t + 0.12) break;
    }
    return -1;
  }, [cues, current]);

  const activeCue = activeIndex >= 0 ? cues[activeIndex] : null;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (sheet) setSheetPanel('main');
  }, [sheet]);

  useEffect(() => {
    if (!settings.keepAwake) {
      void deactivateKeepAwake();
      return;
    }
    activateKeepAwakeAsync('kissly-player').catch(() => {});
    return () => {
      void deactivateKeepAwake();
    };
  }, [settings.keepAwake]);

  useEffect(() => {
    if (!landscape) {
      setControlsVisible(true);
      return;
    }
    if (!controlsVisible || !playing) return;
    const timer = setTimeout(() => setControlsVisible(false), 3800);
    return () => clearTimeout(timer);
  }, [controlsVisible, landscape, playing]);

  useEffect(() => {
    setRepeatPass(0);
    repeatBusyRef.current = false;
    if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
  }, [activeIndex]);

  useEffect(() => {
    return () => {
      if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    const currentSettings = getSettings();
    setStatus('正在读取字幕…');
    const load = async () => {
      try {
        const meta = await getVideoMeta(videoId);
        if (cancelled) return;
        setMetaTitle(meta.title || initialTitle);
        setMetaAuthor(meta.author || initialAuthor);
        setMetaChannelId(meta.channelId ?? '');
        const track = pickCaptionTrack(meta.captionTracks, learningLang.startsWith('en') ? 'en' : learningLang);
        if (!track) {
          setSourceCues([]);
          setStatus('这个视频没有可用英文字幕');
          return;
        }
        setTrackKey(`${track.languageCode}:${track.kind ?? 'manual'}`);
        const fetched = await fetchCaptionCues(track);
        if (cancelled) return;
        setSourceCues(fetched);
        setStatus('正在翻译字幕…');
        try {
          const translated = await translateCueList(
            videoId,
            fetched,
            `${track.languageCode}:${track.kind ?? 'manual'}`,
            { contextTitle: meta.title, from: track.languageCode }
          );
          if (!cancelled) {
            setTranslatedCues(translated.cues);
            setProviderLabel(providerDisplayName(translated.provider));
            setStatus('');
          }
        } catch (error) {
          if (!cancelled) {
            setStatus(`翻译失败：${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(`字幕读取失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [videoId, initialAuthor, initialTitle, learningLang]);

  useEffect(() => {
    if (!videoId) return;
    const persist = () => {
      const state = progressRef.current;
      if (!state.duration) return;
      const previous = useAppStore
        .getState()
        .history.find((entry) => entry.videoId === videoId);
      recordHistory({
        videoId,
        title: metaTitle || initialTitle || videoId,
        author: metaAuthor || initialAuthor,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        savedAt: previous?.savedAt ?? Date.now(),
        progress: Math.max(0, Math.min(1, state.current / state.duration)),
        duration: state.duration,
      });
    };
    const timer = setInterval(persist, 15000);
    return () => {
      clearInterval(timer);
      persist();
    };
  }, [videoId, metaTitle, metaAuthor, initialAuthor, initialTitle, recordHistory]);

  useEffect(() => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    recordHistory({
      videoId,
      title: metaTitle || initialTitle || videoId,
      author: metaAuthor || initialAuthor,
      thumbnail: thumb,
      savedAt: Date.now(),
      progress: 0,
    });
  }, [videoId, metaTitle, metaAuthor, initialAuthor, initialTitle, recordHistory]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const y = cueOffsets.current[activeIndex];
    if (typeof y !== 'number') return;
    if (settings.subtitle.scrollMode === 'top') {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
      return;
    }
    const viewTop = transcriptScrollRef.current;
    const viewHeight = transcriptHeightRef.current;
    const isAbove = y < viewTop + 24;
    const isBelow = y > viewTop + Math.max(80, viewHeight - 130);
    if (isAbove || isBelow) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
    }
  }, [activeIndex, settings.subtitle.scrollMode]);

  useEffect(() => {
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);

  const exitFullscreen = async () => {
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } catch {}
    setFullscreen(false);
    setControlsVisible(true);
  };

  const handleFullscreen = async () => {
    setControlsVisible(true);
    try {
      if (landscape || fullscreen) {
        await exitFullscreen();
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        setFullscreen(true);
      }
    } catch {}
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (modeMenu) {
        setModeMenu(false);
        return true;
      }
      if (sheet) {
        setSheet(false);
        return true;
      }
      if (blindMode) {
        setBlindMode(false);
        return true;
      }
      if (fullscreen || landscape) {
        exitFullscreen();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [blindMode, fullscreen, landscape, modeMenu, sheet]);

  const clearVideoLoadingTimer = () => {
    if (videoLoadingTimer.current) clearTimeout(videoLoadingTimer.current);
    videoLoadingTimer.current = null;
  };

  const armVideoLoadingFallback = () => {
    clearVideoLoadingTimer();
    videoLoadingTimer.current = setTimeout(() => {
      // Never leave a permanent black overlay on top of YouTube. If the page
      // loaded but the player did not report ready (consent, login, error page),
      // reveal the actual web page so the user can see and act on it.
      setVideoLoading(false);
    }, 9000);
  };

  useEffect(() => {
    return () => clearVideoLoadingTimer();
  }, []);

  const send = (script: string) => {
    webRef.current?.injectJavaScript(script);
  };

  const togglePlay = () => {
    if (playing) send('window.__kiss && window.__kiss.pause(); true;');
    else send('window.__kiss && window.__kiss.play(); true;');
    setPlaying(!playing);
    setBlocked(false);
  };

  const seekTo = (seconds: number) => {
    const next = Math.max(0, Math.min(duration || seconds, seconds));
    setCurrent(next);
    send(`window.__kiss && window.__kiss.seek(${next}); true;`);
  };

  const seekFromEvent = (locationX: number) => {
    if (!duration || !progressWidth) return;
    seekTo((locationX / progressWidth) * duration);
  };

  const jumpCue = (direction: -1 | 1) => {
    if (!cues.length) return;
    let index = activeIndex;
    if (index < 0) {
      const next = cues.findIndex((cue) => cue.start > current + 0.05);
      index = next < 0 ? cues.length - 1 : next;
    }
    index = Math.max(0, Math.min(cues.length - 1, index + direction));
    const target = cues[index];
    seekTo(target.start + 0.02);
    loopGuardRef.current = 0;
  };

  const cycleRate = () => {
    const index = SPEEDS.findIndex((speed) => Math.abs(speed - rate) < 0.01);
    const next = SPEEDS[(index + 1) % SPEEDS.length] ?? 1;
    setRate(next);
    send(`window.__kiss && window.__kiss.rate(${next}); true;`);
    setToast(`播放速度 ${next}x`);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    send(`window.__kiss && window.__kiss.mute(${next}); true;`);
  };

  const setSubtitleMode = (mode: SubtitleMode) => {
    patchSettings({ subtitle: { ...settings.subtitle, mode } });
    setModeMenu(false);
  };

  useEffect(() => {
    setBlindReveal(false);
    blindGuardRef.current = '';
  }, [activeIndex]);

  useEffect(() => {
    if (!loopSentence || !activeCue || !playing || blindMode) return;
    if (current <= activeCue.end + 0.08) return;
    if (repeatBusyRef.current) return;
    const repeatCount = Math.max(1, settings.subtitle.repeatCount || 1);
    const pauseMs = Math.max(0, settings.subtitle.repeatInterval || 0) * 1000;
    repeatBusyRef.current = true;
    if (repeatPass + 1 < repeatCount) {
      send('window.__kiss && window.__kiss.pause(); true;');
      repeatTimerRef.current = setTimeout(() => {
        seekTo(activeCue.start + 0.01);
        send('window.__kiss && window.__kiss.play(); true;');
        setPlaying(true);
        setRepeatPass((value) => value + 1);
        repeatBusyRef.current = false;
      }, pauseMs);
      return;
    }
    setRepeatPass(0);
    repeatBusyRef.current = false;
    if (settings.subtitle.autoNext) {
      jumpCue(1);
    } else {
      send('window.__kiss && window.__kiss.pause(); true;');
      setPlaying(false);
    }
  }, [activeCue, blindMode, current, loopSentence, playing, repeatPass, settings.subtitle.autoNext, settings.subtitle.repeatCount, settings.subtitle.repeatInterval]);

  useEffect(() => {
    if (!blindMode || blindReveal || !activeCue || !playing) return;
    if (current <= activeCue.end + 0.12) return;
    if (blindGuardRef.current === activeCue.text) return;
    blindGuardRef.current = activeCue.text;
    if (settings.subtitle.autoNext) {
      jumpCue(1);
    } else {
      send('window.__kiss && window.__kiss.pause(); true;');
      setPlaying(false);
    }
  }, [activeCue, blindMode, blindReveal, current, playing, settings.subtitle.autoNext]);

  const handleMessage = (event: WebViewMessageEvent) => {
    let message: any = null;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'ready') {
      clearVideoLoadingTimer();
      setReady(true);
      setVideoLoading(false);
      setVideoProblem('');
      return;
    }
    if (message.type === 'blocked') {
      setBlocked(true);
      return;
    }
    if (message.type === 'time') {
      if (typeof message.current === 'number') {
        progressRef.current.current = message.current;
        setCurrent(message.current);
      }
      if (typeof message.duration === 'number' && message.duration > 0) {
        progressRef.current.duration = message.duration;
        setDuration(message.duration);
      }
      if (typeof message.playing === 'boolean') setPlaying(message.playing);
      if (message.quality) setQuality(String(message.quality));
      if (message.ready) setReady(true);
      return;
    }
    if (message.type === 'problem') {
      setReady(false);
      setVideoProblem('这个视频限制了站内播放，可能需要登录、年龄验证或作者关闭了外站播放。');
    }
  };

  const retry = () => {
    setVideoProblem('');
    setReady(false);
    setPlaying(false);
    setCurrent(0);
    setVideoLoading(true);
    armVideoLoadingFallback();
    webRef.current?.reload();
  };

  const shareVideo = async () => {
    try {
      await Share.share({
        title: metaTitle,
        message: `https://www.youtube.com/watch?v=${videoId}`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
    } catch {}
  };

  const saveFavorite = () => {
    const added = toggleFavorite({
      videoId,
      title: metaTitle || videoId,
      author: metaAuthor,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      savedAt: Date.now(),
    });
    setToast(added ? '已收藏' : '已取消收藏');
  };

  const exportSubtitlePdf = async () => {
    if (!cues.length) {
      setToast('还没有可导出的字幕');
      return;
    }
    try {
      const escapeHtml = (value: string) =>
        value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      const rows = cues
        .map(
          (cue) => `<section>
            <time>${formatTime(cue.start)} – ${formatTime(cue.end)}</time>
            ${showOriginal ? `<p class="original">${escapeHtml(cue.text)}</p>` : ''}
            ${showTranslation && cue.translation ? `<p class="translation">${escapeHtml(cue.translation)}</p>` : ''}
          </section>`
        )
        .join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"/>
        <style>
          body{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans SC",sans-serif;color:#27251f;margin:34px 40px;line-height:1.55;}
          h1{font-size:22px;margin:0 0 4px;} .meta{color:#7a766a;font-size:12px;margin-bottom:24px;}
          section{page-break-inside:avoid;border-bottom:1px solid #e8e3d8;padding:10px 0;}
          time{display:block;color:#9b968a;font-size:10px;margin-bottom:5px;}
          .original{font-size:15px;font-weight:600;margin:0;} .translation{font-size:13px;color:#4d6658;margin:4px 0 0;}
        </style></head><body>
        <h1>${escapeHtml(metaTitle || 'YouTube 字幕')}</h1>
        <div class="meta">${escapeHtml(metaAuthor || 'YouTube')} · https://youtu.be/${videoId}</div>
        ${rows}
        </body></html>`;
      const result = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          dialogTitle: '导出字幕 PDF',
          UTI: 'com.adobe.pdf',
        });
      } else {
        setToast('文件已生成，但当前设备不支持分享');
      }
    } catch (error) {
      setToast(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const changeFontSize = (direction: 1 | -1, target: 'portrait' | 'landscape') => {
    const value = target === 'portrait' ? fontSize : landscapeFontSize;
    const index = FONT_STEPS.findIndex((size) => size >= value);
    const currentIndex = index < 0 ? FONT_STEPS.length - 1 : index;
    const next = FONT_STEPS[Math.max(0, Math.min(FONT_STEPS.length - 1, currentIndex + direction))];
    patchSettings({
      subtitle: {
        ...settings.subtitle,
        ...(target === 'portrait' ? { fontSize: next } : { landscapeFontSize: next }),
      },
    });
  };

  const toggleTranslation = () => {
    patchSettings({
      subtitle: {
        ...settings.subtitle,
        mode: showTranslation ? 'original' : 'bilingual',
      },
    });
  };

  const displayTitle = metaTitle || initialTitle || 'YouTube';
  const displayAuthor = metaAuthor || initialAuthor;
  const webUrl = `https://m.youtube.com/watch?v=${videoId}&hl=zh-CN&autoplay=1`;

  if (!videoId) {
    return (
      <View style={[styles.center, { backgroundColor: '#08060D' }]}>
        <Text style={styles.errorTitle}>缺少视频参数</Text>
      </View>
    );
  }

  const videoBlock = (
    <View
      key="video-stage"
      style={
        landscape
          ? styles.landscapeVideo
          : hideVideo
            ? styles.videoFrameHidden
            : [styles.videoFrame, { aspectRatio: 16 / 9 }]
      }
    >
      <AnyWebView
        key="watch"
        ref={webRef}
        source={{ uri: webUrl }}
        style={
          hideVideo && !landscape
            ? [
                styles.hiddenWebview,
                {
                  width: windowSize.width,
                  height: Math.round(windowSize.width * 9 / 16),
                },
              ]
            : styles.webview
        }
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo={false}
        setSupportMultipleWindows={false}
        cacheEnabled
        javaScriptCanOpenWindowsAutomatically
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        userAgent={WATCH_UA}
        injectedJavaScript={playerBridgeScript()}
        onMessage={handleMessage}
        onLoadStart={() => {
          setReady(false);
          setVideoLoading(true);
          armVideoLoadingFallback();
        }}
        onLoadEnd={() => {
          send(playerBridgeScript());
          setTimeout(() => send('window.__kiss && window.__kiss.play(); true;'), 1200);
          armVideoLoadingFallback();
        }}
        onError={() => {
          clearVideoLoadingTimer();
          setReady(false);
          setVideoLoading(false);
          setVideoProblem('播放器加载失败，请检查网络后重试，或在浏览器中打开该视频。');
        }}
        onShouldStartLoadWithRequest={(request: any) => {
          const url = String(request.url || '');
          if (
            url.startsWith('about:') ||
            url.startsWith('https://www.youtube.com') ||
            url.startsWith('https://youtube.com') ||
            url.startsWith('https://m.youtube.com') ||
            url.startsWith('https://consent.youtube.com') ||
            url.startsWith('https://accounts.google.com') ||
            url.startsWith('https://www.google.com')
          ) {
            return true;
          }
          Linking.openURL(url).catch(() => {});
          return false;
        }}
      />
      {hideVideo && !landscape ? (
        <Pressable
          onPress={() => patchSettings({ subtitle: { ...settings.subtitle, hideVideo: false } })}
          style={styles.hiddenVideoBanner}
        >
          <Ionicons name="eye-off-outline" size={18} color={theme.colors.textSecondary} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, fontWeight: '700' }}>
            视频已隐藏 · 点击恢复画面
          </Text>
        </Pressable>
      ) : null}
      {videoLoading && !hideVideo ? (
        <View style={styles.videoLoading} pointerEvents="none">
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.videoLoadingText}>
            {'正在连接 YouTube…'}
          </Text>
        </View>
      ) : null}
      {!playing && !landscape && !hideVideo ? (
        <Pressable style={styles.centerPlay} onPress={togglePlay}>
          <Ionicons name="play" size={34} color="#FFFFFF" />
        </Pressable>
      ) : null}
      {!landscape && !hideVideo ? (
        <View style={styles.qualityChip} pointerEvents="none">
          <Text style={styles.qualityChipText}>
            {quality ? quality.toUpperCase() : 'HD1080'} · 优先
          </Text>
        </View>
      ) : null}
      {!landscape && !hideVideo ? (
        <>
          <Pressable
            onPress={toggleTranslation}
            hitSlop={10}
            style={styles.videoTranslate}
          >
            <Ionicons name="language" size={18} color="#FFFFFF" />
          </Pressable>
          <Pressable
            onPress={handleFullscreen}
            hitSlop={10}
            style={styles.videoFullscreen}
          >
            <Ionicons name="expand-outline" size={18} color="#FFFFFF" />
          </Pressable>
        </>
      ) : null}
      {videoProblem && !hideVideo ? (
        <View style={styles.problemOverlay}>
          <Ionicons name="alert-circle-outline" size={30} color="#FCA5A5" />
          <Text style={styles.problemTitle}>YouTube 未能播放这个视频</Text>
          <Text style={styles.problemText}>{videoProblem}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Pressable style={styles.problemButton} onPress={retry}>
              <Text style={styles.problemButtonText}>重试</Text>
            </Pressable>
            <Pressable
              style={[styles.problemButton, styles.problemButtonGhost]}
              onPress={() => router.push('/youtube-account' as any)}
            >
              <Text style={styles.problemButtonText}>登录 YouTube</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );

  const progress = (
    <View
      style={styles.progressTouch}
      onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => seekFromEvent(event.nativeEvent.locationX)}
      onResponderMove={(event) => {
        if (!duration || !progressWidth) return;
        setSeekPreview((event.nativeEvent.locationX / progressWidth) * duration);
      }}
      onResponderRelease={(event) => {
        seekFromEvent(event.nativeEvent.locationX);
        setSeekPreview(null);
      }}
    >
      <View style={[styles.progressRail, { backgroundColor: theme.colors.surfaceAlt }]}>
        <View
          style={[
            styles.progressFill,
            {
              backgroundColor: theme.colors.primary,
              width: duration
                ? Math.max(
                    0,
                    Math.min(
                      progressWidth,
                      ((seekPreview ?? current) / duration) * progressWidth
                    )
                  )
                : 0,
            },
          ]}
        />
      </View>
      <View
        style={[
          styles.progressThumb,
          {
            backgroundColor: theme.colors.primary,
            left: duration
              ? Math.max(
                  0,
                  Math.min(
                    progressWidth,
                    ((seekPreview ?? current) / duration) * progressWidth
                  )
                )
              : 0,
          },
        ]}
      />
    </View>
  );

  const timeRow = (
    <View style={styles.timeRow}>
      <Text style={[styles.timeText, { color: theme.colors.textTertiary }]}>
        {formatTime(seekPreview ?? current)}
      </Text>
      <Text style={[styles.timeText, { color: theme.colors.textTertiary }]}>
        {formatTime(duration)}
      </Text>
    </View>
  );

  const transport = (
    <View style={styles.transport}>
      <Pressable onPress={cycleRate} hitSlop={8} style={styles.ratePill}>
        <Ionicons name="play" size={11} color={theme.colors.primary} />
        <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '800' }}>
          {rate}x
        </Text>
      </Pressable>
      <Pressable onPress={() => jumpCue(-1)} hitSlop={10} style={styles.transportSmall}>
        <Ionicons name="play-back" size={22} color={theme.colors.textSecondary} />
      </Pressable>
      <Pressable
        onPress={togglePlay}
        style={[styles.playButton, { backgroundColor: theme.colors.primary }]}
      >
        <Ionicons name={playing ? 'pause' : 'play'} size={24} color="#FFFFFF" />
      </Pressable>
      <Pressable onPress={() => jumpCue(1)} hitSlop={10} style={styles.transportSmall}>
        <Ionicons name="play-forward" size={22} color={theme.colors.textSecondary} />
      </Pressable>
      <Pressable
        onPress={() => setLoopSentence((value) => !value)}
        hitSlop={8}
        style={[
          styles.loopButton,
          loopSentence && { backgroundColor: theme.colors.primarySoft },
        ]}
      >
        <Ionicons
          name="repeat"
          size={20}
          color={loopSentence ? theme.colors.primary : theme.colors.textTertiary}
        />
      </Pressable>
    </View>
  );

  const controls = !landscape ? (
    <View
      style={[
        styles.controls,
        {
          backgroundColor: theme.colors.playerSurface,
          borderTopColor: theme.colors.border,
          paddingBottom: Math.max(12, insets.bottom),
        },
      ]}
    >
      {progress}
      {timeRow}
      {transport}
      <View style={styles.bottomActions}>
        <Pressable style={styles.action} onPress={() => setModeMenu(true)}>
          <Ionicons
            name={subtitleMode === 'bilingual' ? 'language' : 'text-outline'}
            size={22}
            color={theme.colors.textSecondary}
          />
          <Text style={[styles.actionLabel, { color: theme.colors.textSecondary }]}>字幕</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={saveFavorite}>
          <Ionicons
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={22}
            color={isFavorite ? theme.colors.primary : theme.colors.textSecondary}
          />
          <Text
            style={[
              styles.actionLabel,
              { color: isFavorite ? theme.colors.primary : theme.colors.textSecondary },
            ]}
          >
            收藏
          </Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => setBlindMode((value) => !value)}>
          <Ionicons
            name="headset-outline"
            size={23}
            color={blindMode ? theme.colors.primary : theme.colors.textSecondary}
          />
          <Text
            style={[
              styles.actionLabel,
              { color: blindMode ? theme.colors.primary : theme.colors.textSecondary },
            ]}
          >
            盲听
          </Text>
        </Pressable>
        <Pressable style={styles.action} onPress={handleFullscreen}>
          <Ionicons name="expand-outline" size={23} color={theme.colors.textSecondary} />
          <Text style={[styles.actionLabel, { color: theme.colors.textSecondary }]}>全屏</Text>
        </Pressable>
      </View>
    </View>
  ) : null;

  const landscapeOverlay = landscape ? (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => setControlsVisible((value) => !value)}
      />
      {controlsVisible ? (
        <>
          <View style={[styles.landTop, { paddingTop: Math.max(8, insets.top) }]}>
            <Text style={styles.landTime}>{formatTime(current)}</Text>
            <View
              style={styles.landProgressTouch}
              onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(event) => seekFromEvent(event.nativeEvent.locationX)}
              onResponderMove={(event) => {
                if (!duration || !progressWidth) return;
                setSeekPreview(
                  (event.nativeEvent.locationX / progressWidth) * duration
                );
              }}
              onResponderRelease={(event) => {
                seekFromEvent(event.nativeEvent.locationX);
                setSeekPreview(null);
              }}
            >
              <View style={styles.landProgressRail}>
                <View
                  style={[
                    styles.landProgressFill,
                    {
                      width: duration
                        ? Math.max(
                            0,
                            Math.min(
                              progressWidth,
                              ((seekPreview ?? current) / duration) * progressWidth
                            )
                          )
                        : 0,
                    },
                  ]}
                />
              </View>
            </View>
            <Text style={styles.landTime}>{formatTime(duration)}</Text>
            <Pressable
              onPress={() => setModeMenu(true)}
              style={[styles.landIconButton, subtitleMode !== 'original' && styles.landIconActive]}
            >
              <Text style={styles.landCc}>CC</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                setSubtitleMode(subtitleMode === 'original' ? 'bilingual' : 'original')
              }
              style={[styles.landIconButton, subtitleMode !== 'original' && styles.landIconActive]}
            >
              <Ionicons name="language" size={20} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={toggleMute} style={styles.landIconButton}>
              <Ionicons
                name={muted ? 'volume-mute' : 'volume-high'}
                size={20}
                color="#FFFFFF"
              />
            </Pressable>
            <Pressable onPress={() => setSheet(true)} style={styles.landIconButton}>
              <Ionicons name="ellipsis-horizontal" size={21} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={exitFullscreen} style={styles.landIconButton}>
              <Ionicons name="contract-outline" size={20} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={styles.landCenter}>
            <Pressable onPress={cycleRate} style={styles.landRatePill}>
              <Text style={styles.landRateText}>{rate}x</Text>
            </Pressable>
            <Pressable onPress={() => jumpCue(-1)} style={styles.landTransportButton}>
              <Ionicons name="play-back" size={28} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={togglePlay} style={styles.landPlay}>
              <Ionicons name={playing ? 'pause' : 'play'} size={30} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={() => jumpCue(1)} style={styles.landTransportButton}>
              <Ionicons name="play-forward" size={28} color="#FFFFFF" />
            </Pressable>
            <Pressable
              onPress={() => setLoopSentence((value) => !value)}
              style={[styles.landRatePill, loopSentence && styles.landLoopActive]}
            >
              <Ionicons name="repeat" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </>
      ) : null}

      {activeCue ? (
        <View
          style={[
            styles.landSubBox,
            {
              bottom: controlsVisible ? Math.max(28, insets.bottom + 18) : Math.max(20, insets.bottom + 12),
              backgroundColor: controlsVisible ? 'rgba(16,13,24,0.6)' : 'rgba(0,0,0,0.28)',
            },
          ]}
          pointerEvents="none"
        >
          {showOriginal ? (
            <Text
              style={[
                styles.landSubOriginal,
                {
                  fontSize: landscapeFontSize,
                  fontFamily: originalFont,
                  fontWeight: originalWeight,
                },
              ]}
              numberOfLines={2}
            >
              {activeCue.text}
            </Text>
          ) : null}
          {showTranslation && activeCue.translation ? (
            <Text
              style={[
                styles.landSubTranslation,
                {
                  fontSize: Math.max(13, landscapeFontSize - 5),
                  fontFamily: translationFont,
                  fontWeight: translationWeight,
                },
              ]}
              numberOfLines={2}
            >
              {activeCue.translation}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  ) : null;

  const transcript = (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18 }}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(event) => {
        transcriptScrollRef.current = event.nativeEvent.contentOffset.y;
      }}
      onLayout={(event) => {
        transcriptHeightRef.current = event.nativeEvent.layout.height;
      }}
    >
      {cues.length === 0 ? (
        <View style={styles.emptyTranscript}>
          <Ionicons name="document-text-outline" size={34} color={theme.colors.textTertiary} />
          <Text style={[styles.emptyTranscriptText, { color: theme.colors.textSecondary }]}>
            {status || '这个视频还没有可用字幕'}
          </Text>
        </View>
      ) : (
        cues.map((cue, index) => {
          const active = index === activeIndex;
          const past = index < activeIndex;
          return (
            <Pressable
              key={`${cue.start}-${index}`}
              onLayout={(event) => {
                cueOffsets.current[index] = event.nativeEvent.layout.y;
              }}
              onPress={() => seekTo(cue.start)}
              style={[
                styles.cue,
                active && { backgroundColor: theme.colors.primarySoft },
                past && { opacity: 0.5 },
              ]}
            >
              {showOriginal ? (
                <Text
                  style={[
                    styles.cueOriginal,
                    {
                      color: theme.colors.textSecondary,
                      fontSize: Math.max(14, fontSize),
                      fontFamily: originalFont,
                      fontWeight: originalWeight,
                    },
                    active && { color: theme.colors.primary, fontWeight: '800' },
                    past && { color: theme.colors.textTertiary },
                  ]}
                >
                  {cue.text}
                </Text>
              ) : null}
              {showTranslation && cue.translation ? (
                <Text
                  style={[
                    styles.cueTranslation,
                    {
                      color: showOriginal ? theme.colors.textTertiary : theme.colors.textSecondary,
                      fontSize: Math.max(12, fontSize - (showOriginal ? 3 : 0)),
                      fontFamily: translationFont,
                      fontWeight: translationWeight,
                    },
                    active && { color: showOriginal ? theme.colors.text : theme.colors.primary },
                  ]}
                >
                  {cue.translation}
                </Text>
              ) : null}
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );

  const nowCard = activeCue ? (
    <View
      style={[
        styles.nowCard,
        { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="time-outline" size={14} color={theme.colors.textTertiary} />
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
            {formatTime(activeCue.start)}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {providerLabel ? (
            <Text style={{ color: theme.colors.textTertiary, fontSize: 10 }}>
              译 · {providerLabel}
            </Text>
          ) : null}
          <Pressable onPress={() => setSheet(true)} hitSlop={8}>
            <Ionicons name="sparkles-outline" size={20} color={theme.colors.textSecondary} />
          </Pressable>
          <Pressable onPress={saveFavorite} hitSlop={8}>
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={20}
              color={isFavorite ? theme.colors.primary : theme.colors.textSecondary}
            />
          </Pressable>
        </View>
      </View>
      {showOriginal ? (
        <Text
          style={{
            color: theme.colors.primary,
            fontSize: Math.min(30, fontSize + 2),
            lineHeight: Math.min(38, fontSize + 9),
            fontWeight: '800',
            fontFamily: originalFont,
            marginTop: 8,
            letterSpacing: -0.2,
          }}
        >
          {activeCue.text}
        </Text>
      ) : null}
      {showTranslation && activeCue.translation ? (
        <Text
          style={{
            color: showOriginal ? theme.colors.text : theme.colors.primary,
            fontSize: showOriginal ? Math.max(14, fontSize) : Math.min(28, fontSize + 2),
            lineHeight: showOriginal ? Math.max(22, fontSize + 7) : Math.min(36, fontSize + 9),
            fontWeight: showOriginal ? translationWeight : '800',
            fontFamily: translationFont,
            marginTop: 6,
          }}
        >
          {activeCue.translation}
        </Text>
      ) : null}
    </View>
  ) : null;

  const blindCard = (
    <View style={{ flex: 1, paddingHorizontal: 18, paddingTop: 8 }}>
      <View
        style={{
          backgroundColor: theme.colors.card,
          borderRadius: 18,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: 18,
          minHeight: 210,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Ionicons name="time-outline" size={15} color={theme.colors.textSecondary} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
            {formatTime(activeCue?.start ?? current)}
          </Text>
          <View style={{ flex: 1 }} />
          <View
            style={{
              backgroundColor: theme.colors.primary,
              borderRadius: 999,
              paddingHorizontal: 11,
              paddingVertical: 4,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>
              盲听 {Math.max(1, activeIndex + 1)}/{Math.max(1, cues.length)}
            </Text>
          </View>
        </View>

        {blindReveal ? (
          <View style={{ marginTop: 18 }}>
            {activeCue ? (
              <>
                {showOriginal ? (
                  <Text
                    style={{
                      color: theme.colors.primary,
                      fontSize: 21,
                      lineHeight: 29,
                      fontWeight: '800',
                    }}
                  >
                    {activeCue.text}
                  </Text>
                ) : null}
                {showTranslation && activeCue.translation ? (
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: 17,
                      lineHeight: 25,
                      marginTop: 8,
                    }}
                  >
                    {activeCue.translation}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={{ color: theme.colors.textTertiary, fontSize: 14 }}>
                播放到有字幕的位置后会自动出现。
              </Text>
            )}
          </View>
        ) : (
          <View style={{ marginTop: 20, gap: 10 }}>
            {[92, 78, 54].map((width, index) => (
              <View
                key={width}
                style={{
                  height: 12,
                  width: `${width}%` as any,
                  borderRadius: 6,
                  backgroundColor: theme.colors.surfaceAlt,
                  opacity: 1 - index * 0.18,
                }}
              />
            ))}
          </View>
        )}

        <Pressable
          onPress={() => setBlindReveal((value) => !value)}
          style={{ marginTop: 26, alignSelf: 'flex-start' }}
        >
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5 }}>
            {blindReveal ? '轻点隐藏原文' : '轻点显示原文'}
          </Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 14 }}>
        <Pressable
          onPress={() => setBlindMode(false)}
          style={{
            paddingHorizontal: 15,
            height: 34,
            borderRadius: 17,
            backgroundColor: theme.colors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>退出盲听</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: landscape ? '#000000' : theme.colors.playerBg },
      ]}
    >
      <StatusBar hidden={landscape} style={landscape || theme.dark ? 'light' : 'dark'} />

      <View
        style={[
          styles.header,
          { paddingTop: Math.max(8, insets.top) },
          landscape && { display: 'none' },
        ]}
      >
        <Pressable style={styles.headerPlain} onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={23} color={theme.colors.text} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 6 }}>
          <Text
            style={[styles.headerTitle, { color: theme.colors.text }]}
            numberOfLines={1}
          >
            {displayTitle}
          </Text>
          {displayAuthor ? (
            <Text
              style={[styles.headerSubtitle, { color: theme.colors.textTertiary }]}
              numberOfLines={1}
            >
              {displayAuthor}
            </Text>
          ) : null}
        </View>
        <Pressable style={styles.headerPlain} onPress={() => setSheet(true)} hitSlop={10}>
          <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.text} />
        </Pressable>
      </View>

      {videoBlock}

      {!landscape ? (
        <View style={{ flex: 1 }}>
          {blindMode ? (
            blindCard
          ) : (
            <>
              {nowCard}
              <View style={styles.transcriptHeader}>
                <Text style={[styles.transcriptTitle, { color: theme.colors.text }]}>
                  字幕稿
                </Text>
                {status ? (
                  <View style={styles.statusRow}>
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                    <Text
                      style={[styles.statusText, { color: theme.colors.textTertiary }]}
                      numberOfLines={1}
                    >
                      {status}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.statusText, { color: theme.colors.textTertiary }]}>
                    点句子可跳转
                  </Text>
                )}
              </View>
              {transcript}
            </>
          )}
          {controls}
        </View>
      ) : (
        <>
          {landscapeOverlay}
        </>
      )}

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {modeMenu ? modeMenuOverlay() : null}
      {sheet ? sheetOverlay() : null}
    </View>
  );

  function modeMenuOverlay() {
    const options: Array<{ id: SubtitleMode; label: string; desc: string }> = [
      { id: 'original', label: '原文字幕', desc: '只显示视频原语言' },
      { id: 'translation', label: '翻译字幕', desc: '只显示中文翻译' },
      { id: 'bilingual', label: '双语字幕', desc: '原文 + 翻译' },
    ];
    return (
      <View style={styles.modeMask}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setModeMenu(false)} />
        <View style={[styles.modeCard, { backgroundColor: theme.colors.card }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '800' }}>
              字幕显示
            </Text>
            <Pressable onPress={() => setModeMenu(false)} hitSlop={8}>
              <Ionicons name="close" size={20} color={theme.colors.textTertiary} />
            </Pressable>
          </View>
          {options.map((option) => {
            const active = subtitleMode === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => setSubtitleMode(option.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 12,
                  gap: 10,
                  borderBottomWidth:
                    option.id === 'bilingual' ? 0 : StyleSheet.hairlineWidth,
                  borderBottomColor: theme.colors.border,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 14.5, fontWeight: '700' }}>
                    {option.label}
                  </Text>
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}>
                    {option.desc}
                  </Text>
                </View>
                {active ? (
                  <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} />
                ) : (
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      borderWidth: 1.4,
                      borderColor: theme.colors.borderStrong,
                    }}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  function sheetOverlay() {
    const titles: Record<typeof sheetPanel, string> = {
      main: '更多设置',
      scroll: '字幕滚动',
      sentence: '断句模式',
      font: '字体',
      fontSize: '字体大小',
      listening: '精听设置',
    };
    return (
      <View style={styles.sheetMask} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheet(false)} />
        <View
          style={[
            styles.sheetCard,
            { backgroundColor: theme.colors.card },
            landscape
              ? {
                  alignSelf: 'flex-end',
                  width: Math.min(460, Math.round(windowSize.width * 0.46)),
                  height: '100%',
                  borderTopLeftRadius: 24,
                  borderTopRightRadius: 0,
                  borderBottomLeftRadius: 24,
                  paddingTop: Math.max(12, insets.top),
                  paddingBottom: Math.max(16, insets.bottom),
                }
              : {
                  maxHeight: '88%',
                  paddingBottom: Math.max(24, insets.bottom),
                },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Pressable
              onPress={() => {
                if (sheetPanel === 'main') setSheet(false);
                else setSheetPanel('main');
              }}
              style={[styles.sheetHeaderButton, { backgroundColor: theme.colors.surfaceAlt }]}
            >
              <Ionicons
                name={sheetPanel === 'main' ? 'close' : 'arrow-back'}
                size={20}
                color={theme.colors.text}
              />
            </Pressable>
            <Text style={[styles.sheetHeaderTitle, { color: theme.colors.text }]}>
              {titles[sheetPanel]}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            style={{ flexShrink: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            {sheetPanel === 'main' ? (
              <>
                <View style={[styles.sheetGroup, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <SheetRow
                    icon="language-outline"
                    title="显示翻译"
                    right={<SwitchPill value={showTranslation} onPress={toggleTranslation} />}
                  />
                  <SheetRow
                    icon="color-wand-outline"
                    title="翻译引擎"
                    value={providerDisplayName(settings.provider)}
                    onPress={() => {
                      setSheet(false);
                      router.push('/settings/translation' as any);
                    }}
                  />
                </View>

                <View style={[styles.sheetGroup, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <SheetRow
                    icon="text-outline"
                    title="逐词高亮"
                    subtitle="仅 AI 字幕可用"
                    disabled
                    right={<SwitchPill value={false} onPress={() => {}} />}
                  />
                  <SheetRow
                    icon="volume-high-outline"
                    title="朗读高亮效果"
                    subtitle="当前字幕不带语音时间轴"
                    value="聚焦"
                    disabled
                  />
                </View>

                <View style={[styles.sheetGroup, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <SheetRow
                    icon="swap-vertical-outline"
                    title="字幕滚动"
                    value={settings.subtitle.scrollMode === 'top' ? '置顶' : '翻页'}
                    onPress={() => setSheetPanel('scroll')}
                  />
                  <SheetRow
                    icon="cut-outline"
                    title="断句模式"
                    value={settings.subtitle.sentenceMode === 'smart' ? '智能断句' : '整句'}
                    onPress={() => setSheetPanel('sentence')}
                  />
                  <SheetRow
                    icon="text-outline"
                    title="字体大小"
                    value={`${fontSize} / ${landscapeFontSize}`}
                    onPress={() => {
                      setFontSizeTarget(landscape ? 'landscape' : 'portrait');
                      setSheetPanel('fontSize');
                    }}
                  />
                  <SheetRow
                    icon="brush-outline"
                    title="字体"
                    value="默认"
                    onPress={() => setSheetPanel('font')}
                  />
                </View>

                <View style={[styles.sheetGroup, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <SheetRow
                    icon="eye-off-outline"
                    title="隐藏视频"
                    right={
                      <SwitchPill
                        value={hideVideo}
                        onPress={() =>
                          patchSettings({
                            subtitle: { ...settings.subtitle, hideVideo: !hideVideo },
                          })
                        }
                      />
                    }
                  />
                  <SheetRow
                    icon="sunny-outline"
                    title="播放时屏幕常亮"
                    subtitle="播放页不会自动变暗或锁屏"
                    right={
                      <SwitchPill
                        value={settings.keepAwake}
                        onPress={() => patchSettings({ keepAwake: !settings.keepAwake })}
                      />
                    }
                  />
                  <SheetRow
                    icon="headset-outline"
                    title="精听设置"
                    value={`每句 ${settings.subtitle.repeatCount} 遍`}
                    onPress={() => setSheetPanel('listening')}
                  />
                </View>

                <View style={[styles.sheetGroup, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <SheetRow
                    icon="share-social-outline"
                    title="分享视频"
                    onPress={() => {
                      shareVideo();
                      setSheet(false);
                    }}
                  />
                  <SheetRow
                    icon="heart-outline"
                    title={isFavorite ? '取消收藏' : '收藏视频'}
                    onPress={() => {
                      saveFavorite();
                      setSheet(false);
                    }}
                  />
                  <SheetRow
                    icon="document-text-outline"
                    title="导出字幕 PDF"
                    subtitle={cues.length ? `${cues.length} 句 · 含双语对照` : '当前没有字幕'}
                    onPress={() => {
                      setSheet(false);
                      exportSubtitlePdf();
                    }}
                  />
                  <SheetRow
                    icon="albums-outline"
                    title="频道详情"
                    value={metaAuthor || 'YouTube'}
                    onPress={() => {
                      setSheet(false);
                      router.push({
                        pathname: '/channel',
                        params: {
                          channelId: metaChannelId,
                          title: metaAuthor || 'YouTube',
                        },
                      } as any);
                    }}
                  />
                  <SheetRow
                    icon="person-circle-outline"
                    title="登录 YouTube"
                    subtitle="同步订阅与账号播放权限"
                    onPress={() => {
                      setSheet(false);
                      router.push('/youtube-account' as any);
                    }}
                  />
                </View>

                <View style={[styles.sheetGroup, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <SheetRow
                    icon="refresh-outline"
                    title="重新翻译字幕"
                    onPress={() => {
                      setSheet(false);
                      retranslate();
                    }}
                  />
                </View>
              </>
            ) : null}

            {sheetPanel === 'scroll' ? (
              <View style={styles.optionList}>
                {[
                  {
                    id: 'top' as const,
                    title: '置顶',
                    desc: '当前句始终固定在最上面，边听边看下一句。',
                  },
                  {
                    id: 'page' as const,
                    title: '翻页',
                    desc: '字幕按顺序往下播放，当前句接近底部时再翻页。',
                  },
                ].map((option) => {
                  const active = settings.subtitle.scrollMode === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() =>
                        patchSettings({
                          subtitle: { ...settings.subtitle, scrollMode: option.id },
                        })
                      }
                      style={[
                        styles.optionCard,
                        {
                          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.optionTitle, { color: theme.colors.text }]}>
                          {option.title}
                        </Text>
                        <Text style={[styles.optionDesc, { color: theme.colors.textSecondary }]}>
                          {option.desc}
                        </Text>
                      </View>
                      {active ? (
                        <Ionicons name="checkmark" size={22} color={theme.colors.primary} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {sheetPanel === 'sentence' ? (
              <View style={styles.optionList}>
                {[
                  {
                    id: 'smart' as const,
                    title: '智能断句',
                    desc: '把长句按意思分成小段，每段短而完整，边看边理解更轻松，跟读也更容易开口。',
                  },
                  {
                    id: 'whole' as const,
                    title: '整句',
                    desc: '一张卡就是一个完整句子，能看清整句的结构和语法，翻译也更准确。',
                  },
                ].map((option) => {
                  const active = settings.subtitle.sentenceMode === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() =>
                        patchSettings({
                          subtitle: { ...settings.subtitle, sentenceMode: option.id },
                        })
                      }
                      style={[
                        styles.optionCard,
                        {
                          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.optionTitle, { color: theme.colors.text }]}>
                          {option.title}
                        </Text>
                        <Text style={[styles.optionDesc, { color: theme.colors.textSecondary }]}>
                          {option.desc}
                        </Text>
                      </View>
                      {active ? (
                        <Ionicons name="checkmark" size={22} color={theme.colors.primary} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {sheetPanel === 'font' ? (
              <View>
                <Text style={[styles.panelSectionLabel, { color: theme.colors.textSecondary }]}>
                  原文 · {learningLang.toUpperCase()}
                </Text>
                {(
                  [
                    ['default', '默认', '系统字体'],
                    ['rounded', '圆角体', '系统圆角'],
                    ['serif', '衬线', 'Serif'],
                    ['geometric', '几何', '轻几何'],
                  ] as const
                ).map(([id, label, desc]) => {
                  const active = settings.subtitle.originalFont === id;
                  return (
                    <Pressable
                      key={`source-${id}`}
                      onPress={() =>
                        patchSettings({
                          subtitle: { ...settings.subtitle, originalFont: id },
                        })
                      }
                      style={[
                        styles.fontOption,
                        { backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                          {label}
                        </Text>
                        <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}>
                          {desc}
                        </Text>
                      </View>
                      {active ? <Ionicons name="checkmark" size={20} color={theme.colors.primary} /> : null}
                    </Pressable>
                  );
                })}
                <Text style={[styles.panelSectionLabel, { color: theme.colors.textSecondary }]}>
                  粗细
                </Text>
                <WeightPicker
                  value={settings.subtitle.originalWeight}
                  onChange={(weight) =>
                    patchSettings({
                      subtitle: { ...settings.subtitle, originalWeight: weight },
                    })
                  }
                />

                <Text style={[styles.panelSectionLabel, { color: theme.colors.textSecondary, marginTop: 24 }]}>
                  翻译 · 中文
                </Text>
                {(
                  [
                    ['default', '默认', '系统字体'],
                    ['serif', '宋体', 'Serif'],
                    ['kai', '楷体', 'Kai'],
                  ] as const
                ).map(([id, label, desc]) => {
                  const active = settings.subtitle.translationFont === id;
                  return (
                    <Pressable
                      key={`translation-${id}`}
                      onPress={() =>
                        patchSettings({
                          subtitle: { ...settings.subtitle, translationFont: id },
                        })
                      }
                      style={[
                        styles.fontOption,
                        { backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                          {label}
                        </Text>
                        <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}>
                          {desc}
                        </Text>
                      </View>
                      {active ? <Ionicons name="checkmark" size={20} color={theme.colors.primary} /> : null}
                    </Pressable>
                  );
                })}
                <Text style={[styles.panelSectionLabel, { color: theme.colors.textSecondary }]}>
                  粗细
                </Text>
                <WeightPicker
                  value={settings.subtitle.translationWeight}
                  onChange={(weight) =>
                    patchSettings({
                      subtitle: { ...settings.subtitle, translationWeight: weight },
                    })
                  }
                />
              </View>
            ) : null}

            {sheetPanel === 'fontSize' ? (
              <View>
                <Text style={[styles.panelSectionLabel, { color: theme.colors.textSecondary }]}>
                  调整范围
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 22 }}>
                  {[
                    { id: 'portrait' as const, label: '竖屏字幕', value: fontSize },
                    { id: 'landscape' as const, label: '全屏字幕', value: landscapeFontSize },
                  ].map((target) => {
                    const active = fontSizeTarget === target.id;
                    return (
                      <Pressable
                        key={target.id}
                        onPress={() => setFontSizeTarget(target.id)}
                        style={{
                          flex: 1,
                          height: 42,
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                          borderWidth: active ? 1 : 0,
                          borderColor: theme.colors.primary,
                        }}
                      >
                        <Text
                          style={{
                            color: active ? theme.colors.primary : theme.colors.textSecondary,
                            fontSize: 12.5,
                            fontWeight: active ? '800' : '600',
                          }}
                        >
                          {target.label} · {target.value}px
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={{ alignItems: 'center', marginBottom: 10 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '800' }}>
                    {fontSizeTarget === 'portrait' ? '标准' : '全屏'}
                  </Text>
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 3 }}>
                    {fontSizeTarget === 'portrait' ? fontSize : landscapeFontSize}px
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 15, fontWeight: '700' }}>A</Text>
                  <View
                    style={styles.fontTrackWrap}
                    onLayout={(event) => {
                      fontTrackWidthRef.current = event.nativeEvent.layout.width;
                    }}
                    onStartShouldSetResponder={() => true}
                    onMoveShouldSetResponder={() => true}
                    onResponderGrant={(event) =>
                      applyFontFromX(event.nativeEvent.locationX, fontSizeTarget)
                    }
                    onResponderMove={(event) =>
                      applyFontFromX(event.nativeEvent.locationX, fontSizeTarget)
                    }
                  >
                    <View style={[styles.fontTrack, { backgroundColor: theme.colors.surfaceAlt }]}>
                      <View
                        style={[
                          styles.fontTrackFill,
                          {
                            backgroundColor: theme.colors.primary,
                            width: `${fontStepPercent(fontSizeTarget === 'portrait' ? fontSize : landscapeFontSize)}%` as any,
                          },
                        ]}
                      />
                    </View>
                    {FONT_STEPS.map((size) => (
                      <View
                        key={size}
                        style={[
                          styles.fontDot,
                          {
                            left: `${((FONT_STEPS.indexOf(size) / (FONT_STEPS.length - 1)) * 100)}%` as any,
                            backgroundColor: size <= (fontSizeTarget === 'portrait' ? fontSize : landscapeFontSize)
                              ? theme.colors.primary
                              : theme.colors.borderStrong,
                          },
                        ]}
                      />
                    ))}
                  </View>
                  <Text style={{ color: theme.colors.text, fontSize: 23, fontWeight: '800' }}>A</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 26, marginTop: 10 }}>
                  {[14, 20, 26, 34].map((size) => (
                    <Text key={size} style={{ color: theme.colors.textTertiary, fontSize: 10 }}>
                      {size}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}

            {sheetPanel === 'listening' ? (
              <View>
                <View style={[styles.sheetGroup, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <SheetRow
                    icon="play-forward-outline"
                    title="自动播放下一句"
                    subtitle="盲听时播完自动进入下一句"
                    right={
                      <SwitchPill
                        value={settings.subtitle.autoNext}
                        onPress={() =>
                          patchSettings({
                            subtitle: {
                              ...settings.subtitle,
                              autoNext: !settings.subtitle.autoNext,
                            },
                          })
                        }
                      />
                    }
                  />
                  <SheetRow
                    icon="eye-off-outline"
                    title="隐藏视频"
                    right={
                      <SwitchPill
                        value={hideVideo}
                        onPress={() =>
                          patchSettings({
                            subtitle: { ...settings.subtitle, hideVideo: !hideVideo },
                          })
                        }
                      />
                    }
                  />
                </View>
                <View style={[styles.sheetGroup, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <SheetRow
                    icon="text-outline"
                    title="字体大小"
                    value={`${fontSize}px / ${landscapeFontSize}px`}
                    onPress={() => {
                      setFontSizeTarget(landscape ? 'landscape' : 'portrait');
                      setSheetPanel('fontSize');
                    }}
                  />
                  <SheetRow
                    icon="repeat-outline"
                    title="每句播放遍数"
                    right={
                      <Stepper
                        value={settings.subtitle.repeatCount}
                        min={1}
                        max={5}
                        onChange={(value) =>
                          patchSettings({
                            subtitle: { ...settings.subtitle, repeatCount: value },
                          })
                        }
                      />
                    }
                  />
                  <SheetRow
                    icon="hourglass-outline"
                    title="每遍间隔"
                    right={
                      <Stepper
                        value={settings.subtitle.repeatInterval}
                        min={0}
                        max={3}
                        suffix="秒"
                        onChange={(value) =>
                          patchSettings({
                            subtitle: { ...settings.subtitle, repeatInterval: value },
                          })
                        }
                      />
                    }
                  />
                </View>
                <Text style={[styles.panelHint, { color: theme.colors.textTertiary }]}>
                  打开播放器底部的「单句循环」后，会按这里的遍数和间隔重复当前句；盲听模式下则控制是否自动跳到下一句。
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    );
  }

  function WeightPicker({
    value,
    onChange,
  }: {
    value: 'regular' | 'medium' | 'bold';
    onChange: (value: 'regular' | 'medium' | 'bold') => void;
  }) {
    return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(
          [
            ['regular', '常规', '400'],
            ['medium', '中等', '600'],
            ['bold', '粗', '800'],
          ] as const
        ).map(([id, label, weight]) => {
          const active = value === id;
          return (
            <Pressable
              key={id}
              onPress={() => onChange(id)}
              style={{
                flex: 1,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? theme.colors.primary : theme.colors.surfaceAlt,
              }}
            >
              <Text
                style={{
                  color: active ? '#FFFFFF' : theme.colors.textSecondary,
                  fontSize: 12.5,
                  fontWeight: weight as any,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  function Stepper({
    value,
    min,
    max,
    suffix,
    onChange,
  }: {
    value: number;
    min: number;
    max: number;
    suffix?: string;
    onChange: (value: number) => void;
  }) {
    return (
      <View style={[styles.fontStepper, { backgroundColor: theme.colors.surface }]}>
        <Pressable
          onPress={() => onChange(Math.max(min, value - 1))}
          style={styles.stepButton}
          disabled={value <= min}
        >
          <Ionicons name="remove" size={17} color={value <= min ? theme.colors.textTertiary : theme.colors.text} />
        </Pressable>
        <Text style={[styles.fontStepValue, { color: theme.colors.textSecondary }]}>
          {value}
          {suffix ?? ''}
        </Text>
        <Pressable
          onPress={() => onChange(Math.min(max, value + 1))}
          style={styles.stepButton}
          disabled={value >= max}
        >
          <Ionicons name="add" size={17} color={value >= max ? theme.colors.textTertiary : theme.colors.text} />
        </Pressable>
      </View>
    );
  }

  function fontStepPercent(value: number) {
    const nearest = FONT_STEPS.reduce(
      (best, size, index) =>
        Math.abs(size - value) < Math.abs(FONT_STEPS[best] - value) ? index : best,
      0
    );
    return (nearest / (FONT_STEPS.length - 1)) * 100;
  }

  function applyFontFromX(x: number, target: 'portrait' | 'landscape') {
    const width = fontTrackWidthRef.current;
    if (!width) return;
    const ratio = Math.max(0, Math.min(1, x / width));
    const index = Math.round(ratio * (FONT_STEPS.length - 1));
    const next = FONT_STEPS[index] ?? FONT_STEPS[0];
    patchSettings({
      subtitle: {
        ...settings.subtitle,
        ...(target === 'portrait' ? { fontSize: next } : { landscapeFontSize: next }),
      },
    });
  }

  async function retranslate() {
    if (!sourceCues.length || !trackKey) {
      setToast('没有可重新翻译的字幕');
      return;
    }
    setStatus('正在重新翻译…');
    try {
      const translated = await translateCueList(videoId, sourceCues, trackKey, {
        contextTitle: metaTitle,
        from: trackKey.split(':')[0],
      });
      setTranslatedCues(translated.cues);
      setProviderLabel(providerDisplayName(translated.provider));
      setStatus('');
      setToast('字幕已重新翻译');
    } catch (error) {
      setStatus(`翻译失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function SheetRow({
  icon,
  title,
  subtitle,
  value,
  right,
  onPress,
  disabled,
}: {
  icon: any;
  title: string;
  subtitle?: string;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const theme = useAppTheme();
  const content = (
    <View
      style={[
        styles.sheetRow,
        { borderBottomColor: theme.colors.border },
        disabled && { opacity: 0.38 },
      ]}
    >
      <View style={[styles.sheetIcon, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={18} color={theme.colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.sheetRowTitle, { color: theme.colors.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.sheetRowSubtitle, { color: theme.colors.textTertiary }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.sheetRowValue, { color: theme.colors.textSecondary }]}>{value}</Text>
      ) : null}
      {right}
      {onPress && !disabled ? (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={theme.colors.textTertiary}
          style={{ marginLeft: 6 }}
        />
      ) : null}
    </View>
  );
  if (!onPress || disabled) return content;
  return <Pressable onPress={onPress}>{content}</Pressable>;
}

function SwitchPill({ value, onPress }: { value: boolean; onPress: () => void }) {
  const theme = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.switchPill,
        { backgroundColor: value ? theme.colors.primary : theme.colors.surfaceAlt },
      ]}
    >
      <View style={[styles.switchKnob, value && { alignSelf: 'flex-end' }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0812' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 4,
  },
  headerPlain: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: '#F5F2FF', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  headerSubtitle: { color: '#8D849D', fontSize: 11, marginTop: 2 },
  videoFrame: {
    marginHorizontal: 14,
    backgroundColor: '#000000',
    overflow: 'hidden',
    borderRadius: 18,
  },
  videoFrameHidden: {
    marginHorizontal: 14,
    height: 56,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(90,85,74,0.18)',
  },
  hiddenWebview: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
  },
  hiddenVideoBanner: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(120,116,104,0.10)',
  },
  landscapeVideo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000' },
  webview: { flex: 1, backgroundColor: '#000000' },
  videoLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050309',
    gap: 8,
  },
  videoLoadingText: { color: '#B9AFCC', fontSize: 12 },
  centerPlay: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -34,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(10,8,16,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  qualityChip: {
    position: 'absolute',
    left: 10,
    top: 10,
    backgroundColor: 'rgba(12,9,18,0.68)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  qualityChipText: { color: '#CFE2D7', fontSize: 10, fontWeight: '700' },
  videoFullscreen: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(10,8,16,0.7)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 8,
  },
  videoTranslate: {
    position: 'absolute',
    right: 50,
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(10,8,16,0.7)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 8,
  },
  problemOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,5,13,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  problemTitle: { color: '#F5F2FF', fontSize: 15, fontWeight: '800', marginTop: 8 },
  problemText: { color: '#9A90AB', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 6 },
  problemButton: {
    backgroundColor: '#446B5B',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  problemButtonGhost: { backgroundColor: 'rgba(255,255,255,0.1)' },
  problemButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  activeTranslation: { color: '#E7E1F5', fontSize: 16, lineHeight: 23, marginTop: 5 },
  nowCard: {
    marginHorizontal: 18,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 14,
    paddingBottom: 2,
  },
  transcriptTitle: { color: '#F5F2FF', fontSize: 15, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '70%' },
  statusText: { color: '#8D849D', fontSize: 11, flexShrink: 1 },
  cue: { paddingVertical: 9, paddingHorizontal: 8, borderRadius: 12 },
  cueActive: { backgroundColor: 'rgba(124,92,255,0.13)' },
  cueOriginal: { color: '#A79EB9', lineHeight: 25, fontWeight: '600' },
  cueOriginalActive: { color: '#C4B5FD', fontWeight: '800' },
  cueTranslation: { color: '#746B85', lineHeight: 20, marginTop: 3 },
  cueTranslationActive: { color: '#F1ECFA' },
  emptyTranscript: { alignItems: 'center', paddingTop: 36, gap: 10 },
  emptyTranscriptText: { color: '#8D849D', fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 },
  controls: { backgroundColor: '#120E1B', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#241C33', paddingHorizontal: 18, paddingTop: 6 },
  progressTouch: { height: 22, justifyContent: 'center' },
  progressRail: { height: 4, borderRadius: 2, backgroundColor: '#2B2340', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: '#446B5B' },
  progressThumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#C4B5FD',
    marginLeft: -6,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 0 },
  timeText: { color: '#8A8099', fontSize: 11, fontVariant: ['tabular-nums'] },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  transportSmall: { width: 42, height: 38, alignItems: 'center', justifyContent: 'center' },
  ratePill: {
    minWidth: 52,
    height: 30,
    paddingHorizontal: 9,
    borderRadius: 15,
    backgroundColor: '#E2ECE5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  loopButton: {
    width: 38,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#446B5B',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#446B5B',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  bottomActions: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 4 },
  action: { alignItems: 'center', gap: 3, minWidth: 56, paddingVertical: 4 },
  actionLabel: { color: '#8A8099', fontSize: 10, fontWeight: '600' },
  landscapeRoot: { flex: 1, backgroundColor: '#000000' },
  landscapeBack: {
    position: 'absolute',
    left: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  landscapeTitle: {
    position: 'absolute',
    left: 70,
    right: 70,
    alignItems: 'center',
  },
  landscapeTitleText: { color: '#F5F2FF', fontSize: 15, fontWeight: '800' },
  landscapeAuthor: { color: '#A9A0BC', fontSize: 11, marginTop: 2 },
  landscapeMore: {
    position: 'absolute',
    right: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  landscapeSubOriginal: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', textAlign: 'center', textShadowColor: '#000', textShadowRadius: 6 },
  landscapeSubTranslation: { color: '#E4DEF2', fontSize: 14, textAlign: 'center', marginTop: 3, textShadowColor: '#000', textShadowRadius: 6 },
  landTop: {
    position: 'absolute',
    left: 16,
    right: 12,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    zIndex: 10,
  },
  landTime: {
    color: '#EDE9F7',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
  landProgressTouch: { flex: 1, height: 22, justifyContent: 'center', minWidth: 80 },
  landProgressRail: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
  landProgressFill: { height: '100%', backgroundColor: '#FFFFFF' },
  landIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  landIconActive: { backgroundColor: 'rgba(68,107,91,0.86)' },
  landCc: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  landCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '43%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    zIndex: 9,
  },
  landTransportButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  landPlay: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(68,107,91,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  landRatePill: {
    minWidth: 46,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.48)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  landRateText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '800' },
  landLoopActive: { backgroundColor: 'rgba(68,107,91,0.86)' },
  landSubBox: {
    position: 'absolute',
    left: 40,
    right: 40,
    backgroundColor: 'rgba(16,13,24,0.6)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    zIndex: 8,
  },
  landSubOriginal: {
    color: '#FFFFFF',
    fontWeight: '800',
    lineHeight: 30,
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowRadius: 6,
  },
  landSubTranslation: {
    color: '#E9E3F5',
    lineHeight: 24,
    textAlign: 'center',
    marginTop: 2,
    textShadowColor: '#000',
    textShadowRadius: 6,
  },
  modeMask: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(10,8,16,0.45)',
    justifyContent: 'flex-end',
    padding: 16,
    paddingBottom: 92,
    zIndex: 90,
  },
  modeCard: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 120,
    backgroundColor: 'rgba(30,22,46,0.94)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  toastText: { color: '#F5F2FF', fontSize: 12 },
  sheetMask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4,2,8,0.6)',
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  sheetCard: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetHeaderButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  optionList: { gap: 10, paddingBottom: 8 },
  optionCard: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  optionTitle: { fontSize: 16, fontWeight: '800' },
  optionDesc: { fontSize: 12, lineHeight: 19, marginTop: 5 },
  panelSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 2,
  },
  fontOption: {
    minHeight: 58,
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fontTrackWrap: {
    flex: 1,
    height: 34,
    justifyContent: 'center',
  },
  fontTrack: { height: 7, borderRadius: 4, overflow: 'hidden' },
  fontTrackFill: { height: 7, borderRadius: 4 },
  fontDot: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 3,
    marginLeft: -2,
  },
  panelHint: { fontSize: 11, lineHeight: 18, marginTop: 2, paddingHorizontal: 4 },
  sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: '#4A4058', marginBottom: 12 },
  sheetTitle: { color: '#F5F2FF', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  sheetGroup: {
    backgroundColor: '#1C1628',
    borderRadius: 16,
    paddingHorizontal: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2A2138',
    paddingVertical: 6,
  },
  sheetIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#271E3A', alignItems: 'center', justifyContent: 'center' },
  sheetRowTitle: { color: '#EFE9FA', fontSize: 14.5, fontWeight: '600' },
  sheetRowSubtitle: { color: '#817791', fontSize: 11, marginTop: 2 },
  sheetRowValue: { color: '#A99FBA', fontSize: 12 },
  switchPill: { width: 46, height: 27, borderRadius: 14, backgroundColor: '#332A44', padding: 3 },
  switchPillOn: { backgroundColor: '#446B5B' },
  switchKnob: { width: 21, height: 21, borderRadius: 11, backgroundColor: '#FFFFFF' },
  switchKnobOn: { alignSelf: 'flex-end' },
  fontStepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2A2238', borderRadius: 10, height: 32 },
  stepButton: { width: 34, height: 32, alignItems: 'center', justifyContent: 'center' },
  fontStepValue: { color: '#D9D0EB', fontSize: 11, width: 36, textAlign: 'center' },
  errorTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
