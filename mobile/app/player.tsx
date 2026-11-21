import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
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
import { getSecret } from '@/src/core/secrets';
import {
  AiConfig,
  aiAnalyzeSentence,
  deepseekConfig,
  openaiConfig,
  siliconflowConfig,
} from '@/src/core/translate/ai';
import { providerDisplayName, translateCueList } from '@/src/core/translate';
import { CaptionTrack, Cue, SubtitleMode } from '@/src/core/types';
import {
  captionQualityScore,
  fetchCaptionCues,
  getVideoMeta,
  pickCaptionTracks,
} from '@/src/core/youtube/innertube';
import { fontWeightFor, fontFamilyFor, sentenceCues } from '@/src/ui/subtitleStyle';
import { appAlert as Alert } from '@/src/ui/app-alert';
import { RipplePressable } from '@/src/ui/ripple-pressable';
import { LoopIcon, SpeedIcon } from '@/src/ui/player-icons';
import { Squircle } from '@/src/ui/squircle';
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
    var previous = window.__kissBridge;
    if (previous) previous.alive = false;
    if (previous && previous.timer) clearInterval(previous.timer);
    if (previous && previous.cssTimer) clearInterval(previous.cssTimer);
    if (previous && previous.qualityTimer) clearInterval(previous.qualityTimer);
    if (previous && previous.startTimer) clearTimeout(previous.startTimer);
    var bridge = window.__kissBridge = {
      mode: 'mobile-watch',
      alive: true,
      wantPlay: previous ? previous.wantPlay : true,
      userPaused: previous ? previous.userPaused : false,
      frameReady: false,
      timer: null,
      cssTimer: null,
      qualityTimer: null,
      startTimer: null,
      videoRef: null
    };
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
    function getVideo(){
      // Scope to the real watch player and prefer YouTube's main video element.
      // The page can keep preview/ad/mini-player <video> elements around; using
      // the first document-level video makes pause/play target the wrong one.
      try {
        var p = getPlayer();
        if (p && p.querySelector) {
          var main = p.querySelector('video.html5-main-video');
          if (main) return main;
          var videos = p.querySelectorAll('video');
          var best = null;
          var bestArea = 0;
          for (var i = 0; i < videos.length; i++) {
            var candidate = videos[i];
            var rect = candidate.getBoundingClientRect
              ? candidate.getBoundingClientRect()
              : { width: 0, height: 0 };
            var area = Math.max(0, rect.width) * Math.max(0, rect.height);
            if (area > bestArea) {
              bestArea = area;
              best = candidate;
            }
          }
          if (best) return best;
        }
      } catch(e) {}
      return document.querySelector('#movie_player video') || document.querySelector('video');
    }
    function isAdShowing(){
      try {
        var p = getPlayer();
        if (p && p.classList && p.classList.contains('ad-showing')) return true;
        if (p && p.querySelector) {
          var skip = p.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button');
          if (skip) {
            var rect = skip.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return true;
          }
        }
      } catch(e) {}
      return false;
    }
    var audioFixTimer = null;
    function unmuteOverlay(){
      try {
        var selectors = [
          '.ytp-unmute',
          '.ytp-unmute-button',
          'button[aria-label="取消静音"]',
          'button[aria-label="Unmute"]',
          'button[aria-label*="取消静音"]',
          'button[aria-label*="Unmute"]'
        ];
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el && el.getClientRects().length) {
            el.click();
            return true;
          }
        }
      } catch(e) {}
      return false;
    }
    function ensureAudio(){
      var v = getVideo();
      var p = getPlayer();
      if (!v) return false;
      try { if (v.muted) v.muted = false; } catch(e) {}
      try { if (v.volume < 0.99) v.volume = 1; } catch(e) {}
      try { if (p && p.unMute) p.unMute(); } catch(e) {}
      try { if (p && p.setVolume) p.setVolume(100); } catch(e) {}
      return unmuteOverlay();
    }
    function scheduleAudio(delay){
      if (audioFixTimer) clearTimeout(audioFixTimer);
      audioFixTimer = setTimeout(function(){ ensureAudio(); }, delay || 250);
    }
    function setQuality(){
      try {
        var p = getPlayer();
        if (p && p.setPlaybackQualityRange) {
          p.setPlaybackQualityRange('hd1080','hd1080');
          if (p.setPlaybackQuality) p.setPlaybackQuality('hd1080');
        }
      } catch(e) {}
    }
    function isFrameReady(v){
      return !!(v && v.readyState >= 2 && v.videoWidth > 0);
    }
    function announceReady(v){
      if (!isFrameReady(v) || bridge.frameReady) return;
      bridge.frameReady = true;
      send({ type: 'ready' });
    }
    function maybeStart(v){
      // Never let YouTube autoplay before the first video frame is available.
      // Audio and subtitles must not run ahead of the visible picture.
      if (!bridge.alive || !v || bridge.userPaused || !bridge.wantPlay) return;
      announceReady(v);
      if (!isFrameReady(v)) {
        // If a slow network never reaches loadeddata, avoid a permanently
        // stuck play button. This is a fallback only; normal playback waits
        // for the first frame.
        if (!bridge.startTimer) {
          bridge.startTimer = setTimeout(function(){
            bridge.startTimer = null;
            var current = getVideo();
            if (
              current &&
              !bridge.userPaused &&
              bridge.wantPlay &&
              (current.paused || current.ended)
            ) {
              try {
                var fallback = current.play();
                if (fallback && fallback.catch) fallback.catch(function(){});
              } catch(e) {}
            }
          }, 4500);
        }
        return;
      }
      if (bridge.startTimer) {
        clearTimeout(bridge.startTimer);
        bridge.startTimer = null;
      }
      if (v.paused || v.ended) {
        try {
          var result = v.play();
          if (result && result.catch) result.catch(function(){});
        } catch(e) {}
      }
      scheduleAudio(250);
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
        ready: isFrameReady(v),
        rate: v.playbackRate,
        quality: quality,
        ad: isAdShowing()
      });
    }
    var bindTries = 0;
    function bind(){
      if (!bridge.alive) return;
      var v = getVideo();
      if (!v) {
        bindTries++;
        if (bindTries < 14) setTimeout(bind, 700);
        return;
      }
      if (bridge.videoRef !== v) {
        bridge.videoRef = v;
        bridge.frameReady = false;
        if (bridge.startTimer) {
          clearTimeout(bridge.startTimer);
          bridge.startTimer = null;
        }
      }
      if (!isFrameReady(v) && !v.paused) {
        // Some YouTube builds autoplay before the first frame is decoded.
        // Hold the picture until loadeddata so audio cannot lead the video.
        try { v.pause(); } catch(e) {}
      }
      if (!v.__kissBound) {
        v.__kissBound = true;
        ['timeupdate','play','playing','pause','ended','durationchange','loadedmetadata','seeking','seeked','ratechange'].forEach(function(name){
          v.addEventListener(name, report);
        });
        v.addEventListener('playing', function(){
          scheduleAudio(180);
          setTimeout(ensureAudio, 900);
          // Keep the first frame on auto quality so it appears quickly, then
          // upgrade to 1080p only after playback has started.
          if (!v.__kissQualityStarted) {
            v.__kissQualityStarted = true;
            setTimeout(setQuality, 1800);
          }
          if (!bridge.qualityTimer) {
            bridge.qualityTimer = setInterval(setQuality, 5000);
          }
        });
        v.addEventListener('loadedmetadata', function(){
          scheduleAudio(180);
        });
        var audioStrikes = 0;
        v.addEventListener('volumechange', function(){
          if (v.muted && audioStrikes < 6) {
            audioStrikes++;
            scheduleAudio(120);
          } else if (!v.muted) {
            audioStrikes = 0;
          }
        });
        v.addEventListener('error', function(){
          send({ type:'problem', reason:'video-error', code: v.error ? v.error.code : 0 });
        });
        try { v.playsInline = true; } catch(e) {}
        try { v.preload = 'auto'; } catch(e) {}
        report();
      }
      bridge.userPaused = bridge.userPaused || !!v.__kissUserPaused;
      if (v.__kissReadyBridge !== bridge) {
        v.__kissReadyBridge = bridge;
        var markReady = function(){
          if (v.__kissReadyBridge !== bridge) return;
          announceReady(v);
          maybeStart(v);
        };
        v.addEventListener('loadeddata', markReady);
        v.addEventListener('canplay', markReady);
      }
      if (isFrameReady(v)) {
        announceReady(v);
        maybeStart(v);
      }
      if (!bridge.qualityTimer && !v.paused) {
        bridge.qualityTimer = setInterval(setQuality, 5000);
      }
      if (!bridge.timer) {
        bridge.timer = setInterval(report, 900);
      }
    }
    window.__kiss = {
      play: function(){
        bridge.userPaused = false;
        bridge.wantPlay = true;
        var v = getVideo();
        if (v) v.__kissUserPaused = false;
        maybeStart(v);
        scheduleAudio(260);
        setTimeout(ensureAudio, 1000);
        return true;
      },
      pause: function(){
        bridge.userPaused = true;
        bridge.wantPlay = false;
        if (bridge.startTimer) {
          clearTimeout(bridge.startTimer);
          bridge.startTimer = null;
        }
        var v = getVideo();
        if (v) {
          v.__kissUserPaused = true;
          try { v.pause(); } catch(e) {}
        }
        return true;
      },
      resume: function(){
        if (bridge.userPaused) return true;
        bridge.wantPlay = true;
        var v = getVideo();
        if (!v) return true;
        maybeStart(v);
        scheduleAudio(180);
        setTimeout(report, 80);
        return true;
      },
      toggle: function(){
        var v = getVideo();
        if (!v) return true;
        if (v.paused || v.ended) {
          window.__kiss.play();
        } else {
          window.__kiss.pause();
        }
        setTimeout(report, 80);
        return true;
      },
      seek: function(seconds){ var v=getVideo(); try{ if(v){ v.currentTime=Math.max(0, Number(seconds)||0); } }catch(e){}; return true; },
      rate: function(rate){ var v=getVideo(); try{ if(v)v.playbackRate=Number(rate)||1; }catch(e){}; return true; },
      mute: function(muted){ var v=getVideo(); try{ if(v)v.muted=!!muted; }catch(e){}; return true; },
      audio: function(){ ensureAudio(); return true; },
      quality: function(){ setQuality(); return true; }
    };
    bind();
    var lastHref = location.href;
    document.addEventListener('yt-navigate-finish', function(){
      if (!bridge.alive) return;
      if (location.href !== lastHref) {
        lastHref = location.href;
        bridge.userPaused = false;
        bridge.wantPlay = true;
        bridge.frameReady = false;
        bridge.videoRef = null;
        var nextVideo = getVideo();
        if (nextVideo) {
          nextVideo.__kissUserPaused = false;
          nextVideo.__kissQualityStarted = false;
        }
      }
      bindTries = 0;
      setTimeout(bind, 400);
    }, true);
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
const RATE_PRESETS = [0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.5];
const RATE_MIN = 0.5;
const RATE_MAX = 2;
const RATE_DOTS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2];

