import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app/player.tsx', import.meta.url), 'utf8');
// The bridge lives in its own module now; the RN screen only talks to it.
const bridgeModule = fs.readFileSync(
  new URL('../src/player/bridgeScript.ts', import.meta.url),
  'utf8'
);

function extractBridge() {
  const start = bridgeModule.indexOf('export function playerBridgeScript(');
  const bodyStart = bridgeModule.indexOf('return `', start);
  const bodyEnd = bridgeModule.indexOf('`;', bodyStart + 8);
  assert.ok(start >= 0 && bodyStart > start && bodyEnd > bodyStart);
  let bridge = bridgeModule.slice(bodyStart + 8, bodyEnd);
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
    playCalls: 0,
    pauseCalls: 0,
    autoPauseOnPlay: 0,
    autoPauseDelay: 220,
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
      this.playCalls += 1;
      this.playerState = 1;
      if (video.paused) video.play();
      if (this.autoPauseOnPlay > 0) {
        this.autoPauseOnPlay -= 1;
        const owner = this;
        setTimeoutFake(function () {
          if (owner.playerState !== 1) return;
          owner.playerState = 2;
          if (!video.paused) video.pause();
        }, this.autoPauseDelay);
      }
    },
    pauseVideo() {
      this.pauseCalls += 1;
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
    Date: { now() { return now; } },
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
    after(delay, fn) {
      return setTimeoutFake(fn, delay);
    },
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
  assert.match(source, /createTransitionGate\(/);
  assert.match(source, /window\.__kiss\.layoutStart\(/);
  assert.match(source, /window\.__kiss\.layoutStable\(/);
  assert.match(source, /gateRef\.current\?\.observeLayout\(/);
  assert.match(source, /beginTransition\('app-active', \{ expectLayout: false \}\)/);
  assert.match(source, /resetForEntry/);
  assert.match(source, /pauseForScreen/);
  assert.match(source, /useFocusEffect/);
  assert.doesNotMatch(source, /scheduleOrientationResume/);
  assert.doesNotMatch(source, /__kiss\.orientation\(/);
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

check('a paused YouTube player is reported as not playing even if the raw video flag says playing', () => {
  const h = createHarness();
  h.runBridge();
  h.advance(100);
  assert.equal(h.player.playerState, 1);
  assert.equal(h.video.paused, false);

  h.player.playerState = 2;
  h.advance(950);
  assert.equal(h.lastTime().actualPlaying, false, 'YouTube playerState=2 must override video.paused=false');
  assert.equal(h.lastTime().playerState, 2);

  h.kiss.reconcile();
  h.advance(320);
  assert.equal(h.player.playerState, 1, 'reconcile must revive a paused YouTube player');
  assert.equal(h.video.paused, false);
});

check('repeated reconciles do not reissue play to an already playing YouTube player', () => {
  const h = createHarness();
  h.runBridge();
  h.advance(100);
  const before = h.player.playCalls;
  assert.equal(h.video.paused, false);

  h.kiss.reconcile();
  h.advance(80);
  h.kiss.reconcile();
  h.advance(80);
  h.kiss.setPlaying(true);
  h.advance(80);

  assert.equal(
    h.player.playCalls,
    before,
    'a playing player must not receive duplicate playVideo commands'
  );
});

check('pause events inside the layout transition do not create a play/pause feedback loop', () => {
  const h = createHarness();
  h.runBridge();
  h.advance(100);
  h.player.autoPauseOnPlay = 99;
  const before = h.player.playCalls;

  h.kiss.layoutStart(1);
  h.player.pauseVideo();
  h.kiss.reconcile();
  h.advance(400);

  assert.equal(
    h.player.playCalls,
    before,
    'no play command may be issued while the surface is resizing'
  );

  h.kiss.layoutStable(1);
  h.advance(1500);
  const afterSettle = h.player.playCalls;
  assert.ok(
    afterSettle - before <= 2,
    `settle recovery looped ${afterSettle - before} times; expected at most 2`
  );

  h.advance(3000);
  assert.equal(
    h.player.playCalls,
    afterSettle,
    'the bounded repair must not keep fighting pauses forever'
  );
});

check('late pauses inside the settle window are repaired within a hard budget', () => {
  const h = createHarness();
  h.runBridge();
  h.advance(100);
  const before = h.player.playCalls;

  h.kiss.layoutStart(9);
  h.kiss.layoutStable(9);
  h.advance(100);
  assert.equal(h.video.paused, false);

  // YouTube emits one more pause just after the surface settled.
  h.player.playerState = 2;
  h.video.pause();
  h.advance(300);
  assert.equal(h.video.paused, false, 'the late pause must be repaired');
  assert.equal(h.player.playCalls, before + 1);

  // A second late pause uses the last unit of the recovery budget.
  h.player.playerState = 2;
  h.video.pause();
  h.advance(600);
  assert.ok(
    h.player.playCalls - before <= 2,
    `late repairs must stay within the two-command budget, got ${h.player.playCalls - before}`
  );

  // A third pause inside the window is not fought any more.
  h.player.playerState = 2;
  h.video.pause();
  const beforeThird = h.player.playCalls;
  h.advance(600);
  assert.equal(h.video.paused, true, 'the budget must be exhausted after two repairs');
  assert.equal(h.player.playCalls, beforeThird);

  // Outside the settle window a pause is never fought at all.
  h.kiss.reconcile();
  h.advance(200);
  assert.equal(h.video.paused, false);
  h.advance(2000);
  const afterWindow = h.player.playCalls;
  h.player.playerState = 2;
  h.video.pause();
  h.advance(800);
  assert.equal(h.video.paused, true, 'a pause outside the settle window must not be repaired');
  assert.equal(h.player.playCalls, afterWindow);
});

check('a stale layout handshake cannot resume an older rotation', () => {
  const h = createHarness();
  h.runBridge();
  h.advance(100);
  h.player.pauseVideo();
  const before = h.player.playCalls;

  h.kiss.layoutStart(7);
  // A late "stable" message from an older epoch must be ignored.
  h.kiss.layoutStable(6);
  h.advance(300);
  assert.equal(h.player.playCalls, before);
  assert.equal(h.bridge.phase, 'transition');

  h.kiss.layoutStable(7);
  h.advance(400);
  assert.equal(h.bridge.phase, 'steady');
  assert.ok(h.player.playCalls > before, 'the current epoch must recover playback');
});

check('a lost stable message is closed by the transition guard', () => {
  const h = createHarness();
  h.runBridge();
  h.advance(100);
  h.player.pauseVideo();
  const before = h.player.playCalls;

  h.kiss.layoutStart(3);
  h.advance(1500);
  assert.equal(h.bridge.phase, 'steady', 'the guard must close a stranded transition');
  assert.ok(h.player.playCalls > before, 'the guard recovery restores playback once');
});

check('a user pause during a transition is not resumed by the settle handshake', () => {
  const h = createHarness();
  h.runBridge();
  h.advance(100);

  h.kiss.layoutStart(2);
  h.kiss.pause();
  h.advance(100);
  assert.equal(h.bridge.playIntent, 'pause');

  h.kiss.layoutStable(2);
  h.advance(1200);
  assert.equal(h.video.paused, true);
  assert.equal(h.bridge.playIntent, 'pause');
});

check('the ready message carries actual playback state for the loading overlay', () => {
  const h = createHarness();
  h.runBridge();
  h.advance(120);
  const ready = h.messages.find((message) => message && message.type === 'ready');
  assert.ok(ready, 'bridge did not send ready');
  assert.equal(typeof ready.actualPlaying, 'boolean');
  assert.equal(ready.actualPlaying, true);
  assert.equal(ready.playerState, 1);
});

check('play after a fullscreen pause survives one late YouTube pause without looping', () => {
  const h = createHarness();
  h.runBridge();
  h.advance(100);
  h.kiss.layoutStart(1);
  h.kiss.pause();
  h.advance(80);
  assert.equal(h.video.paused, true);
  assert.equal(h.bridge.playIntent, 'pause');

  h.player.autoPauseOnPlay = 1;
  h.kiss.setPlaying(true);
  h.advance(100);
  assert.equal(h.video.paused, true, 'play is deferred while the surface is resizing');

  h.kiss.layoutStable(1);
  h.advance(1200);

  assert.equal(h.bridge.playIntent, 'play');
  assert.equal(h.player.playerState, 1);
  assert.equal(h.video.paused, false);
  assert.ok(
    h.player.playCalls <= 3,
    `explicit play plus one recovery should use at most 3 play calls, got ${h.player.playCalls}`
  );
});

check('rotation recovery waits for the surface to settle and issues one play command', () => {
  const h = createHarness();
  h.runBridge();
  h.advance(500);
  h.player.pauseVideo();
  const before = h.player.playCalls;

  h.kiss.layoutStart(4);
  h.kiss.reconcile();
  h.advance(400);
  assert.equal(
    h.player.playCalls,
    before,
    'a reconcile during surface recreation must not fight transient pauses'
  );

  h.kiss.layoutStable(4);
  h.advance(400);

  assert.equal(h.player.playCalls, before + 1, 'the settled rotation should recover once');
  assert.equal(h.video.paused, false);
  assert.equal(h.player.playerState, 1);
  assert.equal(h.lastTime().playing, true);
});

check('the legacy orientation call still opens a transition that the guard closes', () => {
  const h = createHarness();
  h.runBridge();
  h.advance(100);
  h.player.pauseVideo();
  const before = h.player.playCalls;

  h.kiss.orientation();
  h.advance(200);
  assert.equal(h.bridge.phase, 'transition');
  assert.equal(h.player.playCalls, before);

  h.advance(1400);
  assert.equal(h.bridge.phase, 'steady');
  assert.equal(h.player.playCalls, before + 1);
});

check('the loading overlay is gated by a decoded frame, not playback intent', () => {
  const match = source.match(
    /function shouldClearVideoLoading\(message: any\) \{[\s\S]*?\n\}/
  );
  assert.ok(match, 'missing pure video loading gate');
  const gate = vm.runInNewContext(`(${match[0].replace('message: any', 'message')})`);

  assert.equal(gate({ type: 'time', actualPlaying: true, playing: true, ready: false }), false);
  assert.equal(gate({ type: 'time', actualPlaying: true, playing: true, ready: true }), true);
  assert.equal(gate({ type: 'time', actualPlaying: false, playing: false, ready: false }), false);
  assert.equal(gate({ type: 'time', actualPlaying: false, playing: false, ready: true }), true);
  assert.equal(gate({ type: 'ready', actualPlaying: false, playing: true }), false);
  assert.equal(gate({ type: 'ready', actualPlaying: false, playing: false }), true);
});

check('onLoadEnd refresh reuses the bridge instead of resetting playback state', () => {
  const h = createHarness();
  h.runBridge();
  h.advance(100);
  h.kiss.pause();
  h.advance(100);
  const original = h.bridge;
  const beforePauseCalls = h.player.pauseCalls;

  assert.equal(typeof h.kiss.refresh, 'function');
  h.kiss.refresh();
  h.advance(100);

  assert.equal(h.bridge, original, 'refresh must not create a replacement state machine');
  assert.equal(h.bridge.playIntent, 'pause');
  assert.equal(h.video.paused, true);
  assert.equal(h.player.pauseCalls, beforePauseCalls, 'refresh must not repeat pause commands');
});

check('a precision boundary emits one explicit cue-ended event', () => {
  const h = createHarness();
  h.runBridge();
  h.video.paused = false;
  h.player.playerState = 1;
  h.video.currentTime = 29;

  h.advance(100);
  h.kiss.pauseAt(30);
  h.advance(20);
  h.video.currentTime = 31;
  h.advance(32);
  assert.equal(h.bridge.playIntent, 'pause');
  assert.equal(h.messages.filter((message) => message.type === 'cue-ended').length, 1);
  assert.equal(h.messages.find((message) => message.type === 'cue-ended')?.cueEnd, 30);

  h.advance(200);
  assert.equal(h.messages.filter((message) => message.type === 'cue-ended').length, 1);
  assert.match(source, /message\.type === 'cue-ended'/);
});

check('returning from settings restores the previous play state', () => {
  const match = source.match(/function focusPlaybackAction\([\s\S]*?\n\}/);
  assert.ok(match, 'missing focus playback policy');
  const body = match[0].replace(
    /function focusPlaybackAction\([\s\S]*?\{/,
    'function focusPlaybackAction(isNewEntry, shouldResume) {'
  );
  const action = vm.runInNewContext(`(${body})`);
  assert.equal(action(true, true), 'reset');
  assert.equal(action(true, false), 'reset');
  assert.equal(action(false, true), 'play');
  assert.equal(action(false, false), 'pause');
  assert.match(source, /resumeOnFocusRef\.current = playingRef\.current/);
});

console.log(`player-playback-intent: ${count} checks passed`);

