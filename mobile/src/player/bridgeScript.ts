// Playback bridge injected into the YouTube watch page.
//
// The bridge is the only writer of <video> / player state. React never sends
// raw play/pause toggles: it sends an intent plus a layout epoch, and the
// bridge decides when a command is safe to issue.
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

export function playerBridgeScript(startAt = 0) {
  return `
(function(){
  try {
    var previous = window.__kissBridge;
    var requestedStart = ${JSON.stringify(Math.max(0, Number(startAt) || 0))};
    if (previous) previous.alive = false;
    if (previous && previous.timer) clearInterval(previous.timer);
    if (previous && previous.cssTimer) clearInterval(previous.cssTimer);
    if (previous && previous.startTimer) clearTimeout(previous.startTimer);
    if (previous && previous.pauseAtTimer) clearInterval(previous.pauseAtTimer);
    if (previous && previous.playFallbackTimer) clearTimeout(previous.playFallbackTimer);
    if (previous && previous.pauseFallbackTimer) clearTimeout(previous.pauseFallbackTimer);
    if (previous && previous.playConfirmTimer) clearTimeout(previous.playConfirmTimer);
    if (previous && previous.reconcileTimer) clearTimeout(previous.reconcileTimer);
    if (previous && previous.transitionGuardTimer) clearTimeout(previous.transitionGuardTimer);
    if (previous && previous.recoveryTimer) clearTimeout(previous.recoveryTimer);
    var storedIntent = '';
    var storedIntentUrl = '';
    try {
      storedIntent = window.sessionStorage.getItem('kiss-play-intent') || '';
      storedIntentUrl = window.sessionStorage.getItem('kiss-play-url') || '';
    } catch(e) {}
    var inheritedIntent = previous
      ? (previous.playIntent === 'play' || previous.playIntent === 'pause'
          ? previous.playIntent
          : (previous.wantPlay && !previous.userPaused ? 'play' : 'pause'))
      : '';
    var storedIntentApplies = !previous && storedIntentUrl === location.href;
    var initialIntent = inheritedIntent ||
      (storedIntentApplies && storedIntent === 'pause' ? 'pause' : 'play');
    var bridge = window.__kissBridge = {
      mode: 'mobile-watch',
      alive: true,
      // There is exactly one authority for playback: the user's intent.
      // Rotation, buffering and WebView reloads may change the real <video>
      // state, but they must never rewrite this intent.
      playIntent: initialIntent,
      pauseReason: previous ? String(previous.pauseReason || '') : '',
      frameReady: false,
      audioStrikes: 0,
      timer: null,
      cssTimer: null,
      startTimer: null,
      pauseAtTimer: null,
      pauseAtTarget: -1,
      pauseAtSawBeforeEnd: false,
      commandSeq: 0,
      lastPlayCommandAt: -10000,
      playFallbackTimer: null,
      pauseFallbackTimer: null,
      playConfirmTimer: null,
      reconcileTimer: null,
      // Layout epochs come from React. A transition is entered only when a
      // real rotation starts and is left only when the surface reports a
      // stable size for the *current* epoch. That replaces the old fixed
      // 650ms guess, which could expire before Android had resized anything.
      phase: 'steady',
      epoch: 0,
      transitionSource: '',
      transitionStartedAt: 0,
      transitionGuardTimer: null,
      transitionPendingRecovery: false,
      settleWindowUntil: 0,
      recoveryAttempts: 0,
      recoveryTimer: null,
      videoRef: null,
      startAt: requestedStart,
      startApplied:
        requestedStart <= 0 ||
        (previous &&
          previous.startAt === requestedStart &&
          !!previous.startApplied)
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
    function isFrameReady(v){
      return !!(v && v.readyState >= 2 && v.videoWidth > 0);
    }
    function persistPlayIntent(){
      try {
        window.sessionStorage.setItem('kiss-play-intent', bridge.playIntent);
        window.sessionStorage.setItem('kiss-play-url', location.href);
      } catch(e) {}
    }
    function setPlayIntent(next, reason){
      bridge.playIntent = next ? 'play' : 'pause';
      bridge.pauseReason = String(reason || '');
      persistPlayIntent();
    }
    function clearStartTimer(){
      if (bridge.startTimer) {
        clearTimeout(bridge.startTimer);
        bridge.startTimer = null;
      }
    }
    function playerState(p){
      try {
        if (p && typeof p.getPlayerState === 'function') {
          var state = Number(p.getPlayerState());
          return isFinite(state) ? state : NaN;
        }
      } catch(e) {}
      return NaN;
    }
    function isPlayerPlayingState(state){
      return state === 1 || state === 3;
    }
    function isPlayerPausedState(state){
      return state === 0 || state === 2 || state === 5;
    }
    function isActuallyPlaying(v, p){
      var state = playerState(p);
      if (!v || v.ended) return false;
      if (isPlayerPausedState(state)) return false;
      if (v.paused) return false;
      if (isPlayerPlayingState(state)) return true;
      // Some embeds do not expose getPlayerState. In that case the raw element
      // is the only signal we have.
      return isFinite(state) ? false : true;
    }
    function safePlayVideo(v){
      try {
        if (!v) return false;
        var result = v.play();
        if (result && result.catch) result.catch(function(){});
        return true;
      } catch(e) {
        return false;
      }
    }
    function safePauseVideo(v){
      try {
        if (v && !v.paused) v.pause();
      } catch(e) {}
    }
    function clearPlayFallback(){
      if (bridge.playFallbackTimer) {
        clearTimeout(bridge.playFallbackTimer);
        bridge.playFallbackTimer = null;
      }
    }
    function clearPauseFallback(){
      if (bridge.pauseFallbackTimer) {
        clearTimeout(bridge.pauseFallbackTimer);
        bridge.pauseFallbackTimer = null;
      }
    }
    function requestPlayerPlay(v, force){
      var p = getPlayer();
      var current = v || getVideo();
      if (!current) return;
      // Never issue another play command while YouTube and the raw video are
      // already playing. Repeated playVideo() calls during a rotation used to
      // make Android look like it was tapping pause/play in a loop.
      if (inTransition()) {
        // A surface resize owns the player for a few hundred milliseconds.
        // Record the wish instead of racing the resize; the settle handshake
        // below issues exactly one recovery command afterwards.
        bridge.transitionPendingRecovery = true;
        return;
      }
      if (isActuallyPlaying(current, p)) return;
      var now = Date.now();
      if (!force && now - (Number(bridge.lastPlayCommandAt) || 0) < 360) return;
      bridge.lastPlayCommandAt = now;
      bridge.commandSeq += 1;
      var seq = bridge.commandSeq;
      clearPlayFallback();
      clearPauseFallback();
      var askedPlayer = false;
      if (p && typeof p.playVideo === 'function') {
        try {
          p.playVideo();
          askedPlayer = true;
        } catch(e) {}
      }
      if (!askedPlayer) {
        if (current.paused || current.ended) safePlayVideo(current);
        return;
      }
      // The YouTube API is the primary authority. Give it a moment to move both
      // playerState and the real <video>, then nudge the raw element only once
      // if it is still stuck. This avoids firing playVideo() and video.play()
      // against each other in the same tick.
      bridge.playFallbackTimer = setTimeout(function(){
        bridge.playFallbackTimer = null;
        if (!bridge.alive || bridge.playIntent !== 'play') return;
        if (bridge.commandSeq !== seq) return;
        var next = getVideo();
        if (!next) return;
        var state = playerState(getPlayer());
        if (isPlayerPlayingState(state)) {
          if (next.paused || next.ended) safePlayVideo(next);
          return;
        }
        // If YouTube still reports paused/cued, do not start the raw element
        // behind its back. That creates two disagreeing players and is exactly
        // the state that produced the pause/play stutter. The bounded confirm
        // in playNow gets one more chance through the player API.
        if (!isFinite(state) && (next.paused || next.ended)) {
          safePlayVideo(next);
        }
      }, force ? 260 : 320);
    }
    function requestPlayerPause(v){
      var p = getPlayer();
      var current = v || getVideo();
      var state = playerState(p);
      if (current && current.paused &&
          (!isFinite(state) || state === 0 || state === 2)) {
        return;
      }
      bridge.commandSeq += 1;
      clearPlayFallback();
      clearPauseFallback();
      var askedPlayer = false;
      if (p && typeof p.pauseVideo === 'function') {
        try {
          p.pauseVideo();
          askedPlayer = true;
        } catch(e) {}
      }
      if (!askedPlayer) {
        safePauseVideo(current);
        return;
      }
      // Pause through the player API first; only nudge the raw element if it
      // is still running after YouTube has been told to stop.
      bridge.pauseFallbackTimer = setTimeout(function(){
        bridge.pauseFallbackTimer = null;
        if (!bridge.alive || bridge.playIntent !== 'pause') return;
        var next = getVideo();
        if (next && !next.paused) safePauseVideo(next);
      }, 180);
    }
    function playNow(reason, immediate){
      clearPauseAt();
      clearStartTimer();
      setPlayIntent(true, reason || 'user');
      if (bridge.playConfirmTimer) {
        clearTimeout(bridge.playConfirmTimer);
        bridge.playConfirmTimer = null;
      }
      var v = getVideo();
      if (v) {
        try { v.__kissUserPaused = false; } catch(e) {}
      }
      var explicit = immediate !== false;
      if (inTransition()) bridge.transitionPendingRecovery = true;
      if (v) maybeStart(v, explicit);
      if (explicit) {
        // One bounded confirmation after an explicit tap. It recovers a
        // YouTube pause that arrives just after our command, but cannot turn
        // into the old 180ms pause/play feedback loop.
        bridge.playConfirmTimer = setTimeout(function(){
          bridge.playConfirmTimer = null;
          if (!bridge.alive || bridge.playIntent !== 'play') return;
          var current = getVideo();
          if (!current) return;
          if (!isActuallyPlaying(current, getPlayer())) {
            requestPlayerPlay(current, true);
          }
        }, 700);
      }
      scheduleAudio(260);
      setTimeout(ensureAudio, 1000);
      setTimeout(report, 80);
      return true;
    }
    function pauseNow(reason){
      clearPauseAt();
      clearStartTimer();
      // A deliberate pause cancels any recovery that the settle handshake had
      // queued, otherwise the bridge would resume against the user's wish.
      bridge.transitionPendingRecovery = false;
      if (bridge.playConfirmTimer) {
        clearTimeout(bridge.playConfirmTimer);
        bridge.playConfirmTimer = null;
      }
      setPlayIntent(false, reason || 'user');
      var v = getVideo();
      if (v) {
        try { v.__kissUserPaused = true; } catch(e) {}
        requestPlayerPause(v);
      }
      setTimeout(report, 80);
      return true;
    }
    function announceReady(v){
      if (!isFrameReady(v) || bridge.frameReady) return;
      bridge.frameReady = true;
      var p = getPlayer();
      send({
        type: 'ready',
        playing: bridge.playIntent === 'play',
        actualPlaying: isActuallyPlaying(v, p),
        playerState: playerState(p)
      });
    }
    function applyStart(v){
      if (bridge.startApplied) return;
      if (!v || v.readyState < 1) return;
      var duration = Number(v.duration) || 0;
      var target = Math.max(0, Number(bridge.startAt) || 0);
      if (duration > 0) target = Math.min(target, Math.max(0, duration - 1));
      try {
        if (Math.abs((Number(v.currentTime) || 0) - target) > 0.5) {
          v.currentTime = target;
        }
        bridge.startApplied = true;
        report();
      } catch(e) {}
    }
    function maybeStart(v, force){
      // The old first-frame gate paused an already playing video whenever a
      // rotation briefly reported readyState/videoWidth as zero. That gate is
      // gone. Here we only move the video toward the user's intent; we never
      // pause it just because its frame metadata is temporarily incomplete.
      if (!bridge.alive || !v || bridge.playIntent !== 'play') return;
      var p = getPlayer();
      if (!isFrameReady(v)) {
        if (!isActuallyPlaying(v, p)) requestPlayerPlay(v, force);
        // Slow network fallback: do not leave the player stuck if loadeddata
        // never arrives. This never changes playback intent.
        if (!bridge.startTimer) {
          bridge.startTimer = setTimeout(function(){
            bridge.startTimer = null;
            var current = getVideo();
            if (current && bridge.playIntent === 'play' &&
                !isActuallyPlaying(current, getPlayer())) {
              requestPlayerPlay(current, true);
            }
          }, 4500);
        }
        return;
      }
      clearStartTimer();
      applyStart(v);
      if (!isActuallyPlaying(v, p)) requestPlayerPlay(v, force);
      announceReady(v);
      if (isActuallyPlaying(v, getPlayer())) scheduleAudio(250);
    }
    function bufferedRange(v){
      var current = Number(v && v.currentTime) || 0;
      try {
        var ranges = v.buffered;
        if (!ranges || !ranges.length) return { start: current, end: current };
        var start = current;
        var end = current;
        for (var i = 0; i < ranges.length; i += 1) {
          var rangeStart = Number(ranges.start(i));
          var rangeEnd = Number(ranges.end(i));
          if (!isFinite(rangeStart) || !isFinite(rangeEnd)) continue;
          if (rangeStart <= current + 0.5 && rangeEnd >= current - 0.5) {
            if (rangeEnd > end) end = rangeEnd;
            if (rangeStart < start || start === current) start = rangeStart;
          }
        }
        return { start: start, end: end };
      } catch(e) {
        return { start: current, end: current };
      }
    }
    function report(){
      if (!bridge.alive) return;
      var v = getVideo();
      var p = getPlayer();
      if (!v) return;
      var quality = '';
      try { quality = p && p.getPlaybackQuality ? p.getPlaybackQuality() : ''; } catch(e) {}
      var buffer = bufferedRange(v);
      send({
        type: 'time',
        current: Number(v.currentTime) || 0,
        duration: Number(v.duration) || 0,
        bufferedStart: buffer.start,
        bufferedEnd: buffer.end,
        // React mirrors intent, not the raw video flag. A rotation can make
        // the raw flag flap for a few frames while the user still wants play.
        playing: bridge.playIntent === 'play' && !v.ended,
        // actualPlaying combines YouTube's playerState with the real element.
        // The raw flag alone can stay true while YouTube has paused the player,
        // which is how the UI used to look "playing" over a frozen picture.
        actualPlaying: isActuallyPlaying(v, p),
        playerState: playerState(p),
        pauseReason: bridge.pauseReason,
        ready: isFrameReady(v),
        rate: v.playbackRate,
        quality: quality,
        ad: isAdShowing()
      });
    }
    function installVideoEvents(v){
      if (v.__kissEventRouter) return;
      v.__kissEventRouter = true;
      var names = [
        'timeupdate','play','playing','pause','durationchange',
        'loadedmetadata','seeking','seeked','ratechange','ended',
        'volumechange','error','loadeddata','canplay'
      ];
      for (var i = 0; i < names.length; i += 1) {
        (function(name){
          v.addEventListener(name, function(){
            // The router always forwards to the current bridge. A script
            // re-injection therefore cannot leave stale listeners speaking
            // for the previous playback state machine.
            var active = window.__kissBridge;
            if (!active || !active.alive || active.videoRef !== v) return;
            if (name === 'loadeddata' || name === 'canplay') {
              if (typeof active.onVideoReady === 'function') {
                active.onVideoReady(v);
              }
              return;
            }
            if (typeof active.onVideoEvent === 'function') {
              active.onVideoEvent(name, v);
            }
          });
        })(names[i]);
      }
    }
    bridge.onVideoReady = function(v){
      if (!bridge.alive || bridge.videoRef !== v) return;
      maybeStart(v);
    };
    bridge.onVideoEvent = function(name, v){
      if (!bridge.alive || bridge.videoRef !== v) return;
      if (name === 'ended') {
        setPlayIntent(false, 'ended');
        report();
        return;
      }
      // A plain 'pause' event never starts playback. The only exception is a
      // pause that arrives inside the short settle window right after a
      // rotation finished: that is the late native pause which used to leave
      // the picture frozen. It gets one repair, still bounded by
      // recoveryAttempts, so it cannot become the old pause/play loop.
      if (name === 'pause') {
        if (bridge.playIntent === 'play' && !inTransition() &&
            Date.now() < (Number(bridge.settleWindowUntil) || 0)) {
          if (bridge.recoveryTimer) clearTimeout(bridge.recoveryTimer);
          bridge.recoveryTimer = setTimeout(function(){
            bridge.recoveryTimer = null;
            repairOnce('late-pause');
          }, 120);
        }
        report();
        return;
      }
      if (name === 'playing') {
        bridge.audioStrikes = 0;
        scheduleAudio(180);
        setTimeout(ensureAudio, 900);
      } else if (name === 'loadedmetadata') {
        scheduleAudio(180);
      } else if (name === 'volumechange') {
        if (v.muted && bridge.audioStrikes < 6) {
          bridge.audioStrikes += 1;
          scheduleAudio(120);
        } else if (!v.muted) {
          bridge.audioStrikes = 0;
        }
      } else if (name === 'error') {
        send({ type:'problem', reason:'video-error', code: v.error ? v.error.code : 0 });
      }
      report();
    };
    var bindTries = 0;
    function bind(){
      if (!bridge.alive) return;
      var v = getVideo();
      if (!v) {
        bindTries++;
        if (bindTries < 14) setTimeout(bind, 700);
        return;
      }
      applyStart(v);
      if (bridge.videoRef !== v) {
        bridge.videoRef = v;
        bridge.frameReady = false;
        clearStartTimer();
      }
      if (bridge.playIntent === 'play') {
        try { v.__kissUserPaused = false; } catch(e) {}
      } else {
        try { v.__kissUserPaused = true; } catch(e) {}
      }
      installVideoEvents(v);
      try { v.playsInline = true; } catch(e) {}
      try { v.preload = 'auto'; } catch(e) {}
      report();
      // Always let the state machine decide. It waits for the first frame but
      // never pauses a video that is already playing or already has intent.
      maybeStart(v);
      if (!bridge.timer) {
        bridge.timer = setInterval(report, 900);
      }
    }
    function isCaptionUrl(url){
      var value = String(url || '');
      return value.indexOf('/api/timedtext') >= 0 ||
        value.indexOf('/youtubei/v1/get_transcript') >= 0;
    }

    function findDeepKey(value, key, depth){
      if (!value || typeof value !== 'object' || depth > 8) return null;
      if (value[key]) return value[key];
      for (var name in value) {
        if (!Object.prototype.hasOwnProperty.call(value, name)) continue;
        var found = findDeepKey(value[name], key, depth + 1);
        if (found) return found;
      }
      return null;
    }

    function captionSegmentText(segment){
      if (!segment) return '';
      var snippet = segment.snippet;
      if (snippet) {
        if (typeof snippet.simpleText === 'string') return snippet.simpleText;
        if (snippet.runs && snippet.runs.length) {
          var parts = [];
          for (var i = 0; i < snippet.runs.length; i += 1) {
            parts.push(snippet.runs[i] && snippet.runs[i].text ? snippet.runs[i].text : '');
          }
          return parts.join('');
        }
      }
      return typeof segment.text === 'string' ? segment.text : '';
    }

    function transcriptCuesFromResponse(payload){
      var segments = null;
      try { segments = findDeepKey(payload, 'initialSegments', 0); } catch(e) {}
      if (!segments || !segments.length) {
        try {
          var panel = payload && payload.actions && payload.actions[0] &&
            payload.actions[0].updateEngagementPanelAction;
          var transcript = panel && panel.content && panel.content.transcriptRenderer;
          var search = transcript && transcript.content &&
            transcript.content.transcriptSearchPanelRenderer;
          segments = search && search.body &&
            search.body.transcriptSegmentListRenderer &&
            search.body.transcriptSegmentListRenderer.initialSegments;
        } catch(e) {}
      }
      if (!segments || !segments.length) return [];
      var cues = [];
      for (var i = 0; i < segments.length; i += 1) {
        var segment = segments[i] || {};
        var startMs = Number(
          segment.startMs != null ? segment.startMs : segment.start_time
        );
        var endMs = Number(
          segment.endMs != null ? segment.endMs : segment.end_time
        );
        if (!isFinite(endMs) || endMs <= startMs) {
          var durationMs = Number(
            segment.durationMs != null ? segment.durationMs : segment.duration
          );
          endMs = startMs + (isFinite(durationMs) && durationMs > 0 ? durationMs : 0);
        }
        var text = captionSegmentText(segment).replace(/\s+/g, ' ').trim();
        if (isFinite(startMs) && isFinite(endMs) && endMs > startMs && text) {
          cues.push({ start: startMs / 1000, end: endMs / 1000, text: text });
        }
      }
      return cues;
    }

    function normalizeCaptionPayload(url, text, status){
      if (!text) return null;
      var content = String(text);
      if (!content.trim() || !looksLikeCaptionText(content)) return null;
      var payload = {
        type: 'caption-payload',
        source: 'webview-player',
        url: String(url || ''),
        status: Number(status) || 0,
        text: content.slice(0, 6000000)
      };
      if (String(url || '').indexOf('/get_transcript') >= 0) {
        try {
          var cues = transcriptCuesFromResponse(JSON.parse(content));
          if (cues.length) {
            payload.cues = cues;
            delete payload.text;
            return payload;
          }
        } catch(e) {}
        return null;
      }
      return payload;
    }

    bridge.captionDeliver = function(payload){
      if (!payload) return;
      var videoId = bridge.captionVideoId || '';
      if (videoId && payload.url && String(payload.url).indexOf(videoId) < 0) {
        return;
      }
      if (typeof bridge.captionFinish === 'function') {
        bridge.captionFinish(payload);
      }
    };

    function installCaptionInterceptors(){
      if (window.__kissCaptionHook) {
        window.__kissCaptionHook.deliver = bridge.captionDeliver;
        return;
      }
      var hook = window.__kissCaptionHook = {
        deliver: bridge.captionDeliver,
        seen: {}
      };
      function remember(url, text, status){
        var payload = normalizeCaptionPayload(url, text, status);
        if (!payload) return;
        var key = String(url) + '|' + (payload.text ? payload.text.length : (payload.cues ? payload.cues.length : 0));
        if (hook.seen[key]) return;
        hook.seen[key] = true;
        hook.deliver(payload);
      }
      var rawFetch = window.fetch;
      if (typeof rawFetch === 'function') {
        window.fetch = function(input, init){
          var url = typeof input === 'string'
            ? input
            : (input && input.url ? input.url : String(input || ''));
          var result = rawFetch.apply(this, arguments);
          if (isCaptionUrl(url)) {
            try {
              result.then(function(response){
                try {
                  response.clone().text().then(function(text){
                    remember(url, text, response.status);
                  }).catch(function(){});
                } catch(e) {}
              }).catch(function(){});
            } catch(e) {}
          }
          return result;
        };
      }
      var rawOpen = XMLHttpRequest.prototype.open;
      var rawSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url){
        this.__kissCaptionUrl = String(url || '');
        return rawOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(){
        var xhr = this;
        var url = xhr.__kissCaptionUrl || '';
        if (isCaptionUrl(url)) {
          xhr.addEventListener('load', function(){
            try {
              var text = xhr.responseType === 'json'
                ? JSON.stringify(xhr.response)
                : xhr.responseText;
              remember(url, text, xhr.status);
            } catch(e) {}
          });
        }
        return rawSend.apply(this, arguments);
      };
    }

    function captionUrlWithFormat(baseUrl, format, android){
      var url = String(baseUrl || '').replace(/&amp;/g, '&');
      if (!url) return '';
      if (/[?&]fmt=/.test(url)) {
        url = url.replace(/([?&])fmt=[^&]*/, '$1fmt=' + format);
      } else {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + 'fmt=' + format;
      }
      if (android) {
        if (/[?&]c=/.test(url)) {
          url = url.replace(/([?&])c=[^&]*/, '$1c=ANDROID');
        } else {
          url += '&c=ANDROID';
        }
      }
      return url;
    }

    function looksLikeCaptionText(text){
      var value = String(text || '').trim();
      if (!value) return false;
      return value.indexOf('WEBVTT') === 0 ||
        value.indexOf('"events"') >= 0 ||
        value.indexOf('"initialSegments"') >= 0 ||
        value.indexOf('<transcript') >= 0 ||
        value.indexOf('<tt') >= 0 ||
        value.indexOf('<?xml') === 0;
    }

    function captionTrackUrls(track){
      var base = track && track.baseUrl ? String(track.baseUrl) : '';
      if (!base) return [];
      var formats = ['json3', 'vtt', 'srv3'];
      var urls = [base];
      for (var i = 0; i < formats.length; i += 1) {
        urls.push(captionUrlWithFormat(base, formats[i], true));
        urls.push(captionUrlWithFormat(base, formats[i], false));
      }
      return urls;
    }

    async function fetchCaptionTextFromTracks(tracks){
      var list = Array.isArray(tracks) ? tracks : [];
      for (var i = 0; i < list.length; i += 1) {
        var urls = captionTrackUrls(list[i]);
        for (var j = 0; j < urls.length; j += 1) {
          try {
            var response = await fetch(urls[j], {
              credentials: 'include',
              headers: { Accept: '*/*' }
            });
            var text = await response.text();
            if (response.status === 200 && text && text.trim() && looksLikeCaptionText(text)) {
              return { text: text, url: urls[j], status: response.status };
            }
          } catch(e) {}
        }
      }
      return null;
    }

    function recentTimedtextUrls(videoId, lang){
      var preferred = [];
      var others = [];
      try {
        var entries = performance.getEntriesByType('resource') || [];
        var baseLang = String(lang || '').split('-')[0];
        for (var i = 0; i < entries.length; i += 1) {
          var name = entries[i] && entries[i].name ? entries[i].name : '';
          if (name.indexOf('/api/timedtext') < 0) continue;
          if (videoId && name.indexOf(String(videoId)) < 0) continue;
          if (baseLang && name.indexOf('lang=' + baseLang) >= 0) preferred.push(name);
          else others.push(name);
        }
      } catch(e) {}
      // Keep the newest URLs from each bucket. Concatenating first and then
      // slicing used to drop the preferred language when YouTube requested
      // many other timedtext tracks.
      return preferred
        .slice(-6)
        .reverse()
        .concat(others.slice(-6).reverse());
    }

    function getClientVersion(){
      try {
        if (window.ytcfg && window.ytcfg.get) {
          return window.ytcfg.get('INNERTUBE_CLIENT_VERSION') || '';
        }
      } catch(e) {}
      return '';
    }

    function getVisitorData(){
      try {
        if (window.ytcfg && window.ytcfg.get) {
          var value = window.ytcfg.get('VISITOR_DATA');
          if (value) return value;
        }
      } catch(e) {}
      try {
        var match = String(document.documentElement.innerHTML || '')
          .match(/"VISITOR_DATA":"([^"]+)"/);
        return match ? decodeURIComponent(match[1]) : '';
      } catch(e) {}
      return '';
    }

    function getInnertubeContext(){
      var context = null;
      try {
        if (window.ytcfg && window.ytcfg.get) {
          context = window.ytcfg.get('INNERTUBE_CONTEXT');
        }
      } catch(e) {}
      if (!context || typeof context !== 'object') {
        context = {
          client: {
            clientName: 'WEB',
            clientVersion: getClientVersion() || '2.20260101.00.00',
            hl: 'en',
            gl: 'US'
          }
        };
      }
      if (context.client && !context.client.visitorData) {
        context.client.visitorData = getVisitorData();
      }
      return context;
    }

    function findTranscriptParams(){
      try {
        var endpoint = findDeepKey(window.ytInitialData, 'getTranscriptEndpoint', 0);
        if (endpoint && endpoint.params) return endpoint.params;
      } catch(e) {}
      try {
        var playerEndpoint = findDeepKey(window.ytInitialPlayerResponse, 'getTranscriptEndpoint', 0);
        if (playerEndpoint && playerEndpoint.params) return playerEndpoint.params;
      } catch(e) {}
      try {
        var match = String(document.documentElement.innerHTML || '')
          .match(/"getTranscriptEndpoint":\{"params":"([^"]+)"/);
        return match ? match[1] : '';
      } catch(e) {}
      return '';
    }

    async function fetchTranscriptFromPage(videoId, lang){
      var params = findTranscriptParams();
      if (!params) return [];
      try { params = decodeURIComponent(params); } catch(e) {}
      var key = '';
      try {
        if (window.ytcfg && window.ytcfg.get) {
          key = window.ytcfg.get('INNERTUBE_API_KEY') || '';
        }
      } catch(e) {}
      var url = '/youtubei/v1/get_transcript?prettyPrint=false' +
        (key ? '&key=' + encodeURIComponent(key) : '');
      var clientVersion = getClientVersion() || '2.20260101.00.00';
      var clientName = '1';
      try {
        if (window.ytcfg && window.ytcfg.get) {
          clientName = String(window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_NAME') || '1');
        }
      } catch(e) {}
      var response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Youtube-Client-Name': clientName,
          'X-Youtube-Client-Version': clientVersion,
          'X-Goog-Visitor-Id': getVisitorData()
        },
        body: JSON.stringify({
          context: getInnertubeContext(),
          params: params
        })
      });
      if (!response.ok) return [];
      var json = await response.json();
      return transcriptCuesFromResponse(json);
    }

    function captionTrackMatches(track, lang){
      var code = String(track && track.languageCode ? track.languageCode : '');
      var target = String(lang || '');
      if (!target || !code) return true;
      return code === target ||
        code.indexOf(target + '-') === 0 ||
        target.indexOf(code + '-') === 0;
    }

    function setCaptionTrack(player, track, attempts){
      try {
        if (player && player.setOption) {
          player.setOption('captions', 'track', track);
        }
      } catch(e) {
        if (attempts > 0) {
          setTimeout(function(){
            setCaptionTrack(player, track, attempts - 1);
          }, 250);
        }
      }
    }

    function activateCaptions(lang){
      var player = getPlayer();
      var activated = false;
      var selected = null;
      if (player) {
        try {
          if (player.loadModule) player.loadModule('captions');
        } catch(e) {}
        var list = null;
        try {
          list = player.getOption('captions', 'tracklist', { includeAsr: true });
        } catch(e) {}
        if (list && list.tracks && list.tracks.length) list = list.tracks;
        if (!list || !list.length) {
          try { list = player.getOption('captions', 'tracklist'); } catch(e) {}
        }
        if (list && list.tracks && list.tracks.length) list = list.tracks;
        if (list && list.length) {
          for (var i = 0; i < list.length; i += 1) {
            if (captionTrackMatches(list[i], lang)) {
              selected = list[i];
              break;
            }
          }
          if (!selected) selected = list[0];
          try { player.setOption('captions', 'track', {}); } catch(e) {}
          setTimeout(function(){
            setCaptionTrack(player, selected, 3);
          }, 300);
          activated = true;
        }
        try {
          var current = player.getOption('captions', 'track');
          if (current && current.languageCode) activated = true;
        } catch(e) {}
      }
      if (activated) return true;
      var selectors = [
        '.ytmClosedCaptioningButtonButton',
        'ytm-closed-captioning-button',
        '.ytmClosedCaptioningButtonHost',
        'yt-closed-captions-toggle-button',
        '.ytp-caption-button',
        '.ytp-subtitles-button',
        'button[aria-label*="字幕"]',
        'button[aria-label*="Captions"]',
        'button[aria-label*="Subtitles"]',
        'button[aria-label*="captions"]',
        'button[aria-label*="subtitles"]'
      ];
      for (var k = 0; k < selectors.length; k += 1) {
        try {
          var button = document.querySelector(selectors[k]);
          if (button) {
            button.click();
            return true;
          }
        } catch(e) {}
      }
      return false;
    }

    installCaptionInterceptors();

    function clearPauseAt(){
      if (bridge.pauseAtTimer) {
        clearInterval(bridge.pauseAtTimer);
        bridge.pauseAtTimer = null;
      }
      bridge.pauseAtTarget = -1;
      bridge.pauseAtSawBeforeEnd = false;
    }

    function inTransition(){
      return bridge.phase === 'transition';
    }
    function clearTransitionTimers(){
      if (bridge.transitionGuardTimer) {
        clearTimeout(bridge.transitionGuardTimer);
        bridge.transitionGuardTimer = null;
      }
      if (bridge.recoveryTimer) {
        clearTimeout(bridge.recoveryTimer);
        bridge.recoveryTimer = null;
      }
    }
    function repairOnce(reason){
      // Bounded: at most two play commands per transition (the settle command
      // plus one late repair). Anything beyond that is a loop, not a recovery.
      if (!bridge.alive || bridge.playIntent !== 'play' || inTransition()) return false;
      if (bridge.recoveryAttempts >= 2) return false;
      // Never touch an ad break: the ad owns the player for its own duration.
      if (isAdShowing()) return false;
      var v = getVideo();
      if (!v || v.ended) return false;
      if (isActuallyPlaying(v, getPlayer())) return false;
      bridge.recoveryAttempts += 1;
      maybeStart(v, true);
      return true;
    }
    function armLateRepair(){
      // YouTube/Chromium can emit one more pause shortly after the surface has
      // been resized. Repair inside a short, bounded window, then stop for good.
      bridge.settleWindowUntil = Date.now() + 900;
      if (bridge.recoveryTimer) clearTimeout(bridge.recoveryTimer);
      bridge.recoveryTimer = setTimeout(function(){
        bridge.recoveryTimer = null;
        repairOnce('late-settle');
      }, 350);
    }
    function beginTransition(source, epoch){
      if (epoch != null) {
        var next = Number(epoch);
        if (isFinite(next)) {
          if (next < bridge.epoch) return false; // stale handshake
          bridge.epoch = next;
        }
      }
      bridge.phase = 'transition';
      bridge.transitionSource = String(source || '');
      bridge.transitionStartedAt = Date.now();
      bridge.recoveryAttempts = 0;
      bridge.settleWindowUntil = 0;
      if (bridge.recoveryTimer) {
        clearTimeout(bridge.recoveryTimer);
        bridge.recoveryTimer = null;
      }
      if (bridge.transitionGuardTimer) clearTimeout(bridge.transitionGuardTimer);
      // Safety net only. A lost "stable" message must never strand the player
      // in a silent transition, so the guard closes it unconditionally.
      bridge.transitionGuardTimer = setTimeout(function(){
        bridge.transitionGuardTimer = null;
        endTransition(bridge.epoch, 'guard');
      }, 1500);
      clearPlayFallback();
      clearPauseFallback();
      clearStartTimer();
      if (bridge.playConfirmTimer) {
        clearTimeout(bridge.playConfirmTimer);
        bridge.playConfirmTimer = null;
      }
      return true;
    }
    function endTransition(epoch, reason){
      if (bridge.phase !== 'transition') return true; // already steady: no-op
      if (epoch != null && Number(epoch) !== bridge.epoch) return false; // stale
      bridge.phase = 'steady';
      clearTransitionTimers();
      bridge.transitionPendingRecovery = false;
      if (bridge.playIntent === 'play') {
        // Exactly one recovery command, issued only after the surface is stable.
        repairOnce('settle:' + String(reason || 'stable'));
        armLateRepair();
      }
      setTimeout(report, 80);
      return true;
    }

    function reconcilePlayback(reason){
      if (!bridge.alive) return true;
      if (inTransition()) {
        // Defer instead of silently dropping the request. The old code
        // returned here and only re-armed a timer, so an RN reconcile that
        // landed inside the hold never restored playback at all.
        bridge.transitionPendingRecovery = true;
        return true;
      }
      if (bridge.playIntent !== 'play') return true;
      var v = getVideo();
      if (!v) return true;
      if (v.ended) {
        setPlayIntent(false, 'ended');
        report();
        return true;
      }
      // Only restore the user's play intent. Never touch pauseAt here: a
      // blind-listening boundary must survive a fullscreen rotation.
      maybeStart(v);
      setTimeout(report, 80);
      return true;
    }

    window.__kiss = {
      play: function(){
        return playNow('user');
      },
      pause: function(){
        return pauseNow('user');
      },
      setPlaying: function(playing){
        return playing ? playNow('user') : pauseNow('user');
      },
      resume: function(){
        return reconcilePlayback('resume');
      },
      reconcile: function(){
        return reconcilePlayback('reconcile');
      },
      refresh: function(){
        // onLoadEnd only needs a DOM rescan. Reinjecting the whole script used
        // to initialize playback twice and restart pending timers on cold load.
        bindTries = 0;
        bind();
        return true;
      },
      // Layout handshake. React owns the epoch, the bridge only obeys it.
      layoutStart: function(epoch){
        return beginTransition('layout', epoch);
      },
      layoutStable: function(epoch){
        return endTransition(epoch, 'layout');
      },
      // Kept for the in-page orientationchange listener and for older
      // injected scripts that still call it.
      orientation: function(){
        return beginTransition('native', null);
      },
      resetForEntry: function(){
        return playNow('entry', false);
      },
      pauseForScreen: function(){
        var result = pauseNow('screen');
        // A screen exit is a fresh-entry boundary. Do not let a pause from
        // this video leak into the next player instance through sessionStorage.
        try {
          window.sessionStorage.removeItem('kiss-play-intent');
          window.sessionStorage.removeItem('kiss-play-url');
        } catch(e) {}
        return result;
      },
      toggle: function(){
        if (bridge.playIntent === 'play') {
          return pauseNow('user');
        }
        return playNow('user');
      },
      seek: function(seconds){
        clearPauseAt();
        var v=getVideo();
        try{ if(v){ v.currentTime=Math.max(0, Number(seconds)||0); } }catch(e){}
        return true;
      },
      pauseAt: function(seconds){
        var target = Number(seconds);
        if (!Number.isFinite(target) || target < 0) {
          clearPauseAt();
          return true;
        }
        clearPauseAt();
        bridge.pauseAtTarget = target;
        bridge.pauseAtTimer = setInterval(function(){
          if (!bridge.alive || bridge.playIntent !== 'play') {
            clearPauseAt();
            return;
          }
          var v = getVideo();
          if (!v) return;
          if (v.ended) {
            clearPauseAt();
            setPlayIntent(false, 'ended');
            report();
            return;
          }
          var now = Number(v.currentTime) || 0;
          if (!bridge.pauseAtSawBeforeEnd) {
            // A seek may not have landed yet. If currentTime is still past the
            // target, wait for it to drop back before considering a pause.
            if (now > target) return;
            bridge.pauseAtSawBeforeEnd = true;
          }
          if (now < target) return;
          pauseNow('boundary');
          // React must observe the semantic boundary even when this pause and
          // the final time report arrive in the same WebView message batch.
          send({ type: 'cue-ended', current: now, cueEnd: target });
        }, 16);
        return true;
      },
      rate: function(rate){ var v=getVideo(); try{ if(v)v.playbackRate=Number(rate)||1; }catch(e){}; return true; },
      mute: function(muted){ var v=getVideo(); try{ if(v)v.muted=!!muted; }catch(e){}; return true; },
      audio: function(){ ensureAudio(); return true; },
      captions: function(lang, tracks, videoId){
        if (bridge.captionBusy) return true;
        bridge.captionBusy = true;
        bridge.captionVideoId = String(videoId || '');
        var finished = false;
        var timer = setTimeout(function(){
          if (!finished) fail('timeout');
        }, 15000);
        function finish(payload){
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          bridge.captionBusy = false;
          bridge.captionFinish = null;
          bridge.captionVideoId = '';
          send(payload);
        }
        function fail(reason){
          finish({ type: 'caption-error', reason: String(reason || 'captions-unavailable') });
        }
        bridge.captionFinish = function(payload){
          if (payload) finish(payload);
        };
        (async function(){
          try {
            var direct = await fetchCaptionTextFromTracks(tracks || []);
            if (finished) return;
            if (direct) {
              var payload = normalizeCaptionPayload(direct.url, direct.text, direct.status);
              if (payload) {
                finish(payload);
                return;
              }
            }
          } catch(e) {}
          var recent = recentTimedtextUrls(videoId, lang);
          for (var i = 0; i < recent.length; i += 1) {
            if (finished) return;
            try {
              var response = await fetch(recent[i], {
                credentials: 'include',
                headers: { Accept: '*/*' }
              });
              var text = await response.text();
              if (response.status === 200 && text && text.trim() && looksLikeCaptionText(text)) {
                var payload = normalizeCaptionPayload(recent[i], text, response.status);
                if (payload) {
                  finish(payload);
                  return;
                }
              }
            } catch(e) {}
          }
          if (finished) return;
          try {
            var cues = await fetchTranscriptFromPage(videoId, lang);
            if (!finished && cues && cues.length) {
              finish({
                type: 'caption-payload',
                source: 'webview-transcript',
                url: 'youtubei/get_transcript',
                cues: cues
              });
              return;
            }
          } catch(e) {}
          if (finished) return;
          var activated = activateCaptions(lang);
          if (!activated) {
            var tries = 0;
            var tryAgain = function(){
              if (finished) return;
              tries += 1;
              if (activateCaptions(lang)) return;
              if (tries < 4) {
                setTimeout(tryAgain, 500);
                return;
              }
              fail('no-player-captions');
            };
            setTimeout(tryAgain, 500);
          }
        })();
        return true;
      }
    };
    bind();
    var lastHref = location.href;
    document.addEventListener('yt-navigate-finish', function(){
      if (!bridge.alive) return;
      if (location.href !== lastHref) {
        lastHref = location.href;
        setPlayIntent(true, 'navigation');
        bridge.frameReady = false;
        bridge.videoRef = null;
        clearStartTimer();
        bridge.captionBusy = false;
        bridge.captionFinish = null;
        bridge.captionVideoId = '';
        var nextVideo = getVideo();
        if (nextVideo) {
          nextVideo.__kissUserPaused = false;
          nextVideo.__kissQualityStarted = false;
        }
      }
      bindTries = 0;
      setTimeout(bind, 400);
    }, true);
    function scheduleReconcile(delay){
      if (bridge.reconcileTimer) clearTimeout(bridge.reconcileTimer);
      bridge.reconcileTimer = setTimeout(function(){
        bridge.reconcileTimer = null;
        if (!bridge.alive) return;
        reconcilePlayback('visible');
      }, delay);
    }
    window.addEventListener('orientationchange', function(){
      // Secondary signal only. React's layout epoch is authoritative: this
      // handler starts a transition so no play command races the resize, and
      // React ends it with layoutStable on the same epoch. If this page never
      // receives a handshake the 1500ms guard still closes the transition.
      beginTransition('native-webview', null);
    });
    function reconcileWhenVisible(){
      if (document.hidden) return;
      scheduleReconcile(300);
    }
    document.addEventListener('visibilitychange', function(){
      if (!document.hidden) reconcileWhenVisible();
    });
    window.addEventListener('pageshow', reconcileWhenVisible);
    window.addEventListener('focus', reconcileWhenVisible);
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
