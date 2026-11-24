import assert from 'node:assert/strict';

import {
  findMatchingWebdavProfile,
  newWebdavProfileId,
  normalizeWebdavProfiles,
  upsertWebdavProfile,
} from '../src/core/webdavProfileModel.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('a saved profile list drops broken rows and repairs defaults', () => {
  const profiles = normalizeWebdavProfiles([
    null,
    { id: '', url: 'https://a.example.com' },
    { id: 'one', name: '', providerId: 7, url: 'https://a.example.com', username: ' A ', folder: '/Kissly/' },
    { id: 'one', name: 'duplicate', url: 'https://b.example.com' },
    { id: 'two', name: '备份', url: 'https://b.example.com', username: 'B', folder: 'Backup', updatedAt: 'not-a-number' },
  ]);
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].id, 'one');
  assert.equal(profiles[0].name, 'WebDAV');
  assert.equal(profiles[0].providerId, '');
  assert.equal(profiles[0].username, 'A');
  assert.equal(profiles[0].folder, 'Kissly');
  assert.equal(profiles[1].id, 'two');
  assert.equal(profiles[1].folder, 'Backup');
  assert.equal(profiles[1].updatedAt, 0);
});

check('profile matching ignores a trailing slash and username case', () => {
  const profiles = normalizeWebdavProfiles([
    {
      id: 'one',
      name: '坚果云',
      url: 'https://dav.jianguoyun.com/dav/',
      username: 'Me@Example.com',
      folder: 'Kissly',
    },
  ]);
  const match = findMatchingWebdavProfile(profiles, {
    url: ' https://dav.jianguoyun.com/dav ',
    username: 'me@example.com',
    folder: '/Kissly/',
  });
  assert.equal(match?.id, 'one');
  assert.equal(
    findMatchingWebdavProfile(profiles, {
      url: 'https://dav.jianguoyun.com/dav/',
      username: 'me@example.com',
      folder: 'Other',
    }),
    undefined
  );
});

check('saving the same profile updates it in place', () => {
  const profiles = normalizeWebdavProfiles([
    {
      id: 'one',
      name: '坚果云',
      url: 'https://dav.jianguoyun.com/dav/',
      username: 'a@example.com',
      folder: 'Kissly',
    },
    {
      id: 'two',
      name: 'Koofr',
      url: 'https://app.koofr.net/dav/Koofr',
      username: 'b@example.com',
      folder: 'Kissly',
    },
  ]);
  const next = upsertWebdavProfile(profiles, {
    ...profiles[0],
    username: 'new@example.com',
    updatedAt: 123,
  });
  assert.equal(next.length, 2);
  assert.equal(next[0].id, 'one');
  assert.equal(next[0].username, 'new@example.com');
  assert.equal(next[0].updatedAt, 123);
  assert.equal(next[1].id, 'two');
});

check('a new saved profile gets a stable prefix and a unique id', () => {
  const first = newWebdavProfileId();
  const second = newWebdavProfileId();
  assert.match(first, /^webdav-/);
  assert.match(second, /^webdav-/);
  assert.notEqual(first, second);
});

console.log(`webdav-profiles: ${count} assertions passed`);
