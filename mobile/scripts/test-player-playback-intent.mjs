import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app/player.tsx', import.meta.url), 'utf8');

function extractBridge() {
  const start = source.indexOf('function playerBridgeScript(');
  const bodyStart = source.indexOf('return `', start);
  const bodyEnd = source.indexOf('`;', bodyStart + 8);
  assert.ok(start >= 0 && bodyStart > start && bodyEnd > bodyStart);
  let bridge = source.slice(bodyStart + 8, bodyEnd);
  bridge = bridge.replace(
    /\$\{JSON\.stringify\(WATCH_CSS\)\}/g,
    JSON.stringify('')
  );
  bridge = bridge.replace(
    /\$\{JSON\.stringify\(Math\.max\(0, Number\(startAt\) \|\| 0\)\)\}/g,
    '1'
  );
  assert.ok(!bridge.includes('${'), 'bridge template still has a placeholder');
  return bridge;
}

function createHarness() {
  const messages = [];
  const session = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  let now = 0;
  let nextTimerId = 1;
  let timers = [];
  let player;

  const videoListeners = new Map();
  const video = {
    readyState: 2,
    videoWidth: 320,
    duration: 120,
    currentTime: 5,
    paused: true,
    ended: false,
    muted: false,
    volume: 0.2,
    playbackRate: 1,
    error: null,
    buffered: {
      length: 1,
      start() { return 0; },
      end() { return this.length ? 120 : 0; },
    },
    addEventListener(name, fn) {
      const list = videoListeners.get(name) || [];
      list.push(fn);
      videoListeners.set(name, list);
    },
    emit(name) {
      const list = videoListeners.get(name) || [];
      for (const fn of list) fn({ type: name, target: this });
    },
    play() {
      // Model the important Android/YouTube failure: the raw <video> cannot
      // start while YouTube's own player state is paused. The player API has
      // to be moved to playing first.
      if (player && player.playerState === 2) {
        this.paused = true;
        return Promise.resolve();
      }
      if (this.paused || this.ended) {
        this.paused = false;
        this.ended = false;
        this.emit('play');
        this.emit('playing');
      }
      return Promise.resolve();
    },
    pause() {
      if (!this.paused) {
        this.paused = true;
        this.emit('pause');
      }
    },
    getBoundingClientRect() {
      return { width: 320, height: 180 };
    },
    getClientRects() {
      return [{ width: 320, height: 180 }];
    },
  };

  player = {
    playerState: 1,
    classList: { contains() { return false; } },
    querySelector(selector) {
      if (selector === 'video.html5-main-video' || selector === 'video') {
        return video;
      }
      return null;
    },
    querySelectorAll() {
      return [video];
    },
    getPlaybackQuality() {
      return 'hd720';
    },
    getPlayerState() {
      return this.playerState;
    },
    playVideo() {
      this.playerState = 1;
      if (video.paused) video.play();
    },
    pauseVideo() {
      this.playerState = 2;
      if (!video.paused) video.pause();
    },
    unMute() {},
    setVolume() {},
  };

  const styleNodes = new Map();
  function makeNode() {
    return {
      id: '',
      style: {},
      textContent: '',
      appendChild() {},
      setAttribute() {},
      getClientRects() { return []; },
    };
  }
  const documentElement = {
    innerHTML: '',
    appendChild(node) {
      if (node && node.id) styleNodes.set(node.id, node);
    },
  };
  const head = {
    appendChild(node) {
      if (node && node.id) styleNodes.set(node.id, node);
    },
  };
  const body = { innerText: '', appendChild() {} };

  const document = {
    hidden: false,
    documentElement,
    head,
    body,
    getElementById(id) {
      if (id === 'movie_player') return player;
      return styleNodes.get(id) || null;
    },
    querySelector(selector) {
      if (selector.includes('video')) return video;
      if (selector.includes('movie_player')) return player;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return makeNode();
    },
    addEventListener(name, fn) {
      const list = documentListeners.get(name) || [];
      list.push(fn);
      documentListeners.set(name, list);
    },
    dispatch(name) {
      const list = documentListeners.get(name) || [];
      for (const fn of list) fn({ type: name });
    },
  };

  function reminderDelay(delay) {
    const value = Number(delay) || 0;
    return value < 0 ? 0 : value;
  }
  function setTimeoutFake(fn, delay) {
    const id = nextTimerId++;
    timers.push({ id, at: now + reminderDelay(delay), fn, every: 0 });
    return id;
  }
  function setIntervalFake(fn, delay) {
    const id = nextTimerId++;
    const every = Math.max(16, reminderDelay(delay));
    timers.push({ id, at: now + every, fn, every });
    return id;
  }
  function clearTimerFake(id) {
    timers = timers.filter((timer) => timer.id !== id);
  }
  function advance(ms) {
    const end = now + reminderDelay(ms);
    for (let guard = 0; guard < 500; guard += 1) {
      const due = timers
        .filter((timer) => timer.at <= end)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      now = due.at;
      if (due.every) {
        due.at += due.every;
      } else {
        timers = timers.filter((timer) => timer !== due);
      }
      due.fn();
    }
    now = end;
  }

  class FakeXMLHttpRequest {}
  FakeXMLHttpRequest.prototype.open = function () {};
  FakeXMLHttpRequest.prototype.send = function () {};
  FakeXMLHttpRequest.prototype.addEventListener = function () {};

  const location = { href: 'https://m.youtube.com/watch?v=abc' };
  const window = {
    document,
    location,
    innerWidth: 360,
    innerHeight: 800,
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimerFake,
    setInterval: setIntervalFake,
    clearInterval: clearTimerFake,
    sessionStorage: {
      getItem(key) {
        return session.has(key) ? session.get(key) : null;
      },
      setItem(key, value) {
        session.set(String(key), String(value));
      },
      removeItem(key) {
        session.delete(String(key));
      },
    },
    performance: { getEntriesByType() { return []; } },
    XMLHttpRequest: FakeXMLHttpRequest,
    ReactNativeWebView: {
      postMessage(value) {
        messages.push(JSON.parse(value));
      },
    },
    addEventListener(name, fn) {
      const list = windowListeners.get(name) || [];
      list.push(fn);
      windowListeners.set(name, list);
    },
    removeEventListener(name, fn) {
      const list = windowListeners.get(name) || [];
      windowListeners.set(
        name,
        list.filter((item) => item !== fn)
      );
    },
  };
  window.window = window;
  window.globalThis = window;

  const context = vm.createContext(window);
  const bridgeSource = extractBridge();
  function runBridge() {
    vm.runInContext(bridgeSource, context, { filename: 'player-bridge.js' });
  }

  return {
    video,
    player,
    document,
    window,
    session,
    messages,
    runBridge,
    advance,
    get kiss() {
      return window.__kiss;
    },
    get bridge() {
      return window.__kissBridge;
    },
    timeMessages() {
      return messages.filter((message) => message && message.type === 'time');
    },
    lastTime() {
      const list = this.timeMessages();
      return list[list.length - 1] || null;
    },
    emitWindow(name) {
      const list = windowListeners.get(name) || [];
      for (const fn of list) fn({ type: name });
    },
    emitDocument(name) {
      document.dispatch(name);
    },
  };
}