function controlHaptic() {
  if (Platform.OS === 'web') return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

type SubtitleModeOption = {
  id: SubtitleMode;
  label: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const SUBTITLE_MODE_OPTIONS: SubtitleModeOption[] = [
  { id: 'original', label: '原文字幕', desc: '只显示视频原语言', icon: 'document-text-outline' },
  { id: 'translation', label: '翻译字幕', desc: '只显示中文翻译', icon: 'language-outline' },
  { id: 'bilingual', label: '双语字幕', desc: '原文 + 翻译', icon: 'chatbubbles-outline' },
];

function subtitleModeOption(mode: SubtitleMode) {
  return SUBTITLE_MODE_OPTIONS.find((option) => option.id === mode) ?? SUBTITLE_MODE_OPTIONS[2];
}

function sentenceFavoriteId(videoId: string, start: number) {
  return `${videoId}:${start.toFixed(2)}`;
}

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
  const sentenceFavorites = useAppStore((state) => state.sentenceFavorites);
  const toggleSentenceFavorite = useAppStore((state) => state.toggleSentenceFavorite);
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
  const [adShowing, setAdShowing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [quality, setQuality] = useState('');
  const [videoProblem, setVideoProblem] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [sheetPanel, setSheetPanel] = useState<
    | 'main'
    | 'scroll'
    | 'sentence'
    | 'font'
    | 'fontSize'
    | 'listening'
    | 'listeningOriginal'
    | 'listeningTranslation'
    | 'listeningRepeat'
    | 'listeningInterval'
    | 'analysis'
  >('main');
  const [sheetParent, setSheetParent] = useState<'main' | 'listening'>('main');
  const [fontSizeTarget, setFontSizeTarget] = useState<'portrait' | 'landscape'>('portrait');
  const [controlsVisible, setControlsVisible] = useState(true);
  const [videoStageSize, setVideoStageSize] = useState({ width: 0, height: 0 });
  const [sourceCues, setSourceCues] = useState<Cue[]>([]);
  const [translatedCues, setTranslatedCues] = useState<Cue[] | null>(null);
  const [metaTitle, setMetaTitle] = useState(initialTitle);
  const [metaAuthor, setMetaAuthor] = useState(initialAuthor);
  const [metaChannelId, setMetaChannelId] = useState('');
  const [status, setStatus] = useState('正在读取字幕…');
  const [progressWidth, setProgressWidth] = useState(0);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const seekPreviewRef = useRef<number | null>(null);
  const [trackKey, setTrackKey] = useState('');
  const [toast, setToast] = useState('');
  const [rate, setRate] = useState(1);
  const [rateSheet, setRateSheet] = useState(false);
  const [loopSentence, setLoopSentence] = useState(false);
  const [blindMode, setBlindMode] = useState(false);
  const [blindReveal, setBlindReveal] = useState(false);
  const [precisionTranslationVisible, setPrecisionTranslationVisible] = useState(true);
  const [precisionPass, setPrecisionPass] = useState(1);
  const [precisionElapsed, setPrecisionElapsed] = useState(0);
  const [precisionCueIndex, setPrecisionCueIndex] = useState(-1);
  const precisionStartedAtRef = useRef<number | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisText, setAnalysisText] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [analysisCue, setAnalysisCue] = useState<Cue | null>(null);
  const [modeMenu, setModeMenu] = useState(false);
  const [modeAnchor, setModeAnchor] = useState<{
    left: number;
    top?: number;
    bottom?: number;
  }>({ left: 16, bottom: 100 });
  const subtitleButtonRef = useRef<any>(null);
  const landscapeCcButtonRef = useRef<any>(null);
  const [providerLabel, setProviderLabel] = useState('');
  const [repeatPass, setRepeatPass] = useState(0);
  const loopGuardRef = useRef(0);
  const blindGuardRef = useRef('');
  const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const precisionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatBusyRef = useRef(false);
  const transcriptScrollRef = useRef(0);
  const transcriptHeightRef = useRef(0);
  const followingTranscriptRef = useRef(true);
  const transcriptInitializedRef = useRef(false);
  const [followingTranscript, setFollowingTranscript] = useState(true);
  const fontTrackWidthRef = useRef(0);
  const rateTrackWidthRef = useRef(0);
  const orientationResumeTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const isFavorite = favorites.some((item) => item.videoId === videoId);
  const subtitleMode = settings.subtitle.mode;
  const showTranslation = subtitleMode !== 'original';
  const showOriginal = subtitleMode !== 'translation';
  const fontSize = settings.subtitle.fontSize ?? 20;
  const landscapeFontSize = settings.subtitle.landscapeFontSize ?? 24;
  const hideVideo = settings.subtitle.hideVideo;
  const hideTitle = settings.subtitle.hideTitle ?? true;
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
    let latest = -1;
    for (let i = 0; i < cues.length; i += 1) {
      if (cues[i].start <= t + 0.12) latest = i;
      else break;
    }
    return latest;
  }, [cues, current]);

  const activeCue = activeIndex >= 0 ? cues[activeIndex] : null;
  const precisionCue =
    (precisionCueIndex >= 0 ? cues[precisionCueIndex] : null) ?? activeCue;
  const precisionPosition = cues.length
    ? Math.min(
        cues.length,
        Math.max(
          1,
          (precisionCueIndex >= 0 ? precisionCueIndex : Math.max(0, activeIndex)) + 1
        )
      )
    : 0;
  const precisionCueSaved = precisionCue
    ? sentenceFavorites.some((fav) => fav.id === sentenceFavoriteId(videoId, precisionCue.start))
    : false;
  const listeningRepeatCount = Math.max(
    1,
    Math.min(3, Math.round(settings.subtitle.repeatCount || 2))
  );
  const listeningRepeatInterval = Math.max(
    0,
    Math.min(3, Number(settings.subtitle.repeatInterval) || 0)
  );
  const listeningOriginalMode = settings.subtitle.listeningOriginalMode ?? 'after';
  const rawListeningTranslationMode =
    settings.subtitle.listeningTranslationMode as string;
  const listeningTranslationMode =
    rawListeningTranslationMode === 'always'
      ? 'always'
      : rawListeningTranslationMode === 'tap' ||
          rawListeningTranslationMode === 'hidden' ||
          rawListeningTranslationMode === 'after'
        ? 'tap'
        : 'together';

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  const openMainSettings = () => {
    setRateSheet(false);
    setSheetParent('main');
    setSheetPanel('main');
    setSheet(true);
  };

  const openListeningSettings = () => {
    setRateSheet(false);
    setSheetParent('listening');
    setSheetPanel('listening');
    setSheet(true);
  };

  const openSheetPanel = (
    panel:
      | 'scroll'
      | 'sentence'
      | 'font'
      | 'fontSize'
      | 'listeningOriginal'
      | 'listeningTranslation'
      | 'listeningRepeat'
      | 'listeningInterval',
    parent: 'main' | 'listening'
  ) => {
    setSheetParent(parent);
    setSheetPanel(panel);
  };

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
    if (
      Platform.OS === 'web' ||
      hideVideo ||
      blindMode ||
      adShowing ||
      videoProblem
    ) {
      setControlsVisible(true);
      return;
    }
    if (!controlsVisible || !playing || videoLoading) return;
    const timer = setTimeout(() => setControlsVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [adShowing, blindMode, controlsVisible, hideVideo, playing, videoLoading, videoProblem]);

  useEffect(() => {
    setRepeatPass(0);
    repeatBusyRef.current = false;
    if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
  }, [activeIndex]);

  useEffect(() => {
    setPrecisionPass(1);
    blindGuardRef.current = '';
    if (precisionTimerRef.current) clearTimeout(precisionTimerRef.current);
    const alwaysShowOriginal = listeningOriginalMode === 'always';
    setBlindReveal(alwaysShowOriginal);
    setPrecisionTranslationVisible(
      listeningTranslationMode === 'always' ||
        (listeningTranslationMode === 'together' && alwaysShowOriginal)
    );
  }, [precisionCueIndex]);

  useEffect(() => {
    if (!blindMode) return;
    if (listeningOriginalMode === 'always') setBlindReveal(true);
    if (listeningTranslationMode === 'always') setPrecisionTranslationVisible(true);
    else if (listeningTranslationMode === 'tap') setPrecisionTranslationVisible(false);
    else
      setPrecisionTranslationVisible(
        listeningOriginalMode === 'always' || blindReveal
      );
  }, [blindMode, listeningOriginalMode, listeningTranslationMode]);

  useEffect(() => {
    return () => {
      if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
      if (precisionTimerRef.current) clearTimeout(precisionTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!blindMode) {
      precisionStartedAtRef.current = null;
      setPrecisionElapsed(0);
      return;
    }
    const startedAt = precisionStartedAtRef.current ?? Date.now();
    precisionStartedAtRef.current = startedAt;
    setPrecisionElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const timer = setInterval(() => {
      setPrecisionElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [blindMode]);

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
        const tracks = pickCaptionTracks(
          meta.captionTracks,
          learningLang.startsWith('en') ? 'en' : learningLang
        );
        if (!tracks.length) {
          setSourceCues([]);
          setStatus('这个视频没有可用英文字幕');
          return;
        }
        let bestTrack: CaptionTrack | null = null;
        let fetched: Cue[] = [];
        let bestScore = -1;
        for (const track of tracks) {
          try {
            const candidate = await fetchCaptionCues(track, meta.lengthSeconds);
            if (cancelled) return;
            const score = captionQualityScore(candidate, meta.lengthSeconds);
            if (!bestTrack || score > bestScore) {
              bestTrack = track;
              fetched = candidate;
              bestScore = score;
            }
            // A complete manual track is good enough; otherwise continue to
            // the ASR track and keep whichever covers more of the video.
            const lastEnd = candidate.reduce(
              (max, cue) => Math.max(max, cue.end),
              0
            );
            const covered = candidate.reduce(
              (sum, cue) => sum + Math.max(0, cue.end - cue.start),
              0
            );
            let gapSeconds = 0;
            for (let index = 1; index < candidate.length; index += 1) {
              const gap = candidate[index].start - candidate[index - 1].end;
              if (gap > 2.5) gapSeconds += gap;
            }
            const fullEnough =
              meta.lengthSeconds > 0
                ? covered / meta.lengthSeconds >= 0.85 &&
                  lastEnd / meta.lengthSeconds >= 0.95 &&
                  gapSeconds <= 5
                : score >= 100;
            if (fullEnough) break;
          } catch {
            // Try the next caption track.
          }
        }
        if (!bestTrack || !fetched.length) {
          setSourceCues([]);
          setStatus('这个视频没有可用字幕，换一个视频试试。');
          return;
        }
        setTrackKey(`${bestTrack.languageCode}:${bestTrack.kind ?? 'manual'}`);
        setSourceCues(fetched);
        setStatus('正在翻译字幕…');
        try {
          const translated = await translateCueList(
            videoId,
            fetched,
            `${bestTrack.languageCode}:${bestTrack.kind ?? 'manual'}`,
            { contextTitle: meta.title, from: bestTrack.languageCode }
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
    followingTranscriptRef.current = true;
    setFollowingTranscript(true);
    transcriptInitializedRef.current = false;
  }, [videoId, trackKey]);

  const scrollTranscriptToActive = (animated = true) => {
    if (!followingTranscriptRef.current) return false;
    const y = cueOffsets.current[activeIndex];
    if (typeof y !== 'number') return false;
    scrollRef.current?.scrollTo({ y, animated });
    return true;
  };

  const maybeResumeTranscriptFollow = (offsetY: number) => {
    if (followingTranscriptRef.current) return;
    const activeY = cueOffsets.current[activeIndex];
    if (typeof activeY !== 'number' || Math.abs(offsetY - activeY) > 24) return;
    followingTranscriptRef.current = true;
    setFollowingTranscript(true);
  };

  const resumeTranscriptFollow = () => {
    followingTranscriptRef.current = true;
    setFollowingTranscript(true);
    transcriptInitializedRef.current = true;
    requestAnimationFrame(() => scrollTranscriptToActive(true));
    setTimeout(() => scrollTranscriptToActive(true), 100);
  };

  useEffect(() => {
    if (activeIndex < 0 || !followingTranscriptRef.current) return;
    const first = !transcriptInitializedRef.current;
    const delays = first ? [0, 120, 320] : [80];
    const timers = delays.map((delay) =>
      setTimeout(() => {
        if (!followingTranscriptRef.current) return;
        if (scrollTranscriptToActive(!first)) {
          transcriptInitializedRef.current = true;
        }
      }, delay)
    );
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [activeIndex, trackKey]);

  useEffect(() => {
    return () => {
      orientationResumeTimers.current.forEach((timer) => clearTimeout(timer));
      orientationResumeTimers.current = [];
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);

  const clearOrientationResume = () => {
    orientationResumeTimers.current.forEach((timer) => clearTimeout(timer));
    orientationResumeTimers.current = [];
  };

  const scheduleOrientationResume = () => {
    clearOrientationResume();
    // Android WebView can lose its playing state while the activity rotates
    // or the window briefly loses focus. Re-check the real <video> element a
    // few times after the new layout settles instead of trusting stale React
    // state.
    [450, 1200, 2400].forEach((delay) => {
      orientationResumeTimers.current.push(
        setTimeout(() => {
          webRef.current?.injectJavaScript(
            'window.__kiss && window.__kiss.resume(); window.__kiss && window.__kiss.audio(); true;'
          );
        }, delay)
      );
    });
  };

  const exitFullscreen = async () => {
    const wasPlaying = playing;
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } catch {}
    setFullscreen(false);
    setControlsVisible(true);
    if (wasPlaying) scheduleOrientationResume();
  };

  const handleFullscreen = async () => {
    setControlsVisible(true);
    const wasPlaying = playing;
    try {
      if (landscape || fullscreen) {
        await exitFullscreen();
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        setFullscreen(true);
        if (wasPlaying) scheduleOrientationResume();
      }
    } catch {}
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (rateSheet) {
        setRateSheet(false);
        return true;
      }
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
        setBlindReveal(false);
        setPrecisionTranslationVisible(true);
        setPrecisionPass(1);
        setPrecisionCueIndex(-1);
        blindGuardRef.current = '';
        if (precisionTimerRef.current) {
          clearTimeout(precisionTimerRef.current);
          precisionTimerRef.current = null;
        }
        return true;
      }
      if (fullscreen || landscape) {
        exitFullscreen();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [blindMode, fullscreen, landscape, modeMenu, rateSheet, sheet]);

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
    // Let the WebView decide from the real <video> state. The React `playing`
    // flag can lag behind after an orientation change and would otherwise send
    // a second pause when the user taps play.
    send('window.__kiss && window.__kiss.toggle(); true;');
    setBlocked(false);
  };

  const handleVideoStageTap = (
    event: any,
    width: number,
    height: number
  ) => {
    const x = Number(event?.nativeEvent?.locationX ?? 0);
    const y = Number(event?.nativeEvent?.locationY ?? 0);
    const stageWidth = width || windowSize.width;
    const stageHeight = height || windowSize.height;
    const centerHit = Math.max(64, Math.min(96, stageWidth * 0.25));
    const inCenter =
      Math.abs(x - stageWidth / 2) <= centerHit / 2 &&
      Math.abs(y - stageHeight / 2) <= centerHit / 2;
    if (inCenter) {
      togglePlay();
      return;
    }
    setControlsVisible((value) => !value);
  };

  const togglePrecisionPlay = () => {
    if (precisionTimerRef.current) {
      clearTimeout(precisionTimerRef.current);
      precisionTimerRef.current = null;
    }
    if (playing) {
      send('window.__kiss && window.__kiss.pause(); true;');
      setPlaying(false);
      setBlocked(false);
      return;
    }
    if (!precisionCue) return;
    if (current >= precisionCue.end - 0.12) {
      seekTo(precisionCue.start + 0.01);
      setPrecisionPass(1);
      blindGuardRef.current = '';
      setBlindReveal(listeningOriginalMode === 'always');
      setPrecisionTranslationVisible(
        listeningTranslationMode === 'always' ||
          (listeningTranslationMode === 'together' &&
            listeningOriginalMode === 'always')
      );
    }
    send('window.__kiss && window.__kiss.play(); true;');
    setPlaying(true);
    setBlocked(false);
  };

  const seekTo = (seconds: number) => {
    const next = Math.max(0, Math.min(duration || seconds, seconds));
    setCurrent(next);
    send(`window.__kiss && window.__kiss.seek(${next}); true;`);
  };

  const seekFromTranscript = (cue: Cue, index: number) => {
    followingTranscriptRef.current = true;
    setFollowingTranscript(true);
    transcriptInitializedRef.current = true;
    seekTo(cue.start);
    setTimeout(() => {
      const y = cueOffsets.current[index];
      if (typeof y === 'number') {
        scrollRef.current?.scrollTo({ y, animated: true });
      }
    }, 80);
  };

  const previewSeekAt = (locationX: number) => {
    if (!duration || !progressWidth) return null;
    const ratio = Math.max(0, Math.min(1, locationX / progressWidth));
    const value = Math.round(ratio * duration * 10) / 10;
    seekPreviewRef.current = value;
    setSeekPreview(value);
    return value;
  };

  const commitPreviewSeek = () => {
    const value = seekPreviewRef.current;
    if (value == null) return;
    seekPreviewRef.current = null;
    seekTo(value);
    setSeekPreview(null);
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

  const jumpPrecisionCue = (direction: -1 | 1) => {
    if (!cues.length) return;
    const base = precisionCueIndex >= 0 ? precisionCueIndex : activeIndex;
    const index = (base < 0 ? 0 : base) + direction;
    if (index < 0 || index >= cues.length) return;
    const target = cues[index];
    if (precisionTimerRef.current) {
      clearTimeout(precisionTimerRef.current);
      precisionTimerRef.current = null;
    }
    setPrecisionCueIndex(index);
    setPrecisionPass(1);
    blindGuardRef.current = '';
    setBlindReveal(listeningOriginalMode === 'always');
    setPrecisionTranslationVisible(
      listeningTranslationMode === 'always' ||
        (listeningTranslationMode === 'together' &&
          listeningOriginalMode === 'always')
    );
    seekTo(target.start + 0.02);
    send('window.__kiss && window.__kiss.play(); true;');
    setPlaying(true);
  };

  const applyRate = (value: number) => {
    const next = Math.min(
      RATE_MAX,
      Math.max(RATE_MIN, Math.round(value * 10) / 10)
    );
    if (Math.abs(next - rate) < 0.001) return;
    setRate(next);
    send(`window.__kiss && window.__kiss.rate(${next}); true;`);
  };

  const openRateSheet = () => {
    setModeMenu(false);
    setRateSheet(true);
  };

  const setSubtitleMode = (mode: SubtitleMode) => {
    patchSettings({ subtitle: { ...settings.subtitle, mode } });
    setModeMenu(false);
  };

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
    if (!blindMode || !precisionCue || !playing) return;
    if (current <= precisionCue.end + 0.08) return;
    const guardKey = `${precisionCue.start.toFixed(2)}-${precisionPass}`;
    if (blindGuardRef.current === guardKey) return;
    blindGuardRef.current = guardKey;

    send('window.__kiss && window.__kiss.pause(); true;');
    setPlaying(false);

    if (precisionPass < listeningRepeatCount) {
      precisionTimerRef.current = setTimeout(() => {
        seekTo(precisionCue.start + 0.01);
        setPrecisionPass((value) => value + 1);
        send('window.__kiss && window.__kiss.play(); true;');
        setPlaying(true);
      }, listeningRepeatInterval * 1000);
      return;
    }

    if (listeningOriginalMode === 'after') {
      setBlindReveal(true);
      if (listeningTranslationMode !== 'tap') {
        setPrecisionTranslationVisible(true);
      }
    }

    if (settings.subtitle.autoNext) {
      precisionTimerRef.current = setTimeout(() => {
        jumpPrecisionCue(1);
      }, Math.max(1200, listeningRepeatInterval * 1000));
    }
  }, [
    blindMode,
    current,
    listeningOriginalMode,
    listeningRepeatCount,
    listeningRepeatInterval,
    listeningTranslationMode,
    playing,
    precisionCue,
    precisionPass,
    settings.subtitle.autoNext,
  ]);

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
      if (typeof message.ad === 'boolean') setAdShowing(message.ad);
      if (message.quality) setQuality(String(message.quality));
      if (message.ready) setReady(true);
      return;
    }
    if (message.type === 'problem') {
      setReady(false);
      setAdShowing(false);
      setVideoProblem('这个视频限制了站内播放，可能需要登录、年龄验证或作者关闭了外站播放。');
    }
  };

  const retry = () => {
    setVideoProblem('');
    setReady(false);
    setAdShowing(false);
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
    setToast(added ? '已收藏视频' : '已取消视频收藏');
  };

  const toggleCueFavorite = (cue: Cue) => {
    const added = toggleSentenceFavorite({
      id: sentenceFavoriteId(videoId, cue.start),
      videoId,
      videoTitle: metaTitle || initialTitle || videoId,
      videoAuthor: metaAuthor || initialAuthor,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      start: cue.start,
      end: cue.end,
      text: cue.text,
      translation: cue.translation,
      savedAt: Date.now(),
    });
    setToast(added ? '已收藏这句' : '已取消句子收藏');
  };

  const exitPrecision = () => {
    setBlindMode(false);
    setBlindReveal(false);
    setPrecisionTranslationVisible(true);
    setPrecisionPass(1);
    setPrecisionCueIndex(-1);
    blindGuardRef.current = '';
    if (precisionTimerRef.current) {
      clearTimeout(precisionTimerRef.current);
      precisionTimerRef.current = null;
    }
  };

  const enterPrecision = () => {
    const targetIndex = activeCue
      ? activeIndex
      : cues.length
        ? 0
        : -1;
    const target = targetIndex >= 0 ? cues[targetIndex] : null;
    setPrecisionCueIndex(targetIndex);
    precisionStartedAtRef.current = Date.now();
    setPrecisionElapsed(0);
    setPrecisionPass(1);
    blindGuardRef.current = '';
    setBlindReveal(listeningOriginalMode === 'always');
    setPrecisionTranslationVisible(
      listeningTranslationMode === 'always' ||
        (listeningTranslationMode === 'together' &&
          listeningOriginalMode === 'always')
    );
    setBlindMode(true);
    if (!target) return;
    seekTo(target.start + 0.02);
    if (!playing) {
      send('window.__kiss && window.__kiss.play(); true;');
      setPlaying(true);
    }
  };

  const togglePrecision = () => {
    if (blindMode) exitPrecision();
    else enterPrecision();
  };

  const togglePrecisionOriginal = () => {
    if (blindReveal) {
      setBlindReveal(false);
      return;
    }
    setBlindReveal(true);
    setPrecisionTranslationVisible(true);
  };

  const revealPrecisionText = () => {
    if (!blindReveal || !precisionTranslationVisible) {
      setBlindReveal(true);
      setPrecisionTranslationVisible(true);
    }
  };

  const togglePrecisionTranslation = () => {
    setPrecisionTranslationVisible((value) => !value);
  };

  const getConfiguredAiConfig = async (): Promise<AiConfig | null> => {
    const currentSettings = getSettings();
    const [deepseekKey, siliconflowKey, openaiKey] = await Promise.all([
      getSecret('deepseek'),
      getSecret('siliconflow'),
      getSecret('openai'),
    ]);
    const candidates: Array<AiConfig | null> = [
      currentSettings.provider === 'deepseek' && deepseekKey
        ? deepseekConfig(
            deepseekKey,
            currentSettings.deepseekModel,
            currentSettings.requestTimeoutMs
          )
        : null,
      currentSettings.provider === 'siliconflow' && siliconflowKey
        ? siliconflowConfig(
            siliconflowKey,
            currentSettings.siliconflowModel,
            currentSettings.requestTimeoutMs
          )
        : null,
      currentSettings.provider === 'openai' && openaiKey
        ? openaiConfig(
            openaiKey,
            currentSettings.openaiBaseUrl,
            currentSettings.openaiModel,
            currentSettings.requestTimeoutMs
          )
        : null,
    ];
    const preferred = candidates.find(Boolean);
    if (preferred) return preferred;
    if (deepseekKey) {
      return deepseekConfig(
        deepseekKey,
        currentSettings.deepseekModel,
        currentSettings.requestTimeoutMs
      );
    }
    if (siliconflowKey) {
      return siliconflowConfig(
        siliconflowKey,
        currentSettings.siliconflowModel,
        currentSettings.requestTimeoutMs
      );
    }
    if (openaiKey) {
      return openaiConfig(
        openaiKey,
        currentSettings.openaiBaseUrl,
        currentSettings.openaiModel,
        currentSettings.requestTimeoutMs
      );
    }
    return null;
  };

  const analyzeCurrentCue = async () => {
    if (analysisLoading) return;
    const cue = precisionCue ?? activeCue;
    if (!cue) {
      setToast('当前还没有可分析的对话');
      return;
    }
    const config = await getConfiguredAiConfig();
    if (!config) {
      Alert.alert(
        '未配置 AI API',
        '请先在翻译设置中填写 DeepSeek、SiliconFlow 或 OpenAI 的 API Key。',
        [
          { text: '知道了', style: 'cancel' },
          {
            text: '去配置',
            onPress: () => router.push('/settings/translation' as any),
          },
        ]
      );
      return;
    }
    setAnalysisCue(cue);
    setAnalysisText('');
    setAnalysisError('');
    setAnalysisLoading(true);
    setSheetParent('listening');
    setSheetPanel('analysis');
    setSheet(true);
    try {
      const result = await aiAnalyzeSentence(
        config,
        cue.text,
        cue.translation ?? '',
        metaTitle
      );
      setAnalysisText(result);
    } catch (error) {
      setAnalysisError(
        error instanceof Error ? error.message : 'AI 分析失败，请稍后重试'
      );
    } finally {
      setAnalysisLoading(false);
    }
  };

  const placeModeMenuNear = (button: any) => {
    if (!button || typeof button.measureInWindow !== 'function') {
      setModeMenu(true);
      return;
    }
    button.measureInWindow((x: number, y: number, width: number, height: number) => {
      const menuWidth = 168;
      const menuHeight = 152;
      const gap = 6;
      const left = Math.max(
        10,
        Math.min(windowSize.width - menuWidth - 10, x + width / 2 - menuWidth / 2)
      );
      const top = y + height + gap;
      if (top + menuHeight <= windowSize.height - 10) {
        setModeAnchor({ left, top });
      } else {
        setModeAnchor({
          left,
          bottom: Math.max(10, windowSize.height - (y - gap)),
        });
      }
      setModeMenu(true);
    });
  };

  const openSubtitleModeMenu = () => placeModeMenuNear(subtitleButtonRef.current);
  const openLandscapeModeMenu = () => placeModeMenuNear(landscapeCcButtonRef.current);

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
  const rateLabel = Number.isInteger(rate) ? `${rate}x` : `${rate.toFixed(1)}x`;
  const defaultRate = Math.abs(rate - 1) < 0.001;
  const nativeVideo = Platform.OS !== 'web';
  const videoTappable =
    nativeVideo &&
    ready &&
    !videoLoading &&
    !videoProblem &&
    !adShowing &&
    !blindMode &&
    !hideVideo;
  const webUrl = `https://m.youtube.com/watch?v=${videoId}&hl=zh-CN&autoplay=0`;

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
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setVideoStageSize((current) =>
          current.width === width && current.height === height
            ? current
            : { width, height }
        );
      }}
      style={
        landscape
          ? styles.landscapeVideo
          : hideVideo
            ? styles.videoFrameHidden
            : [styles.videoFrame, { aspectRatio: 16 / 9 }]
      }
    >
      {nativeVideo ? (
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
          javaScriptCanOpenWindowsAutomatically={false}
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
            armVideoLoadingFallback();
          }}
          onError={() => {
            clearVideoLoadingTimer();
            setReady(false);
            setVideoLoading(false);
            setVideoProblem('播放器加载失败，请检查网络后重试，或在浏览器中打开该视频。');
          }}
          onOpenWindow={() => {
            // Ads frequently call window.open() for their landing page.
            // Keep all navigation inside the watch WebView.
          }}
          onShouldStartLoadWithRequest={(request: any) => {
            const url = String(request.url || '');
            if (url.startsWith('about:')) return true;
            const adRedirect =
              /googlesyndication\.com|doubleclick\.net|googleadservices\.com|\/pagead\/|\/aclk|google\.com\/url\?|youtube\.com\/redirect\?/i.test(
                url
              );
            if (adRedirect) return false;
            try {
              const hostMatch = url.match(/^https:\/\/([^/?#]+)/i);
              const host = hostMatch
                ? hostMatch[1].toLowerCase().replace(/:\d+$/, '')
                : '';
              const allowedHosts = new Set([
                'www.youtube.com',
                'youtube.com',
                'm.youtube.com',
                'consent.youtube.com',
                'accounts.youtube.com',
                'accounts.google.com',
                'www.google.com',
                'google.com',
                'consent.google.com',
              ]);
              if (host && allowedHosts.has(host)) return true;
            } catch {}
            // Never hand off ad redirects (googlesyndication.com,
            // doubleclick.net, googleadservices.com, custom schemes, etc.)
            // to the system browser. Returning false drops the navigation.
            return false;
          }}
        />
      ) : (
        <View style={styles.webVideoFallback}>
          <View style={styles.webVideoFallbackIcon}>
            <Ionicons name="videocam-off-outline" size={25} color="#D8CFEA" />
          </View>
          <Text style={styles.webVideoFallbackTitle}>网页预览不支持 YouTube 视频</Text>
          <Text style={styles.webVideoFallbackText}>请在 Kissly 手机 App 内播放</Text>
        </View>
      )}
      {!landscape && videoTappable ? (
        <Pressable
          style={[StyleSheet.absoluteFill, { zIndex: 2 }]}
          onPress={(event) =>
            handleVideoStageTap(event, videoStageSize.width, videoStageSize.height)
          }
        />
      ) : null}
      {videoLoading && !hideVideo && nativeVideo ? (
        <View style={styles.videoLoading} pointerEvents="none">
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={styles.videoLoadingText}>
            {'正在连接 YouTube…'}
          </Text>
        </View>
      ) : null}
      {!landscape && videoTappable && controlsVisible ? (
        <Pressable style={styles.centerPlay} onPress={togglePlay}>
          <Ionicons name={playing ? 'pause' : 'play'} size={34} color="#FFFFFF" />
        </Pressable>
      ) : null}
      {!landscape && !hideVideo && !blindMode && !adShowing && nativeVideo && controlsVisible ? (
        <View style={styles.qualityChip} pointerEvents="none">
          <Text style={styles.qualityChipText}>
            {quality ? quality.toUpperCase() : 'HD1080'} · 优先
          </Text>
        </View>
      ) : null}
      {!landscape &&
      !hideVideo &&
      !blindMode &&
      !adShowing &&
      !videoProblem &&
      nativeVideo &&
      controlsVisible ? (
        <Pressable
          onPress={handleFullscreen}
          hitSlop={10}
          style={styles.videoFullscreen}
        >
          <Ionicons name="resize-outline" size={20} color="#FFFFFF" />
        </Pressable>
      ) : null}
      {videoProblem && !hideVideo && nativeVideo ? (
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
      pointerEvents={blindMode ? 'none' : 'auto'}
      onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => {
        previewSeekAt(event.nativeEvent.locationX);
      }}
      onResponderMove={(event) => {
        previewSeekAt(event.nativeEvent.locationX);
      }}
      onResponderRelease={() => commitPreviewSeek()}
      onResponderTerminate={() => commitPreviewSeek()}
      onResponderTerminationRequest={() => false}
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
      <Pressable
        onPress={openRateSheet}
        hitSlop={8}
        style={styles.speedButton}
        accessibilityLabel={`播放速度 ${rateLabel}`}
      >
        <SpeedIcon color={theme.colors.textSecondary} size={32} />
        {!defaultRate ? (
          <View
            style={[
              styles.speedBadge,
              { backgroundColor: theme.colors.primary },
            ]}
          >
            <Text style={styles.speedBadgeText}>{rateLabel}</Text>
          </View>
        ) : null}
      </Pressable>
      <RipplePressable
        onPress={() => (blindMode ? jumpPrecisionCue(-1) : jumpCue(-1))}
        hitSlop={10}
        style={styles.transportSmall}
      >
        <Ionicons name="play-skip-back" size={22} color={theme.colors.textSecondary} />
      </RipplePressable>
      <RipplePressable
        onPress={blindMode ? togglePrecisionPlay : togglePlay}
        style={[styles.playButton, { backgroundColor: theme.colors.primary }]}
      >
        <Ionicons name={playing ? 'pause' : 'play'} size={24} color="#FFFFFF" />
      </RipplePressable>
      <RipplePressable
        onPress={() => (blindMode ? jumpPrecisionCue(1) : jumpCue(1))}
        hitSlop={10}
        style={styles.transportSmall}
      >
        <Ionicons name="play-skip-forward" size={22} color={theme.colors.textSecondary} />
      </RipplePressable>
      {blindMode ? (
        <Pressable
          onPress={togglePrecisionOriginal}
          hitSlop={8}
          accessibilityLabel={blindReveal ? '隐藏原文' : '显示原文和译文'}
          style={[
            styles.loopButton,
            blindReveal && { backgroundColor: theme.colors.primarySoft },
          ]}
        >
          <Ionicons
            name={blindReveal ? 'eye' : 'eye-off-outline'}
            size={21}
            color={blindReveal ? theme.colors.primary : theme.colors.textTertiary}
          />
        </Pressable>
      ) : (
        <Pressable
          onPress={() => setLoopSentence((value) => !value)}
          hitSlop={8}
          accessibilityLabel={loopSentence ? '关闭单句循环' : '开启单句循环'}
          style={styles.loopButton}
        >
          <LoopIcon
            color={loopSentence ? theme.colors.primary : theme.colors.textTertiary}
            barColor={loopSentence ? theme.colors.text : theme.colors.textTertiary}
            size={24}
          />
        </Pressable>
      )}
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
      {!blindMode ? progress : null}
      {!blindMode ? timeRow : null}
      {transport}
      {blindMode ? (
        <View style={styles.precisionActions}>
          <Pressable
            style={styles.precisionAction}
            onPress={analyzeCurrentCue}
            accessibilityLabel="AI 对话分析"
          >
            <Ionicons name="sparkles-outline" size={23} color={theme.colors.textSecondary} />
          </Pressable>
          <Pressable
            style={styles.precisionAction}
            onPress={togglePrecisionTranslation}
            accessibilityLabel="显示或隐藏译文"
          >
            <Ionicons
              name="language"
              size={23}
              color={
                precisionTranslationVisible
                  ? theme.colors.primary
                  : theme.colors.textSecondary
              }
            />
          </Pressable>
          <Pressable
            style={[
              styles.precisionAction,
              styles.precisionActionActive,
              { backgroundColor: theme.colors.primarySoft },
            ]}
            onPress={exitPrecision}
            accessibilityLabel="退出精听"
          >
            <Ionicons name="headset" size={24} color={theme.colors.primary} />
          </Pressable>
          <Pressable
            style={styles.precisionAction}
            onPress={() => precisionCue && toggleCueFavorite(precisionCue)}
            accessibilityLabel="收藏当前句"
          >
            <Ionicons
              name={precisionCueSaved ? 'heart' : 'heart-outline'}
              size={23}
              color={precisionCueSaved ? theme.colors.primary : theme.colors.textSecondary}
            />
          </Pressable>
        </View>
      ) : (
        <View style={styles.bottomActions}>
          <Pressable
            ref={subtitleButtonRef}
            collapsable={false}
            style={styles.action}
            onPress={openSubtitleModeMenu}
          >
            <Ionicons
              name={subtitleModeOption(subtitleMode).icon}
              size={22}
              color={theme.colors.textSecondary}
            />
            <Text style={[styles.actionLabel, { color: theme.colors.textSecondary }]}>字幕</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={saveFavorite}>
            <Ionicons
              name={isFavorite ? 'bookmark' : 'bookmark-outline'}
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
          <Pressable style={styles.action} onPress={togglePrecision}>
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
              精听
            </Text>
          </Pressable>
          <Pressable style={styles.action} onPress={handleFullscreen}>
            <Ionicons name="resize-outline" size={23} color={theme.colors.textSecondary} />
            <Text style={[styles.actionLabel, { color: theme.colors.textSecondary }]}>全屏</Text>
          </Pressable>
        </View>
      )}
    </View>
  ) : null;

  const landscapeOverlay = landscape ? (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(event) =>
          handleVideoStageTap(event, windowSize.width, windowSize.height)
        }
      />
      {controlsVisible ? (
        <>
          <View style={[styles.landTop, { paddingTop: Math.max(8, insets.top) }]}>
            <Squircle
              fill="rgba(18,15,23,0.55)"
              exponent={4}
              style={styles.landProgressPill}
            >
              <Text style={styles.landTime}>{formatTime(seekPreview ?? current)}</Text>
              <View
                style={styles.landProgressTouch}
                onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(event) => {
                  previewSeekAt(event.nativeEvent.locationX);
                }}
                onResponderMove={(event) => {
                  previewSeekAt(event.nativeEvent.locationX);
                }}
                onResponderRelease={() => commitPreviewSeek()}
                onResponderTerminate={() => commitPreviewSeek()}
                onResponderTerminationRequest={() => false}
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
            </Squircle>
            <RipplePressable
              pressableRef={landscapeCcButtonRef}
              collapsable={false}
              haptic={false}
              onPress={openLandscapeModeMenu}
              style={styles.landIconButton}
            >
              <MaterialCommunityIcons
                name="closed-caption-outline"
                size={22}
                color="#FFFFFF"
              />
            </RipplePressable>
            <RipplePressable
              haptic={false}
              onPress={openRateSheet}
              style={styles.landTopRatePill}
            >
              <Text style={styles.landRateText}>{rateLabel}</Text>
            </RipplePressable>
            <RipplePressable
              haptic={false}
              onPress={exitFullscreen}
              style={styles.landIconButton}
            >
              <Ionicons name="resize-outline" size={18} color="#FFFFFF" />
            </RipplePressable>
            <RipplePressable
              haptic={false}
              onPress={blindMode ? openListeningSettings : openMainSettings}
              style={styles.landIconButton}
            >
              <Ionicons name="ellipsis-horizontal" size={19} color="#FFFFFF" />
            </RipplePressable>
          </View>

          <View style={styles.landCenter}>
            <Pressable
              onPress={() => {
                controlHaptic();
                jumpCue(-1);
              }}
              style={styles.landTransportButton}
            >
              <Ionicons name="play-skip-back" size={18} color="#FFFFFF" />
            </Pressable>
            <Pressable
              onPress={() => {
                controlHaptic();
                togglePlay();
              }}
              style={styles.landPlay}
            >
              <Ionicons name={playing ? 'pause' : 'play'} size={30} color="#FFFFFF" />
            </Pressable>
            <Pressable
              onPress={() => {
                controlHaptic();
                jumpCue(1);
              }}
              style={styles.landTransportButton}
            >
              <Ionicons name="play-skip-forward" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </>
      ) : null}

      {activeCue ? (
        <View
          style={[
            styles.landSubWrap,
            {
              bottom: controlsVisible ? Math.max(28, insets.bottom + 18) : Math.max(20, insets.bottom + 12),
            },
          ]}
          pointerEvents="none"
        >
          <Squircle
            fill={
              controlsVisible
                ? 'rgba(16,13,24,0.6)'
                : 'rgba(0,0,0,0.28)'
            }
            exponent={4}
            style={styles.landSubBox}
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
                numberOfLines={3}
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
                numberOfLines={3}
              >
                {activeCue.translation}
              </Text>
            ) : null}
          </Squircle>
        </View>
      ) : null}
    </View>
  ) : null;

  const transcript = (
    <View style={styles.transcriptWrap}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 0, paddingBottom: 240 }}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical
        scrollEventThrottle={16}
        onScroll={(event) => {
          transcriptScrollRef.current = event.nativeEvent.contentOffset.y;
        }}
        onScrollBeginDrag={() => {
          followingTranscriptRef.current = false;
          setFollowingTranscript(false);
        }}
        onMomentumScrollEnd={(event) => {
          maybeResumeTranscriptFollow(event.nativeEvent.contentOffset.y);
        }}
        onContentSizeChange={() => {
          if (!followingTranscriptRef.current || transcriptInitializedRef.current) return;
          requestAnimationFrame(() => scrollTranscriptToActive(false));
        }}
        onLayout={(event) => {
          transcriptHeightRef.current = event.nativeEvent.layout.height;
          if (!followingTranscriptRef.current) return;
          requestAnimationFrame(() => scrollTranscriptToActive(false));
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
            const saved = active
              ? sentenceFavorites.some((fav) => fav.id === sentenceFavoriteId(videoId, cue.start))
              : false;
            return (
              <View
                key={`${cue.start}-${index}`}
                onLayout={(event) => {
                  cueOffsets.current[index] = event.nativeEvent.layout.y;
                  if (index === activeIndex && followingTranscriptRef.current) {
                    const y = event.nativeEvent.layout.y;
                    const animated = transcriptInitializedRef.current;
                    transcriptInitializedRef.current = true;
                    requestAnimationFrame(() => {
                      if (followingTranscriptRef.current) {
                        scrollRef.current?.scrollTo({ y, animated });
                      }
                    });
                  }
                }}
                style={styles.cue}
              >
                {active ? (
                  <View style={styles.cueHeader}>
                    <Pressable
                      onPress={() => seekFromTranscript(cue, index)}
                      hitSlop={6}
                      accessibilityLabel="跳到本句"
                    >
                      <Text style={[styles.cueTime, { color: theme.colors.primary }]}>
                        {formatTime(cue.start)}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => toggleCueFavorite(cue)}
                      hitSlop={8}
                      accessibilityLabel={saved ? '取消收藏这句' : '收藏这句'}
                      style={styles.cueHeart}
                    >
                      <Ionicons
                        name={saved ? 'heart' : 'heart-outline'}
                        size={22}
                        color={saved ? theme.colors.primary : theme.colors.textTertiary}
                      />
                    </Pressable>
                  </View>
                ) : null}
                <Pressable onPress={() => seekFromTranscript(cue, index)}>
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
                        !active && (past ? styles.cuePastOriginal : styles.cueFutureOriginal),
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
                        !active && (past ? styles.cuePastTranslation : styles.cueFutureTranslation),
                      ]}
                    >
                      {cue.translation}
                    </Text>
                  ) : null}
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
      {!followingTranscript && activeCue ? (
        <Pressable
          onPress={resumeTranscriptFollow}
          style={[
            styles.followCurrentButton,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
            },
          ]}
          accessibilityLabel="回到当前播放句"
        >
          <Ionicons name="locate-outline" size={15} color={theme.colors.primary} />
          <Text style={[styles.followCurrentText, { color: theme.colors.primary }]}>
            回到当前
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  const listeningOriginalLabel =
    listeningOriginalMode === 'always'
      ? '一开始就显示'
      : listeningOriginalMode === 'after'
        ? '听完自动显示'
        : '听完轻点显示';
  const listeningTranslationLabel =
    listeningTranslationMode === 'always'
      ? '始终显示'
      : listeningTranslationMode === 'together'
        ? '和原文一起'
        : '轻点显示';
  const listeningFontLabel = fontSize >= 26 ? '超大' : fontSize >= 20 ? '大' : '标准';
  const precisionWords = precisionCue
    ? precisionCue.text.split(/\s+/).filter(Boolean)
    : [];

  const blindCard = (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 2 }}>
      <Pressable
        onPress={revealPrecisionText}
        style={{
          flex: 1,
          backgroundColor: theme.colors.card,
          borderRadius: 22,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: 16,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Ionicons name="time-outline" size={15} color={theme.colors.textSecondary} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
            {formatTime(precisionElapsed)}
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
              精听 {precisionPass}/{listeningRepeatCount}
            </Text>
          </View>
        </View>

        {precisionCue ? (
          <View style={{ flex: 1, marginTop: 22 }}>
            {blindReveal ? (
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: Math.max(20, Math.min(30, fontSize + 4)),
                  lineHeight: Math.max(29, Math.min(43, fontSize + 13)),
                  fontFamily: originalFont,
                  fontWeight: originalWeight,
                }}
              >
                {precisionCue.text}
              </Text>
            ) : (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  columnGap: 7,
                  rowGap: 9,
                }}
              >
                {precisionWords.map((word, index) => (
                  <View
                    key={`${word}-${index}`}
                    style={{
                      height: 18,
                      width: Math.max(18, Math.min(74, word.replace(/[^\w'-]/g, '').length * 7.2)),
                      borderRadius: 9,
                      backgroundColor: theme.colors.border,
                    }}
                  />
                ))}
              </View>
            )}

            {precisionTranslationVisible && precisionCue.translation ? (
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: Math.max(15, fontSize - 3),
                  lineHeight: Math.max(23, fontSize + 4),
                  marginTop: blindReveal ? 14 : 24,
                  fontFamily: translationFont,
                  fontWeight: translationWeight,
                }}
              >
                {precisionCue.translation}
              </Text>
            ) : null}

            {!blindReveal || !precisionTranslationVisible ? (
              <Text
                style={{
                  color: theme.colors.textTertiary,
                  fontSize: 12,
                  marginTop: 22,
                }}
              >
                {!blindReveal
                  ? precisionTranslationVisible
                    ? '轻点显示原文'
                    : '轻点显示原文和译文'
                  : '轻点显示译文'}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={{ color: theme.colors.textTertiary, fontSize: 14 }}>
              播放到有字幕的位置后会自动出现。
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );

  const ratePercent = Math.max(
    0,
    Math.min(100, ((rate - RATE_MIN) / (RATE_MAX - RATE_MIN)) * 100)
  );

  const rateSheetOverlay = () => (
    <View style={[styles.rateSheetMask, landscape && styles.rateSheetMaskLandscape]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setRateSheet(false)} />
      <View
        style={[
          styles.rateSheetCard,
          landscape && styles.rateSheetCardLandscape,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            paddingBottom: Math.max(18, insets.bottom + 10),
          },
        ]}
      >
        <View style={[styles.sheetHandle, { backgroundColor: theme.colors.border }]} />
        <Text style={[styles.rateSheetTitle, { color: theme.colors.text }]}>调节播放速度</Text>
        <View style={styles.ratePresetRow}>
          {RATE_PRESETS.map((preset) => {
            const active = Math.abs(rate - preset) < 0.001;
            return (
              <Pressable
                key={preset}
                onPress={() => applyRate(preset)}
                style={[
                  styles.ratePreset,
                  {
                    backgroundColor: theme.colors.surfaceAlt,
                    borderColor: theme.colors.border,
                  },
                  active && {
                    backgroundColor: theme.colors.primary,
                    borderColor: theme.colors.primary,
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? '#FFFFFF' : theme.colors.textSecondary,
                    fontSize: 12.5,
                    fontWeight: '800',
                  }}
                >
                  {preset}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.rateSliderRow}>
          <Text style={[styles.rateEndLabel, { color: theme.colors.textSecondary }]}>0.5x</Text>
          <View
            style={styles.rateSliderTrack}
            onLayout={(event) => {
              rateTrackWidthRef.current = event.nativeEvent.layout.width;
            }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(event) => {
              const width = rateTrackWidthRef.current;
              if (width <= 0) return;
              applyRate(
                RATE_MIN +
                  (event.nativeEvent.locationX / width) * (RATE_MAX - RATE_MIN)
              );
            }}
            onResponderMove={(event) => {
              const width = rateTrackWidthRef.current;
              if (width <= 0) return;
              applyRate(
                RATE_MIN +
                  (event.nativeEvent.locationX / width) * (RATE_MAX - RATE_MIN)
              );
            }}
          >
            <View
              pointerEvents="none"
              style={[styles.rateSliderRail, { backgroundColor: theme.colors.surfaceAlt }]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.rateSliderFill,
                { width: `${ratePercent}%`, backgroundColor: theme.colors.primary },
              ]}
            />
            {RATE_DOTS.map((dot) => (
              <View
                key={dot}
                pointerEvents="none"
                style={[
                  styles.rateSliderDot,
                  {
                    left: `${((dot - RATE_MIN) / (RATE_MAX - RATE_MIN)) * 100}%`,
                    backgroundColor: theme.colors.border,
                  },
                ]}
              />
            ))}
            <View
              pointerEvents="none"
              style={[
                styles.rateSliderThumb,
                {
                  left: `${ratePercent}%`,
                  backgroundColor: theme.colors.primary,
                },
              ]}
            />
          </View>
          <Text style={[styles.rateEndLabel, { color: theme.colors.textSecondary }]}>2x</Text>
        </View>
        <Text style={[styles.rateValueLabel, { color: theme.colors.text }]}>{rateLabel}</Text>
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
        {blindMode ? (
          <>
            <Pressable
              style={[styles.headerPlain, { width: 76, flexDirection: 'row', gap: 3 }]}
              onPress={exitPrecision}
              hitSlop={10}
            >
              <Ionicons name="arrow-back" size={23} color={theme.colors.text} />
              <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}>
                退出
              </Text>
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <View
                style={{
                  backgroundColor: theme.colors.surfaceAlt,
                  borderRadius: 999,
                  paddingHorizontal: 16,
                  paddingVertical: 7,
                }}
              >
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }}>
                  {precisionPosition} / {cues.length}
                </Text>
              </View>
            </View>
            <Pressable
              style={styles.headerPlain}
              onPress={openListeningSettings}
              hitSlop={10}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.text} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable style={styles.headerPlain} onPress={() => router.back()} hitSlop={10}>
              <Ionicons name="arrow-back" size={23} color={theme.colors.text} />
            </Pressable>
            <View style={{ flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 6 }}>
              {!hideTitle ? (
                <>
                  <Text
                    style={[styles.headerTitle, { color: theme.colors.text }]}
                    numberOfLines={1}
                  >
                    {displayTitle}
                  </Text>
                  {displayAuthor || showTranslation ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        maxWidth: '100%',
                        marginTop: 2,
                      }}
                    >
                      {displayAuthor ? (
                        <Text
                          style={[
                            styles.headerSubtitle,
                            { color: theme.colors.textTertiary, marginTop: 0, flexShrink: 1 },
                          ]}
                          numberOfLines={1}
                        >
                          {displayAuthor}
                        </Text>
                      ) : null}
                      {showTranslation ? (
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.headerProvider,
                            { color: theme.colors.textTertiary, flexShrink: 1 },
                            displayAuthor ? { marginLeft: 5 } : null,
                          ]}
                        >
                          {displayAuthor ? '· ' : ''}译 · {providerLabel || '机器翻译'}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </>
              ) : showTranslation ? (
                <Text
                  numberOfLines={1}
                  style={[styles.headerProvider, { color: theme.colors.textTertiary }]}
                >
                  译 · {providerLabel || '机器翻译'}
                </Text>
              ) : null}
            </View>
            <Pressable
              style={styles.headerPlain}
              onPress={openMainSettings}
              hitSlop={10}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.text} />
            </Pressable>
          </>
        )}
      </View>

      {videoBlock}

      {!landscape ? (
        <View style={{ flex: 1 }}>
          {blindMode ? (
            <View style={{ paddingHorizontal: 18, paddingTop: 10 }}>
              {progress}
            </View>
          ) : null}
          {blindMode ? (
            blindCard
          ) : (
            <>
              {status ? (
                <View style={styles.transcriptHeader}>
                  <View style={{ flex: 1 }} />
                  <View style={styles.statusRow}>
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                    <Text
                      style={[styles.statusText, { color: theme.colors.textTertiary }]}
                      numberOfLines={1}
                    >
                      {status}
                    </Text>
                  </View>
                </View>
              ) : null}
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

      {rateSheet ? rateSheetOverlay() : null}

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
    const menuWidth = 168;
    return (
      <View style={styles.modeMask}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setModeMenu(false)} />
        <View
          style={[
            styles.modePopover,
            {
              left: modeAnchor.left,
              width: menuWidth,
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
            },
            modeAnchor.top !== undefined
              ? { top: modeAnchor.top }
              : { bottom: modeAnchor.bottom ?? 100 },
          ]}
        >
          {SUBTITLE_MODE_OPTIONS.map((option) => {
            const active = subtitleMode === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => setSubtitleMode(option.id)}
                style={[
                  styles.modeRow,
                  active && { backgroundColor: theme.colors.primarySoft },
                ]}
              >
                <Ionicons
                  name={option.icon}
                  size={19}
                  color={active ? theme.colors.primary : theme.colors.textSecondary}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.modeRowLabel,
                    {
                      color: active ? theme.colors.primary : theme.colors.text,
                      fontWeight: active ? '800' : '600',
                    },
                  ]}
                >
                  {option.label}
                </Text>
                {active ? (
                  <Ionicons name="checkmark" size={17} color={theme.colors.primary} />
                ) : null}
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
      listeningOriginal: '原文',
      listeningTranslation: '翻译',
      listeningRepeat: '每句播放遍数',
      listeningInterval: '每遍间隔',
      analysis: 'AI 对话分析',
    };
    const listeningSheet =
      sheetParent === 'listening' ||
      sheetPanel === 'listening' ||
      sheetPanel === 'listeningOriginal' ||
      sheetPanel === 'listeningTranslation' ||
      sheetPanel === 'listeningRepeat' ||
      sheetPanel === 'listeningInterval' ||
      sheetPanel === 'analysis';
    const centeredSheet = landscape;
    const rootPanel =
      sheetPanel === 'main' || sheetPanel === 'listening' || sheetPanel === 'analysis';
    return (
      <View
        style={[
          styles.sheetMask,
          centeredSheet && { justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 14 },
        ]}
        pointerEvents="box-none"
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheet(false)} />
        <View
          style={[
            styles.sheetCard,
            { backgroundColor: theme.colors.card },
            centeredSheet
              ? {
                  alignSelf: 'center',
                  width: Math.min(720, Math.round(windowSize.width * 0.66)),
                  height: Math.min(640, Math.round(windowSize.height * 0.88)),
                  borderRadius: 26,
                  borderBottomLeftRadius: 26,
                  borderBottomRightRadius: 26,
                  paddingTop: 14,
                  paddingBottom: Math.max(14, insets.bottom),
                }
              : {
                  maxHeight: listeningSheet ? '80%' : '92%',
                  paddingBottom: Math.max(24, insets.bottom),
                },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Pressable
              onPress={() => {
                if (rootPanel) setSheet(false);
                else setSheetPanel(sheetParent);
              }}
              style={[styles.sheetHeaderButton, { backgroundColor: theme.colors.surfaceAlt }]}
            >
              <Ionicons
                name={rootPanel ? 'close' : 'arrow-back'}
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
            {sheetPanel === 'main' && !landscape ? (
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
                    onPress={() => openSheetPanel('scroll', 'main')}
                  />
                  <SheetRow
                    icon="cut-outline"
                    title="断句模式"
                    value={settings.subtitle.sentenceMode === 'smart' ? '智能断句' : '整句'}
                    onPress={() => openSheetPanel('sentence', 'main')}
                  />
                  <SheetRow
                    icon="text-outline"
                    title="字体大小"
                    value={`${fontSize} / ${landscapeFontSize}`}
                    onPress={() => {
                      setFontSizeTarget(landscape ? 'landscape' : 'portrait');
                      openSheetPanel('fontSize', 'main');
                    }}
                  />
                  <SheetRow
                    icon="brush-outline"
                    title="字体"
                    value="默认"
                    onPress={() => openSheetPanel('font', 'main')}
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
                    icon="text-outline"
                    title="隐藏标题"
                    right={
                      <SwitchPill
                        value={hideTitle}
                        onPress={() =>
                          patchSettings({
                            subtitle: { ...settings.subtitle, hideTitle: !hideTitle },
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
                    icon="bookmark-outline"
                    title={isFavorite ? '取消收藏' : '收藏视频'}
                    hideChevron
                    right={
                      <Ionicons
                        name={isFavorite ? 'bookmark' : 'bookmark-outline'}
                        size={19}
                        color={theme.colors.textSecondary}
                      />
                    }
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

            {sheetPanel === 'main' && landscape ? (
              <>
                <View style={[styles.sheetGroup, { backgroundColor: theme.colors.surfaceAlt }]}>
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
                    icon="cut-outline"
                    title="断句模式"
                    value={settings.subtitle.sentenceMode === 'smart' ? '智能断句' : '整句'}
                    onPress={() => openSheetPanel('sentence', 'main')}
                  />
                  <SheetRow
                    icon="text-outline"
                    title="字体大小"
                    value={`${landscapeFontSize}px`}
                    onPress={() => {
                      setFontSizeTarget('landscape');
                      openSheetPanel('fontSize', 'main');
                    }}
                  />
                </View>

                <View style={[styles.sheetGroup, { backgroundColor: theme.colors.surfaceAlt }]}>
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
                    icon="bookmark-outline"
                    title={isFavorite ? '取消收藏' : '收藏视频'}
                    hideChevron
                    right={
                      <Ionicons
                        name={isFavorite ? 'bookmark' : 'bookmark-outline'}
                        size={19}
                        color={theme.colors.textSecondary}
                      />
                    }
                    onPress={() => {
                      saveFavorite();
                      setSheet(false);
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
                {sheetParent !== 'listening' ? (
                  <>
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
                  </>
                ) : null}

                <View style={{ alignItems: 'center', marginBottom: 10 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '800' }}>
                    {sheetParent === 'listening'
                      ? '标准'
                      : fontSizeTarget === 'portrait'
                        ? '标准'
                        : '全屏'}
                  </Text>
                  {sheetParent !== 'listening' ? (
                    <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 3 }}>
                      {fontSizeTarget === 'portrait' ? fontSize : landscapeFontSize}px
                    </Text>
                  ) : null}
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
                    subtitle="精听时播完自动进入下一句"
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
                    icon="document-text-outline"
                    title="原文"
                    value={listeningOriginalLabel}
                    onPress={() => openSheetPanel('listeningOriginal', 'listening')}
                  />
                  <SheetRow
                    icon="language-outline"
                    title="翻译"
                    value={listeningTranslationLabel}
                    onPress={() => openSheetPanel('listeningTranslation', 'listening')}
                  />
                  <SheetRow
                    icon="text-outline"
                    title="字体大小"
                    value={listeningFontLabel}
                    onPress={() => {
                      setFontSizeTarget('portrait');
                      openSheetPanel('fontSize', 'listening');
                    }}
                  />
                </View>
                <View style={[styles.sheetGroup, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <SheetRow
                    icon="repeat-outline"
                    title="每句播放遍数"
                    value={`${listeningRepeatCount}`}
                    onPress={() => openSheetPanel('listeningRepeat', 'listening')}
                  />
                  <SheetRow
                    icon="hourglass-outline"
                    title="每遍间隔"
                    value={listeningRepeatInterval === 0 ? '不停顿' : `${listeningRepeatInterval} 秒`}
                    onPress={() => openSheetPanel('listeningInterval', 'listening')}
                  />
                </View>
                <Text style={[styles.panelHint, { color: theme.colors.textTertiary }]}>
                  精听模式会按这里的遍数和间隔重复当前句；最后一遍结束后按原文与翻译设置显示内容。
                </Text>
              </View>
            ) : null}

            {sheetPanel === 'listeningOriginal' ? (
              <View style={styles.optionList}>
                {[
                  {
                    id: 'always' as const,
                    title: '一开始就显示',
                    desc: '进入精听和每句开始时，原文直接可见。',
                  },
                  {
                    id: 'after' as const,
                    title: '听完自动显示',
                    desc: '每句按设置的遍数播放完后，自动显示原文。',
                  },
                  {
                    id: 'tap' as const,
                    title: '听完轻点显示',
                    desc: '播放结束后仍保持遮挡，轻点卡片才显示原文。',
                  },
                ].map((option) => {
                  const active = listeningOriginalMode === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() =>
                        patchSettings({
                          subtitle: {
                            ...settings.subtitle,
                            listeningOriginalMode: option.id,
                          },
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

            {sheetPanel === 'listeningTranslation' ? (
              <View style={styles.optionList}>
                {[
                  {
                    id: 'always' as const,
                    title: '始终显示',
                    desc: '进入精听和每句开始时默认显示译文。',
                  },
                  {
                    id: 'together' as const,
                    title: '和原文一起',
                    desc: '原文出现时同步显示译文。',
                  },
                  {
                    id: 'tap' as const,
                    title: '轻点显示',
                    desc: '默认隐藏译文，轻点卡片时显示。',
                  },
                ].map((option) => {
                  const active = listeningTranslationMode === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() =>
                        patchSettings({
                          subtitle: {
                            ...settings.subtitle,
                            listeningTranslationMode: option.id,
                          },
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

            {sheetPanel === 'listeningRepeat' ? (
              <View style={styles.optionList}>
                {[1, 2, 3].map((count) => {
                  const active = listeningRepeatCount === count;
                  return (
                    <Pressable
                      key={count}
                      onPress={() =>
                        patchSettings({
                          subtitle: { ...settings.subtitle, repeatCount: count },
                        })
                      }
                      style={[
                        styles.optionCard,
                        {
                          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionTitle,
                          { color: theme.colors.text, flex: 1 },
                        ]}
                      >
                        {count}
                      </Text>
                      {active ? (
                        <Ionicons name="checkmark" size={22} color={theme.colors.primary} />
                      ) : null}
                    </Pressable>
                  );
                })}
                <Text style={[styles.panelHint, { color: theme.colors.textTertiary }]}>
                  当前句会按这个遍数重复播放，播放完最后一遍后再显示原文。
                </Text>
              </View>
            ) : null}

            {sheetPanel === 'listeningInterval' ? (
              <View style={styles.optionList}>
                {[0, 1, 2, 3].map((seconds) => {
                  const active = listeningRepeatInterval === seconds;
                  return (
                    <Pressable
                      key={seconds}
                      onPress={() =>
                        patchSettings({
                          subtitle: { ...settings.subtitle, repeatInterval: seconds },
                        })
                      }
                      style={[
                        styles.optionCard,
                        {
                          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionTitle,
                          { color: theme.colors.text, flex: 1 },
                        ]}
                      >
                        {seconds === 0 ? '不停顿' : `${seconds} 秒`}
                      </Text>
                      {active ? (
                        <Ionicons name="checkmark" size={22} color={theme.colors.primary} />
                      ) : null}
                    </Pressable>
                  );
                })}
                <Text style={[styles.panelHint, { color: theme.colors.textTertiary }]}>
                  每一遍播放结束后，等待这个时间再开始下一遍。
                </Text>
              </View>
            ) : null}

            {sheetPanel === 'analysis' ? (
              <View style={{ paddingHorizontal: 4 }}>
                <View
                  style={[
                    styles.sheetGroup,
                    { backgroundColor: theme.colors.surfaceAlt, padding: 16 },
                  ]}
                >
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 11, fontWeight: '700' }}>
                    原文
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: 18,
                      lineHeight: 26,
                      fontWeight: '700',
                      marginTop: 6,
                    }}
                  >
                    {analysisCue?.text ?? activeCue?.text ?? ''}
                  </Text>
                  {analysisCue?.translation || activeCue?.translation ? (
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: 14,
                        lineHeight: 21,
                        marginTop: 10,
                      }}
                    >
                      {analysisCue?.translation ?? activeCue?.translation}
                    </Text>
                  ) : null}
                </View>

                {analysisLoading ? (
                  <View style={{ paddingVertical: 42, alignItems: 'center', gap: 10 }}>
                    <ActivityIndicator color={theme.colors.primary} />
                    <Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>
                      正在分析句子结构…
                    </Text>
                  </View>
                ) : null}

                {analysisError ? (
                  <View
                    style={[
                      styles.sheetGroup,
                      { backgroundColor: theme.colors.surfaceAlt, padding: 16, marginTop: 12 },
                    ]}
                  >
                    <Text style={{ color: '#C24141', fontSize: 13, lineHeight: 20 }}>
                      {analysisError}
                    </Text>
                    <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 8 }}>
                      请检查 AI 接口的 API Key、模型名和网络后重试。
                    </Text>
                  </View>
                ) : null}

                {!analysisLoading && !analysisError && analysisText ? (
                  <View style={{ marginTop: 16 }}>
                    <Text
                      style={{
                        color: theme.colors.text,
                        fontSize: 13,
                        fontWeight: '800',
                        marginBottom: 8,
                      }}
                    >
                      整句解析
                    </Text>
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: 14,
                        lineHeight: 22,
                      }}
                    >
                      {analysisText}
                    </Text>
                  </View>
                ) : null}
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
  hideChevron,
}: {
  icon: any;
  title: string;
  subtitle?: string;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  hideChevron?: boolean;
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
      {onPress && !disabled && !hideChevron ? (
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
  headerProvider: { color: '#8D849D', fontSize: 10.5, fontWeight: '600' },
  videoFrame: {
    marginHorizontal: 14,
    backgroundColor: '#000000',
    overflow: 'hidden',
    borderRadius: 18,
  },
  videoFrameHidden: {
    height: 0,
    marginHorizontal: 0,
    overflow: 'hidden',
    opacity: 0,
    backgroundColor: 'transparent',
  },
  hiddenWebview: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
  },
  webVideoFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: '#100D17',
  },
  webVideoFallbackIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
    backgroundColor: 'rgba(143,113,255,0.16)',
  },
  webVideoFallbackTitle: { color: '#EEE9FA', fontSize: 13, fontWeight: '800' },
  webVideoFallbackText: { color: '#8D849D', fontSize: 11, marginTop: 4 },
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
    zIndex: 6,
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
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 14,
    paddingBottom: 2,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '70%' },
  statusText: { color: '#8D849D', fontSize: 11, flexShrink: 1 },
  cue: { paddingVertical: 9, paddingHorizontal: 8, borderRadius: 12 },
  transcriptWrap: { flex: 1 },
  followCurrentButton: {
    position: 'absolute',
    right: 18,
    bottom: 12,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    elevation: 3,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  followCurrentText: { fontSize: 11.5, fontWeight: '700' },
  cueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
    marginBottom: 3,
  },
  cueTime: {
    fontSize: 13.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
  },
  cueHeart: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cueOriginal: { color: '#A79EB9', lineHeight: 25, fontWeight: '600' },
  cueOriginalActive: { color: '#C4B5FD', fontWeight: '800' },
  cueTranslation: { color: '#746B85', lineHeight: 20, marginTop: 3 },
  cueTranslationActive: { color: '#F1ECFA' },
  cueFutureOriginal: { opacity: 0.58 },
  cueFutureTranslation: { opacity: 0.46 },
  cuePastOriginal: { opacity: 0.86 },
  cuePastTranslation: { opacity: 0.72 },
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
  speedButton: {
    width: 48,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedBadge: {
    position: 'absolute',
    right: -3,
    top: -5,
    minWidth: 25,
    height: 15,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.1,
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
  precisionActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 6,
  },
  precisionAction: {
    width: 54,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  precisionActionActive: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
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
    right: 14,
    top: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    zIndex: 10,
  },
  landTime: {
    color: '#EDE9F7',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
  landProgressPill: {
    flex: 1,
    height: 40,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
  },
  landProgressTouch: { flex: 1, height: 28, justifyContent: 'center', minWidth: 80 },
  landProgressRail: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
  landProgressFill: { height: '100%', backgroundColor: '#FFFFFF' },
  landIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(18,15,23,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  landTopRatePill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(18,15,23,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  landCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '43%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 26,
    zIndex: 9,
  },
  landTransportButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(18,15,23,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  landPlay: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(18,15,23,0.62)',
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
  landRateText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  landSubWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 32,
    zIndex: 8,
  },
  landSubBox: {
    maxWidth: '88%',
    paddingHorizontal: 18,
    paddingVertical: 10,
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
    backgroundColor: 'rgba(10,8,16,0.14)',
    zIndex: 90,
  },
  modePopover: {
    position: 'absolute',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 18,
  },
  modeRow: {
    height: 44,
    borderRadius: 11,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  modeRowLabel: { flex: 1, fontSize: 13.5 },
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
  rateSheetMask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5,3,9,0.30)',
    justifyContent: 'flex-end',
    zIndex: 90,
  },
  rateSheetMaskLandscape: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  rateSheetCard: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  rateSheetCardLandscape: {
    width: '72%',
    maxWidth: 620,
    borderRadius: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rateSheetTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginTop: 4,
    marginBottom: 18,
  },
  ratePresetRow: {
    flexDirection: 'row',
    gap: 6,
  },
  ratePreset: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 24,
  },
  rateEndLabel: {
    width: 34,
    fontSize: 12,
    fontWeight: '600',
  },
  rateSliderTrack: {
    flex: 1,
    height: 34,
    justifyContent: 'center',
  },
  rateSliderRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 13,
    height: 8,
    borderRadius: 4,
  },
  rateSliderFill: {
    position: 'absolute',
    left: 0,
    top: 13,
    height: 8,
    borderRadius: 4,
  },
  rateSliderDot: {
    position: 'absolute',
    top: 15,
    width: 4,
    height: 4,
    marginLeft: -2,
    borderRadius: 2,
  },
  rateSliderThumb: {
    position: 'absolute',
    top: 7,
    width: 2.5,
    height: 20,
    marginLeft: -1.25,
    borderRadius: 2,
  },
  rateValueLabel: {
    alignSelf: 'center',
    marginTop: 16,
    fontSize: 16,
    fontWeight: '800',
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
