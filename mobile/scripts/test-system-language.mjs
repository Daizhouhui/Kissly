import assert from 'node:assert/strict';

import { resolveSystemSource } from '../src/core/translate/language.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('auto uses the caption language, not English', () => {
  assert.equal(resolveSystemSource('auto', 'ja'), 'ja');
  assert.equal(resolveSystemSource('AUTO', 'ko'), 'ko');
});

check('empty source falls back to the caption language', () => {
  assert.equal(resolveSystemSource('', 'es'), 'es');
  assert.equal(resolveSystemSource(undefined, 'fr'), 'fr');
});

check('an explicit source language wins over the caption language', () => {
  assert.equal(resolveSystemSource('de', 'ja'), 'de');
  assert.equal(resolveSystemSource('zh-CN', 'ko'), 'zh-CN');
});

check('missing learning language keeps the old English default', () => {
  assert.equal(resolveSystemSource('auto', ''), 'en');
  assert.equal(resolveSystemSource(undefined, undefined), 'en');
});

check('whitespace is trimmed', () => {
  assert.equal(resolveSystemSource('  auto ', ' ja '), 'ja');
  assert.equal(resolveSystemSource(' en ', 'ja'), 'en');
});

console.log(`system-language: ${count} assertions passed`);
