import assert from 'node:assert/strict';

import { findCueIndexAt } from '../src/core/cueIndex.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

const cues = [
  { start: 0 },
  { start: 2 },
  { start: 5.5 },
  { start: 10 },
  { start: 100 },
];

check('before the first cue returns -1', () => {
  assert.equal(findCueIndexAt(cues, -5), -1);
});

check('the first cue is active at zero', () => {
  assert.equal(findCueIndexAt(cues, 0), 0);
});

check('an exact start selects that cue', () => {
  assert.equal(findCueIndexAt(cues, 5.5), 2);
});

check('between cues selects the previous cue', () => {
  assert.equal(findCueIndexAt(cues, 7), 2);
});

check('the 0.12s tolerance helps early playback ticks', () => {
  assert.equal(findCueIndexAt(cues, 5.4), 2);
  assert.equal(findCueIndexAt(cues, 5.3), 1);
});

check('after the last cue selects the last cue', () => {
  assert.equal(findCueIndexAt(cues, 1000), 4);
});

check('an empty list returns -1', () => {
  assert.equal(findCueIndexAt([], 3), -1);
});

console.log(`cue-index: ${count} assertions passed`);
