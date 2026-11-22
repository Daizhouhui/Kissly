import assert from 'node:assert/strict';

import {
  cueCacheKey,
  providerCacheScope,
  titleCacheKey,
} from '../src/core/translate/cacheKey.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

const base = {
  provider: 'deepseek',
  deepseekModel: 'deepseek-chat',
  siliconflowModel: 'Qwen/Qwen3.5-9B',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
};

check('the same provider and model reuse one cache scope', () => {
  assert.equal(providerCacheScope(base), providerCacheScope({ ...base }));
});

check('switching the DeepSeek model invalidates translated cues', () => {
  const before = cueCacheKey('vid', 'en', 'auto', 'zh-CN', base);
  const after = cueCacheKey('vid', 'en', 'auto', 'zh-CN', {
    ...base,
    deepseekModel: 'deepseek-reasoner',
  });
  assert.notEqual(before, after);
});

check('switching the source language invalidates translated cues', () => {
  const before = cueCacheKey('vid', 'en', 'auto', 'zh-CN', base);
  const after = cueCacheKey('vid', 'en', 'en', 'zh-CN', base);
  assert.notEqual(before, after);
});

check('switching the OpenAI endpoint invalidates the cache', () => {
  const before = providerCacheScope({
    ...base,
    provider: 'openai',
  });
  const after = providerCacheScope({
    ...base,
    provider: 'openai',
    openaiBaseUrl: 'https://example.com/v1',
  });
  assert.notEqual(before, after);
});

check('switching the OpenAI model invalidates the cache', () => {
  const before = providerCacheScope({ ...base, provider: 'openai' });
  const after = providerCacheScope({
    ...base,
    provider: 'openai',
    openaiModel: 'gpt-4.1-mini',
  });
  assert.notEqual(before, after);
});

check('a trailing slash on the endpoint is treated as the same server', () => {
  assert.equal(
    providerCacheScope({ ...base, provider: 'openai' }),
    providerCacheScope({
      ...base,
      provider: 'openai',
      openaiBaseUrl: 'https://api.openai.com/v1/',
    })
  );
});

check('non-AI providers ignore model fields they never use', () => {
  assert.equal(
    providerCacheScope({ ...base, provider: 'google' }),
    providerCacheScope({
      ...base,
      provider: 'google',
      deepseekModel: 'something-else',
    })
  );
});

check('title cache keys include the provider/model scope', () => {
  const before = titleCacheKey('abc', 'zh-CN', base);
  const after = titleCacheKey('abc', 'zh-CN', {
    ...base,
    deepseekModel: 'deepseek-reasoner',
  });
  assert.notEqual(before, after);
  assert.ok(before.endsWith('|zh-CN|abc'));
});

console.log(`translation-cache-key: ${count} assertions passed`);
