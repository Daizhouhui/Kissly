import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(scriptDir, '../src/core/translate/ai.ts'),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

let lastBody = null;

const httpStub = {
  httpText: async (_url, options) => {
    lastBody =
      typeof options.body === 'string'
        ? JSON.parse(options.body)
        : options.body;
    return {
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: '["你好"]' } }] }),
      headers: new Map(),
    };
  },
};

const utilsStub = {
  chunk: (items, size) =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
      items.slice(index * size, index * size + size)
    ),
};

const module = { exports: {} };
vm.runInNewContext(compiled, {
  module,
  exports: module.exports,
  console,
  require: (id) => {
    if (id === '../http') return httpStub;
    if (id === '../utils') return utilsStub;
    throw new Error(`Unexpected import: ${id}`);
  },
});

const { aiTranslate, aiAnalyzeSentence, deepseekConfig } = module.exports;

function build(thinking) {
  return deepseekConfig('test-key', 'deepseek-flash', 20000, thinking);
}

async function assertTranslationBody(thinking, expected) {
  await aiTranslate(build(thinking), ['hello'], 'en', 'zh-CN');
  assert.ok(lastBody, 'request body must be captured');
  if (expected === undefined) {
    assert.equal(lastBody.thinking, undefined);
  } else {
    assert.equal(lastBody.thinking?.type, expected);
  }
  assert.equal(lastBody.model, 'deepseek-flash');
  assert.equal(lastBody.stream, false);
}

await assertTranslationBody(false, 'disabled');
await assertTranslationBody(true, 'enabled');

// A config without the toggle must not invent one (other engines rely on this).
await aiTranslate(
  { id: 'Custom', url: 'https://example.test/v1/chat/completions', key: 'k', model: 'm', timeoutMs: 20000 },
  ['hello'],
  'en',
  'zh-CN'
);
assert.equal(lastBody.thinking, undefined, 'custom configs stay untouched');

await aiAnalyzeSentence(build(false), 'hello', '你好');
assert.equal(lastBody.thinking?.type, 'disabled', 'analysis shares the toggle');

await aiAnalyzeSentence(build(true), 'hello', '你好');
assert.equal(lastBody.thinking?.type, 'enabled');

console.log('deepseek-thinking: 6 assertions passed');
