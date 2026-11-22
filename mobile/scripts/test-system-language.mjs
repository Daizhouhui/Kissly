import assert from 'node:assert/strict';

import {
  assertSystemLanguageSupported,
  normalizeSystemLanguage,
  resolveSystemSource,
  SYSTEM_TRANSLATE_LANGUAGES,
  UnsupportedSystemLanguageError,
} from '../src/core/translate/language.ts';

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

check('regional and script suffixes use the ML Kit base code', () => {
  assert.equal(normalizeSystemLanguage('zh-Hans'), 'zh');
  assert.equal(normalizeSystemLanguage('zh-CN'), 'zh');
  assert.equal(normalizeSystemLanguage('zh_TW'), 'zh');
  assert.equal(normalizeSystemLanguage('pt-BR'), 'pt');
  assert.equal(normalizeSystemLanguage('EN-us'), 'en');
});

check('historical language aliases are canonicalized', () => {
  assert.equal(normalizeSystemLanguage('iw'), 'he');
  assert.equal(normalizeSystemLanguage('in'), 'id');
  assert.equal(normalizeSystemLanguage('fil'), 'tl');
  assert.equal(normalizeSystemLanguage('nb'), 'no');
  assert.equal(normalizeSystemLanguage('cmn'), 'zh');
});

check('supported languages pass and return the native code', () => {
  assert.equal(SYSTEM_TRANSLATE_LANGUAGES.size, 59);
  assert.equal(assertSystemLanguageSupported('en', '原文'), 'en');
  assert.equal(assertSystemLanguageSupported('ja-JP', '原文'), 'ja');
  assert.equal(assertSystemLanguageSupported('zh-TW', '译文'), 'zh');
  assert.equal(assertSystemLanguageSupported('pt-BR', '译文'), 'pt');
  for (const code of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de']) {
    assert.ok(SYSTEM_TRANSLATE_LANGUAGES.has(normalizeSystemLanguage(code)), code);
  }
});

check('unsupported languages fail with a friendly message', () => {
  assert.equal(normalizeSystemLanguage('yue'), 'yue');
  assert.throws(
    () => assertSystemLanguageSupported('yue', '原文'),
    (error) => {
      assert.ok(error instanceof UnsupportedSystemLanguageError);
      assert.equal(error.code, 'ERR_SYSTEM_LANGUAGE');
      assert.match(error.message, /系统翻译不支持原文语言/);
      assert.match(error.message, /微软\/谷歌/);
      return true;
    }
  );
});

check('auto and blank tags never reach the native module', () => {
  assert.throws(() => assertSystemLanguageSupported('auto', '原文'), UnsupportedSystemLanguageError);
  assert.throws(() => assertSystemLanguageSupported('', '译文'), UnsupportedSystemLanguageError);
});

console.log(`system-language: ${count} assertions passed`);
