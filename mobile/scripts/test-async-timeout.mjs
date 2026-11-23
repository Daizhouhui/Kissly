import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../src/core/http.ts', import.meta.url), 'utf8'),
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
  process: { env: {} },
  fetch,
  Headers,
  AbortController,
  setTimeout,
  clearTimeout,
  require(id) {
    if (id === 'react-native') return { Platform: { OS: 'android' } };
    throw new Error(`Unexpected import: ${id}`);
  },
});
const http = module.exports;

assert.equal(typeof http.withTimeout, 'function');
assert.equal(await http.withTimeout(Promise.resolve('ok'), 50), 'ok');
await assert.rejects(
  () => http.withTimeout(new Promise(() => {}), 10, '系统翻译超时'),
  /系统翻译超时/
);

console.log('async-timeout: 2 checks passed');
