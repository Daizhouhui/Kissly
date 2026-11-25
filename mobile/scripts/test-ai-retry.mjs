import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadAi(httpText) {
  const compiled = ts.transpileModule(
    readFileSync(new URL('../src/core/translate/ai.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    require(id) {
      if (id === '../http') return { httpText };
      if (id === '../utils') {
        return {
          chunk(values, size) {
            const result = [];
            for (let index = 0; index < values.length; index += size) {
              result.push(values.slice(index, index + size));
            }
            return result;
          },
        };
      }
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  return module.exports;
}

const config = {
  id: 'TestAI',
  url: 'https://ai.example/chat',
  key: 'key',
  model: 'model',
  timeoutMs: 100,
};

await (async () => {
  let calls = 0;
  const { aiTranslate } = loadAi(async () => {
    calls += 1;
    return { status: 401, text: 'invalid key' };
  });
  await assert.rejects(
    () => aiTranslate(config, ['one', 'two'], 'en', 'zh-CN'),
    /401/
  );
  assert.equal(calls, 1, 'a permanent credential error must not retry or split batches');
  console.log('  ok permanent AI errors make one request');
})();

await (async () => {
  let calls = 0;
  const { aiTranslate } = loadAi(async () => {
    calls += 1;
    if (calls === 1) return { status: 500, text: 'temporary' };
    return {
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: '["一","二"]' } }] }),
    };
  });
  const result = await aiTranslate(config, ['one', 'two'], 'en', 'zh-CN');
  assert.equal(calls, 2, 'a temporary server error gets one retry');
  assert.deepEqual(Array.from(result), ['一', '二']);
  console.log('  ok temporary AI errors retain their bounded retry');
})();

await (async () => {
  const timeoutError = Object.assign(new Error('Aborted'), {
    name: 'AbortError',
  });
  let calls = 0;
  const { aiTranslate } = loadAi(async (_url, options) => {
    calls += 1;
    if (calls === 1) throw timeoutError;
    const texts = JSON.parse(options.body.messages[1].content);
    return {
      status: 200,
      text: JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(texts.map((text) => `译:${text}`)) } },
        ],
      }),
    };
  });
  const result = await aiTranslate(config, ['one', 'two'], 'en', 'zh-CN');
  assert.equal(calls, 3, 'a timeout must split immediately instead of replaying the same batch');
  assert.deepEqual(Array.from(result), ['译:one', '译:two']);
  console.log('  ok timeouts split immediately and preserve line order');
})();

await (async () => {
  let calls = 0;
  const { aiTranslate } = loadAi(async (_url, options) => {
    calls += 1;
    const texts = JSON.parse(options.body.messages[1].content);
    if (texts.length > 1) {
      return {
        status: 200,
        text: JSON.stringify({
          choices: [{ message: { content: JSON.stringify(['少了一条']) } }],
        }),
      };
    }
    return {
      status: 200,
      text: JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(texts.map((text) => `译:${text}`)) } },
        ],
      }),
    };
  });
  const result = await aiTranslate(config, ['one', 'two'], 'en', 'zh-CN');
  assert.equal(
    calls,
    3,
    'a count mismatch must split immediately instead of replaying the same batch'
  );
  assert.deepEqual(Array.from(result), ['译:one', '译:two']);
  console.log('  ok count mismatches split immediately without an exact replay');
})();

await (async () => {
  let calls = 0;
  const { aiTranslate } = loadAi(async () => {
    calls += 1;
    return { status: 429, text: 'rate limited' };
  });
  await assert.rejects(
    () => aiTranslate(config, ['one', 'two'], 'en', 'zh-CN'),
    /429/
  );
  assert.equal(calls, 1, '429 must not be replayed or split immediately');
  console.log('  ok 429 errors leave the batch for the provider fallback chain');
})();

console.log('ai-retry: 5 checks passed');
