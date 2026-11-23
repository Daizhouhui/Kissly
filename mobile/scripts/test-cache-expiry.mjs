import assert from 'node:assert/strict';

import { shouldPruneCacheEntry } from '../src/core/cacheExpiry.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;

check('a fresh cache entry is kept', () => {
  assert.equal(
    shouldPruneCacheEntry(JSON.stringify({ at: NOW - 5 * DAY, value: [] }), 30 * DAY, NOW),
    false
  );
});

check('an expired cache entry is pruned', () => {
  assert.equal(
    shouldPruneCacheEntry(JSON.stringify({ at: NOW - 40 * DAY, value: [] }), 30 * DAY, NOW),
    true
  );
});

check('an entry exactly at the TTL edge is kept', () => {
  assert.equal(
    shouldPruneCacheEntry(JSON.stringify({ at: NOW - 30 * DAY, value: [] }), 30 * DAY, NOW),
    false
  );
});

check('malformed JSON is not deleted', () => {
  assert.equal(shouldPruneCacheEntry('not json', 30 * DAY, NOW), false);
});

check('a legacy entry without an at field is not deleted', () => {
  assert.equal(shouldPruneCacheEntry(JSON.stringify({ value: [] }), 30 * DAY, NOW), false);
});

console.log(`cache-expiry: ${count} assertions passed`);
