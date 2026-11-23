import assert from 'node:assert/strict';

import { WebdavClient } from '../src/core/sync/webdav.ts';

let count = 0;

function mockFetch(statusFor) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method });
    const status = statusFor(String(url));
    return {
      status,
      headers: { get: () => '' },
      text: async () => '',
    };
  };
  return calls;
}

const base = {
  url: 'https://dav.example/dav',
  username: 'u',
  password: 'p',
  folder: 'Kissly',
  enabled: true,
};

await (async () => {
  const calls = mockFetch(() => 201);
  await new WebdavClient(base).ensureFolder();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'MKCOL');
  assert.equal(calls[0].url, 'https://dav.example/dav/Kissly');
  count += 1;
  console.log(`  ok ${count}. a single folder creates one MKCOL`);
})();

await (async () => {
  const calls = mockFetch((url) => (url.endsWith('/Backups') ? 201 : 201));
  await new WebdavClient({ ...base, folder: 'Backups/Kissly' }).ensureFolder();
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      'https://dav.example/dav/Backups',
      'https://dav.example/dav/Backups/Kissly',
    ]
  );
  count += 1;
  console.log(`  ok ${count}. nested folders are created parent first`);
})();

await (async () => {
  const calls = mockFetch((url) =>
    url.endsWith('/Backups') ? 405 : 201
  );
  await new WebdavClient({ ...base, folder: 'Backups/Kissly' }).ensureFolder();
  assert.equal(calls.length, 2);
  count += 1;
  console.log(`  ok ${count}. an existing parent (405) still allows the child`);
})();

console.log(`webdav-folder: ${count} assertions passed`);
