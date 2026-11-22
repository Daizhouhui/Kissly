import assert from 'node:assert/strict';

import {
  autoCacheProviders,
  buildProviderChain,
  normalizeAutoFreeOrder,
  normalizeAutoPaidOrder,
} from '../src/core/translate/autoOrder.ts';
import { pickBestCueCache } from '../src/core/translate/cacheSelection.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

const base = {
  provider: 'auto',
  autoFallbackDeepSeek: true,
  autoFreeOrder: ['microsoft', 'google', 'google2'],
  autoPaidOrder: ['deepseek', 'siliconflow', 'openai'],
};

check('missing or malformed free order falls back to the defaults', () => {
  assert.deepEqual(normalizeAutoFreeOrder(undefined), [
    'microsoft',
    'google',
    'google2',
  ]);
  assert.deepEqual(normalizeAutoFreeOrder('google'), [
    'microsoft',
    'google',
    'google2',
  ]);
  assert.deepEqual(normalizeAutoFreeOrder(['google', 'system', 'google']), [
    'google',
    'microsoft',
    'google2',
  ]);
});

check('paid order removes duplicates and appends missing engines', () => {
  assert.deepEqual(
    normalizeAutoPaidOrder(['openai', 'openai', 'unknown', 'deepseek']),
    ['openai', 'deepseek', 'siliconflow']
  );
});

check('auto mode follows the custom free order', () => {
  assert.deepEqual(
    buildProviderChain({
      ...base,
      autoFreeOrder: ['google2', 'google', 'microsoft'],
      autoFallbackDeepSeek: false,
    }),
    ['google2', 'google', 'microsoft']
  );
});

check('paid engines are appended in the custom order', () => {
  assert.deepEqual(
    buildProviderChain({
      ...base,
      autoFreeOrder: ['google', 'microsoft', 'google2'],
      autoPaidOrder: ['openai', 'deepseek', 'siliconflow'],
    }),
    [
      'google',
      'microsoft',
      'google2',
      'openai',
      'deepseek',
      'siliconflow',
    ]
  );
});

check('turning fallback off keeps auto on free engines only', () => {
  assert.deepEqual(buildProviderChain({ ...base, autoFallbackDeepSeek: false }), [
    'microsoft',
    'google',
    'google2',
  ]);
});

check('a manual free engine keeps the paid safety net', () => {
  assert.deepEqual(
    buildProviderChain({
      ...base,
      provider: 'google',
      autoPaidOrder: ['openai', 'deepseek', 'siliconflow'],
    }),
    ['google', 'openai', 'deepseek', 'siliconflow']
  );
});

check('a manual paid engine never silently switches providers', () => {
  assert.deepEqual(buildProviderChain({ ...base, provider: 'openai' }), [
    'openai',
  ]);
  assert.deepEqual(buildProviderChain({ ...base, provider: 'deepseek' }), [
    'deepseek',
  ]);
});

check('auto cache lookup covers every provider, not just the current chain', () => {
  assert.deepEqual(autoCacheProviders(), [
    'auto',
    'system',
    'microsoft',
    'google',
    'google2',
    'deepseek',
    'siliconflow',
    'openai',
  ]);
});

const cues = [
  { start: 0, end: 1, text: 'one' },
  { start: 1, end: 2, text: 'two' },
  { start: 2, end: 3, text: 'three' },
];

function entry(at, provider, translations) {
  return {
    at,
    value: {
      provider,
      cues: cues.map((cue, index) => ({
        ...cue,
        translation: translations[index] ?? '',
      })),
    },
  };
}

check('a complete cache wins without another provider request', () => {
  const picked = pickBestCueCache(cues, [
    entry(10, 'microsoft', ['一', '二']),
    entry(20, 'deepseek', ['一', '二', '三']),
  ]);
  assert.equal(picked.provider, 'deepseek');
  assert.deepEqual(picked.translations, ['一', '二', '三']);
});

check('the cache with the most translated lines wins', () => {
  const picked = pickBestCueCache(cues, [
    entry(30, 'microsoft', ['一']),
    entry(20, 'google', ['一', '二']),
  ]);
  assert.equal(picked.provider, 'google');
  assert.deepEqual(picked.translations, ['一', '二', '']);
});

check('a newer cache wins when coverage is equal', () => {
  const picked = pickBestCueCache(cues, [
    entry(10, 'microsoft', ['一', '二']),
    entry(20, 'google', ['一', '二']),
  ]);
  assert.equal(picked.provider, 'google');
});

check('a cache for a different cue list is ignored', () => {
  const other = {
    at: 99,
    value: {
      provider: 'deepseek',
      cues: cues.map((cue) => ({ ...cue, text: `${cue.text} changed`, translation: 'x' })),
    },
  };
  assert.equal(pickBestCueCache(cues, [other]), null);
  assert.equal(pickBestCueCache(cues, [entry(10, 'google', ['', '', ''])]), null);
});

console.log(`auto-translation-order: ${count} assertions passed`);
