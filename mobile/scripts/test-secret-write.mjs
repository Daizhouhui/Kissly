import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadSecrets(secureStore) {
  const compiled = ts.transpileModule(
    readFileSync(new URL('../src/core/secrets.ts', import.meta.url), 'utf8'),
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
    require(id) {
      if (id === 'expo-secure-store') return secureStore;
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  return module.exports;
}

await (async () => {
  const secrets = loadSecrets({
    getItemAsync: async () => 'saved',
    setItemAsync: async () => {
      throw new Error('keychain locked');
    },
    deleteItemAsync: async () => {},
  });
  await assert.rejects(
    () => secrets.setSecret('deepseek', 'new-key'),
    /keychain locked/
  );
  console.log('  ok write failures reach the settings caller');
})();

await (async () => {
  const secrets = loadSecrets({
    getItemAsync: async () => {
      throw new Error('keychain unavailable');
    },
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  });
  assert.equal(await secrets.getSecret('deepseek'), '');
  console.log('  ok unreadable credentials degrade to empty');
})();

console.log('secret-write: 2 checks passed');