const bridge = extractBridge();

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('the bridge has one playback intent instead of the old pause flags', () => {
  assert.match(bridge, /playIntent:/);
  assert.doesNotMatch(bridge, /bridge\.(hasStarted|userPaused|wantPlay)\b/);
  assert.doesNotMatch(bridge, /if \(!bridge\.hasStarted/);
});

check('the bridge synchronizes both YouTube player and raw video play/pause', () => {
  assert.match(bridge, /function requestPlayerPlay/);
  assert.match(bridge, /p\.playVideo\(\)/);
  assert.match(bridge, /function requestPlayerPause/);
  assert.match(bridge, /p\.pauseVideo\(\)/);
});

check('React sends an explicit play/pause intent rather than a raw toggle', () => {
  assert.match(source, /window\.__kiss\.setPlaying/);
  assert.match(source, /const next = !playingRef\.current/);
});

check('orientation and screen entry reconcile the bridge intent', () => {
  assert.match(source, /scheduleOrientationResume[\s\S]*?window\.__kiss\.reconcile\(\)/);
  assert.match(source, /resetForEntry/);
  assert.match(source, /pauseForScreen/);
  assert.match(source, /useFocusEffect/);
});

const harness = createHarness();

check('the initial bridge starts playback from a fresh page', () => {
  harness.runBridge();
  harness.advance(100);
  assert.equal(harness.video.paused, false);
  assert.equal(harness.lastTime().playing, true);
});

check('a paused YouTube player is revived after an orientation bridge reload', () => {
  harness.player.pauseVideo();
  assert.equal(harness.video.paused, true);
  harness.runBridge();
  harness.advance(100);
  assert.equal(harness.video.paused, false);
  assert.equal(harness.player.playerState, 1);
  assert.equal(harness.lastTime().playing, true);
  assert.equal(harness.lastTime().actualPlaying, true);
});

check('a video already playing with zero frame metadata is not paused by bind', () => {
  harness.video.paused = false;
  harness.video.readyState = 0;
  harness.video.videoWidth = 0;
  if (harness.bridge) harness.bridge.alive = false;
  delete harness.window.__kissBridge;
  delete harness.window.__kiss;
  harness.runBridge();
  harness.advance(50);
  assert.equal(harness.video.paused, false);
  assert.equal(harness.lastTime().playing, true);
  // Restore a normal frame for the remaining cases.
  harness.video.readyState = 2;
  harness.video.videoWidth = 320;
  harness.player.playerState = 1;
});

check('an explicit pause survives a bridge reload and resume does not undo it', () => {
  harness.kiss.pause();
  harness.advance(100);
  assert.equal(harness.video.paused, true);
  assert.equal(harness.bridge.playIntent, 'pause');
  assert.equal(harness.lastTime().playing, false);

  harness.runBridge();
  harness.advance(100);
  assert.equal(harness.video.paused, true);
  assert.equal(harness.bridge.playIntent, 'pause');

  harness.kiss.resume();
  harness.advance(100);
  assert.equal(harness.video.paused, true);
});

check('entering the player resets a paused intent and starts playback', () => {
  harness.kiss.resetForEntry();
  harness.advance(120);
  assert.equal(harness.video.paused, false);
  assert.equal(harness.bridge.playIntent, 'play');
  assert.equal(harness.player.playerState, 1);
});

check('setPlaying is idempotent and does not flip a playing video to pause', () => {
  harness.kiss.setPlaying(true);
  harness.advance(80);
  assert.equal(harness.video.paused, false);

  harness.kiss.setPlaying(true);
  harness.advance(80);
  assert.equal(harness.video.paused, false);

  harness.kiss.setPlaying(false);
  harness.advance(80);
  assert.equal(harness.video.paused, true);

  harness.kiss.setPlaying(true);
  harness.advance(80);
  assert.equal(harness.video.paused, false);
});

check('a blind-listening boundary pause is not undone by orientation reconcile', () => {
  harness.kiss.play();
  harness.advance(80);
  harness.video.currentTime = 9;
  harness.kiss.pauseAt(10);
  harness.advance(50);
  harness.video.currentTime = 10.2;
  harness.advance(120);
  assert.equal(harness.video.paused, true);
  assert.equal(harness.bridge.playIntent, 'pause');
  assert.equal(harness.bridge.pauseReason, 'boundary');

  harness.kiss.reconcile();
  harness.advance(120);
  assert.equal(harness.video.paused, true);
  assert.equal(harness.bridge.playIntent, 'pause');
});

check('bridge reload routes video events through the current bridge', () => {
  harness.kiss.resetForEntry();
  harness.advance(80);
  assert.equal(harness.video.__kissEventRouter, true);
  assert.equal(harness.bridge.playIntent, 'play');
  harness.video.currentTime = 33;
  harness.video.emit('timeupdate');
  assert.equal(harness.lastTime().current, 33);
  assert.equal(harness.lastTime().playing, true);
});

console.log(`player-playback-intent: ${count} checks passed`);

