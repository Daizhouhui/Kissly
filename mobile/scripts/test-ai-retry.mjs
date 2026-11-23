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

console.log('ai-retry: 2 checks passed');
