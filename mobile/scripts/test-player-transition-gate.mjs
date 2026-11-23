import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, '..', 'src', 'player', 'transitionGate.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

function loadGate() {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({ exports: module.exports, module, console });
  vm.runInContext(js, context, { filename: 'transitionGate.js' });
  return module.exports.createTransitionGate;
}

const createTransitionGate = loadGate();

function createClock() {
  let now = 0;
  let nextId = 1;
  let timers = [];
  const setTimeoutFake = (fn, ms) => {
    const id = nextId++;
    timers.push({ id, at: now + Math.max(0, Number(ms) || 0), fn });
    return id;
  };
  const clearTimeoutFake = (id) => {
    timers = timers.filter((timer) => timer.id !== id);
  };
  const advance = (ms) => {
    const end = now + ms;
    for (let guard = 0; guard < 200; guard += 1) {
      const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      now = due.at;
      timers = timers.filter((timer) => timer !== due);
      due.fn();
    }
    now = end;
  };
  return { now: () => now, setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake, advance };
}

function createHarness(extra = {}) {
  const clock = createClock();
  const events = [];
  const gate = createTransitionGate({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onStart: (epoch, trigger) => events.push({ type: 'start', epoch, trigger }),
    onSettle: (epoch, trigger, reason) => events.push({ type: 'settle', epoch, trigger, reason }),
    ...extra,
  });
  return { clock, gate, events };
}

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('a transition stays open until the stage reports one stable size', () => {
  const h = createHarness();
  h.gate.begin('orientation-lock');
  h.clock.advance(139);
  assert.equal(h.events.filter((e) => e.type === 'settle').length, 0);

  h.gate.observeLayout(800, 360);
  h.clock.advance(139);
  assert.equal(h.events.filter((e) => e.type === 'settle').length, 0, 'quiet window restarted by the resize');

  h.clock.advance(1);
  const settles = h.events.filter((e) => e.type === 'settle');
  assert.equal(settles.length, 1);
  assert.equal(settles[0].reason, 'quiet');
  assert.equal(settles[0].epoch, 1);
});

check('a burst of resize reports produces exactly one settle', () => {
  const h = createHarness();
  h.gate.begin('rotation');
  h.gate.observeLayout(360, 800);
  h.clock.advance(50);
  h.gate.observeLayout(800, 360);
  h.clock.advance(50);
  h.gate.observeLayout(780, 350);
  h.clock.advance(200);

  const settles = h.events.filter((e) => e.type === 'settle');
  assert.equal(settles.length, 1);
  assert.equal(h.gate.isActive(), false);
});

check('duplicate layouts of the same size do not extend the quiet window', () => {
  const h = createHarness();
  h.gate.begin('rotation');
  h.gate.observeLayout(800, 360);
  h.clock.advance(100);
  h.gate.observeLayout(800, 360);
  h.clock.advance(40);
  assert.equal(h.events.filter((e) => e.type === 'settle').length, 1);
});

check('returns from background close after the quiet window without layout', () => {
  const h = createHarness();
  h.gate.begin('app-active', { expectLayout: false });
  h.clock.advance(139);
  assert.equal(h.events.some((e) => e.type === 'settle'), false);
  h.clock.advance(1);
  const settles = h.events.filter((e) => e.type === 'settle');
  assert.equal(settles.length, 1);
  assert.equal(settles[0].reason, 'quiet');
});

check('a lost layout never strands the transition past the guard', () => {
  const h = createHarness();
  h.gate.begin('orientation-lock');
  h.clock.advance(1199);
  assert.equal(h.events.some((e) => e.type === 'settle'), false);
  h.clock.advance(1);
  const settles = h.events.filter((e) => e.type === 'settle');
  assert.equal(settles.length, 1);
  assert.equal(settles[0].reason, 'guard');
  assert.equal(h.gate.isActive(), false);
});

check('a fullscreen toggle waits for the real rotation, not just the React layout', () => {
  const h = createHarness();
  h.gate.begin('orientation-lock', { expectLayout: true, expectRotation: true });
  // Pressing fullscreen re-lays the stage immediately, the device rotates later.
  h.gate.observeLayout(800, 360);
  h.clock.advance(400);
  assert.equal(
    h.events.filter((e) => e.type === 'settle').length,
    0,
    'must not resume before the physical rotation'
  );

  h.gate.observeRotation();
  h.gate.observeLayout(780, 350);
  h.clock.advance(200);
  const settles = h.events.filter((e) => e.type === 'settle');
  assert.equal(settles.length, 1);
});

check('rotation arriving before the layout report still settles once', () => {
  const h = createHarness();
  h.gate.begin('orientation-lock', { expectLayout: true, expectRotation: true });
  h.clock.advance(30);
  h.gate.observeRotation();
  h.clock.advance(200);
  assert.equal(h.events.filter((e) => e.type === 'settle').length, 0, 'layout report still required');

  h.gate.observeLayout(360, 780);
  h.clock.advance(200);
  assert.equal(h.events.filter((e) => e.type === 'settle').length, 1);
});

check('every transition carries a new epoch so late messages can be dropped', () => {
  const h = createHarness();
  const first = h.gate.begin('orientation-lock');
  h.clock.advance(200);
  const second = h.gate.begin('rotation');
  assert.equal(first, 1);
  assert.equal(second, 2);
  assert.equal(h.gate.epoch(), 2);

  h.gate.observeLayout(800, 360);
  h.clock.advance(200);
  const settles = h.events.filter((e) => e.type === 'settle');
  assert.equal(settles.length, 1, 'the aborted first transition must not settle');
  assert.equal(settles[0].epoch, 2);
});

check('observeLayout is ignored once the transition is closed', () => {
  const h = createHarness();
  h.gate.begin('rotation');
  h.gate.observeLayout(800, 360);
  h.clock.advance(200);
  const settlesBefore = h.events.filter((e) => e.type === 'settle').length;
  assert.equal(settlesBefore, 1);

  h.gate.observeLayout(400, 900);
  h.clock.advance(300);
  assert.equal(h.events.filter((e) => e.type === 'settle').length, settlesBefore);
  assert.equal(h.gate.isActive(), false);
});

check('dispose cancels a pending settle', () => {
  const h = createHarness();
  h.gate.begin('rotation');
  h.gate.dispose();
  h.clock.advance(3000);
  assert.equal(h.events.filter((e) => e.type === 'settle').length, 0);
  assert.equal(h.gate.isActive(), false);
});

check('the gate module is the only scheduler of play recovery', () => {
  const player = fs.readFileSync(
    path.join(here, '..', 'app', 'player.tsx'),
    'utf8'
  );
  assert.match(player, /beginTransition\('orientation-lock'/);
  assert.match(player, /beginTransition\('rotation'/);
  assert.match(player, /beginTransition\('app-active', \{ expectLayout: false \}\)/);
  assert.doesNotMatch(player, /\[800, 1800\]/);
  assert.doesNotMatch(player, /orientationUntil/);
});

console.log(`player-transition-gate: ${count} checks passed`);
