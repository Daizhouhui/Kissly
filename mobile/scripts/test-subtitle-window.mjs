import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./ts-resolve.mjs', import.meta.url);

const {
  computeWindow,
  extendWindow,
  isAnchorOutsideWindow,
  isSeekJump,
  needsWindowRefill,
  videoEndSeconds,
} = await import('../src/core/translate/window.ts');

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

function makeCues(count, step = 1) {
  return Array.from({ length: count }, (_, index) => ({
    start: index * step,
    end: (index + 1) * step,
    text: `line${index}`,
  }));
}

check('anchor 0 opens a 0–120s window capped at 40 cues', () => {
  const cues = makeCues(3000);
  const window = computeWindow(cues, 0, 3000);
  assert.ok(window);
  assert.equal(window.startTime, 0);
  assert.equal(window.endTime, 120);
  assert.equal(window.startIndex, 0);
  assert.ok(window.endIndex - window.startIndex + 1 <= 40, 'window stays under 40 cues');
});

check('anchor 60 shifts the window to 45–180s and keeps the current cue', () => {
  const cues = makeCues(3000);
  const window = computeWindow(cues, 60, 3000);
  assert.ok(window);
  assert.equal(window.startTime, 45);
  assert.equal(window.endTime, 180);
  assert.ok(window.startIndex <= 60 && window.endIndex >= 60);
});

check('a window near the end never passes the video duration', () => {
  const cues = makeCues(3000);
  const window = computeWindow(cues, 2990, 3000);
  assert.ok(window);
  assert.equal(window.endTime, 3000);
  assert.equal(window.endIndex, 2999);
  assert.ok(window.startIndex <= 2990 && window.endIndex >= 2990);
});

check('dense captions truncate to 40 cues around the anchor cue', () => {
  // 200 lines at 0.5s over 100s: the time window alone would include 130 lines.
  const cues = makeCues(200, 0.5);
  const window = computeWindow(cues, 50, 100);
  assert.ok(window);
  assert.equal(window.endIndex - window.startIndex + 1, 40);
  assert.ok(window.startIndex <= 100 && window.endIndex >= 100, 'anchor cue stays inside');
});

check('a short video takes the whole list in one window', () => {
  const cues = makeCues(20);
  const window = computeWindow(cues, 5, 20);
  assert.ok(window);
  assert.equal(window.startIndex, 0);
  assert.equal(window.endIndex, 19);
});

check('seek detection uses a 10s tolerance', () => {
  const cues = makeCues(3000);
  const window = computeWindow(cues, 60, 3000); // 45–180
  assert.equal(isSeekJump(window, 185), false, '5s past the window is not a seek');
  assert.equal(isSeekJump(window, 195), true, '15s past the window is a seek');
  assert.equal(isSeekJump(window, 40), false, '5s before the window is not a seek');
  assert.equal(isSeekJump(window, 20), true, '25s before the window is a seek');
});

check('near-window anchor moves are detected separately from a seek', () => {
  const cues = makeCues(3000);
  const window = computeWindow(cues, 60, 3000);
  assert.equal(isAnchorOutsideWindow(window, 50), false);
  assert.equal(isAnchorOutsideWindow(window, 190), true);
});

check('playback refills the tail when under 30s of look-ahead remains', () => {
  const cues = makeCues(3000);
  const window = computeWindow(cues, 0, 3000); // 0–120
  assert.equal(needsWindowRefill(window, 60, 3000), false);
  assert.equal(needsWindowRefill(window, 100, 3000), true);
  const tail = computeWindow(cues, 2990, 3000);
  assert.equal(needsWindowRefill(tail, 2999, 3000), false, 'near the end no refill is needed');
});

check('extendWindow keeps the start and only grows the tail while under the cap', () => {
  // One line every 10s: 120s of look-ahead is ~13 cues, so the extension stays
  // inside the 40-cue cap and the original start survives.
  const cues = makeCues(300, 10);
  const window = computeWindow(cues, 0, 3000);
  const extended = extendWindow(window, cues, 100, 3000);
  assert.equal(extended.startIndex, window.startIndex);
  assert.equal(extended.endTime, 220);
  assert.ok(extended.endIndex > window.endIndex);
});

check('extending past 40 cues rebuilds around the anchor instead of growing forever', () => {
  const cues = makeCues(3000);
  const window = computeWindow(cues, 0, 3000); // 0–119, ≤ 40 cues
  const extended = extendWindow(window, cues, 100, 3000); // 0–220 would be 221 cues
  assert.ok(
    extended.endIndex - extended.startIndex + 1 <= 40,
    'window never exceeds the 40-cue cap'
  );
  assert.ok(
    extended.startIndex <= 100 && extended.endIndex >= 100,
    'the current cue stays inside the rebuilt window'
  );
  assert.ok(extended.startIndex > window.startIndex, 'the far tail was dropped');
});

check('missing duration falls back to the last cue end', () => {
  const cues = makeCues(20, 2); // 0–40s
  assert.equal(videoEndSeconds(cues, undefined), 40);
  const window = computeWindow(cues, 39, undefined);
  assert.ok(window);
  assert.ok(window.endTime <= 40);
});

console.log(`subtitle-window: ${count} checks passed`);
