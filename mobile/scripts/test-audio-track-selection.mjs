import assert from 'node:assert/strict';

import { pickPreferredAudioTrack } from '../src/core/youtube/audioTrackSelection.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

const track = (id, name, isOriginal = false) => ({ id, name, isOriginal });

check('keeps an English UK original when US is preferred', () => {
  const picked = pickPreferredAudioTrack(
    [
      track('en-GB.5', '英语 (UK) 原始', true),
      track('en-US.3', '英语 (US)'),
      track('en.4', '英语'),
    ],
    'en',
    'en-US'
  );
  assert.equal(picked?.id, 'en-GB.5');
});

check('keeps an English original even when a US dub exists', () => {
  const picked = pickPreferredAudioTrack(
    [
      track('en-US.3', '英语 (US)'),
      track('en.4', '英语原始', true),
    ],
    'en',
    'en-GB'
  );
  assert.equal(picked?.id, 'en.4');
});

check('prefers US English when the original is another language', () => {
  const picked = pickPreferredAudioTrack(
    [
      track('es.2', '西班牙语原始', true),
      track('en-GB.5', '英语 (UK)'),
      track('en-US.3', '英语 (US)'),
    ],
    'en',
    'en-US'
  );
  assert.equal(picked?.id, 'en-US.3');
});

check('honours the UK setting for English dubs', () => {
  const picked = pickPreferredAudioTrack(
    [
      track('es.2', '西班牙语原始', true),
      track('en-US.3', '英语 (US)'),
      track('en-GB.5', '英语 (UK)'),
    ],
    'en',
    'en-GB'
  );
  assert.equal(picked?.id, 'en-GB.5');
});

check('uses generic English when the preferred variant is absent', () => {
  const picked = pickPreferredAudioTrack(
    [
      track('es.2', '西班牙语原始', true),
      track('en.4', '英语'),
    ],
    'en',
    'en-US'
  );
  assert.equal(picked?.id, 'en.4');
});

check('leaves audio alone when no English track exists', () => {
  const picked = pickPreferredAudioTrack(
    [
      track('es.2', '西班牙语原始', true),
      track('ja.6', '日语'),
    ],
    'en',
    'en-US'
  );
  assert.equal(picked, null);
});

check('does not treat a Traditional Chinese original as Simplified', () => {
  const picked = pickPreferredAudioTrack(
    [
      track('zh-TW.7', '中文（繁體）原始', true),
      track('zh-CN.8', '中文（简体）'),
    ],
    'zh-CN',
    'en-US'
  );
  assert.equal(picked?.id, 'zh-CN.8');
});

check('keeps a Japanese original', () => {
  const picked = pickPreferredAudioTrack(
    [
      track('ja.2', '日语原始', true),
      track('en-US.3', '英语 (US)'),
    ],
    'ja',
    'en-US'
  );
  assert.equal(picked?.id, 'ja.2');
});

check('detects original from the English name label', () => {
  const picked = pickPreferredAudioTrack(
    [
      track('en-GB.5', 'English (UK) original'),
      track('en-US.3', 'English (US)'),
    ],
    'en',
    'en-US'
  );
  assert.equal(picked?.id, 'en-GB.5');
});

check('uses the track name when the id is not a language tag', () => {
  const picked = pickPreferredAudioTrack(
    [
      track('251;abc', '西班牙语原始', true),
      track('251;def', '英语 (US)'),
    ],
    'en',
    'en-US'
  );
  assert.equal(picked?.id, '251;def');
});

console.log(`\n${count} audio-track selection checks passed.`);
