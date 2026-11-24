import assert from 'node:assert/strict';

import { GLOBAL_CACHE_PREFIXES } from '../src/core/cacheKeys.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('global cache clear covers every disposable cache family', () => {
  for (const prefix of ['captions:', 'cues:', 'feed:', 'channel:first:', 'title-cache', 'video-meta:']) {
    assert.ok(GLOBAL_CACHE_PREFIXES.includes(prefix), prefix);
  }
});

check('global cache clear never targets user data', () => {
  for (const prefix of ['app', 'history', 'favorites', 'subscriptions', 'settings', 'webdav']) {
    assert.ok(!GLOBAL_CACHE_PREFIXES.includes(prefix), prefix);
  }
});

console.log(`cache-keys: ${count} assertions passed`);
