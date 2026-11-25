import assert from 'node:assert/strict';

import {
  batchIndexAtAnchor,
  cueBatchRanges,
  pickNextCueBatch,
} from '../src/core/translate/schedule.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

const ranges = cueBatchRanges(25, 12);

check('the last batch carries the remainder', () => {
  assert.deepEqual(ranges, [
    { start: 0, end: 12 },
    { start: 12, end: 24 },
    { start: 24, end: 25 },
  ]);
});

check('missing anchors start at the first batch', () => {
  assert.equal(batchIndexAtAnchor(ranges, -1), 0);
  assert.equal(batchIndexAtAnchor(ranges, NaN), 0);
  assert.equal(cueBatchRanges(0, 12).length, 0);
});

check('anchor indexes resolve to their containing batch', () => {
  assert.equal(batchIndexAtAnchor(ranges, 0), 0);
  assert.equal(batchIndexAtAnchor(ranges, 11), 0);
  assert.equal(batchIndexAtAnchor(ranges, 12), 1);
  assert.equal(batchIndexAtAnchor(ranges, 23), 1);
  assert.equal(batchIndexAtAnchor(ranges, 24), 2);
  assert.equal(batchIndexAtAnchor(ranges, 9999), 2);
});

check('pending batches sweep forward before filling earlier gaps', () => {
  const pending = new Set([0, 1, 2]);
  assert.equal(pickNextCueBatch(ranges, 13, (index) => pending.has(index)), 1);
  pending.delete(1);
  assert.equal(pickNextCueBatch(ranges, 13, (index) => pending.has(index)), 2);
  pending.delete(2);
  assert.equal(pickNextCueBatch(ranges, 13, (index) => pending.has(index)), 0);
});

check('a changed anchor reprioritizes only pending batches', () => {
  const pending = new Set([0, 2]);
  assert.equal(pickNextCueBatch(ranges, 25, (index) => pending.has(index)), 2);
  pending.delete(2);
  assert.equal(pickNextCueBatch(ranges, 25, (index) => pending.has(index)), 0);
  assert.equal(pickNextCueBatch(ranges, 0, (index) => pending.has(index)), 0);
});

check('no pending batch returns -1', () => {
  assert.equal(pickNextCueBatch(ranges, 0, () => false), -1);
  assert.equal(pickNextCueBatch([], 0, () => true), -1);
});

console.log(`cue-schedule: ${count} assertions passed`);
