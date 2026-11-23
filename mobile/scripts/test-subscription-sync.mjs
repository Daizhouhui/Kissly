import assert from 'node:assert/strict';

import {
  localSubscriptionChanged,
  mergeSubscriptions,
  subscriptionPayloadChanged,
} from '../src/core/sync/subscriptions.ts';
import { buildWebdavUrl, isWebdavConflictError, WebdavConflictError } from '../src/core/sync/webdav.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

function sub(channelId, extra = {}) {
  return {
    channelId,
    title: `Channel ${channelId}`,
    handle: `@${channelId}`,
    addedAt: 100,
    ...extra,
  };
}

check('a 412 retry keeps a channel added while the sync was in flight', () => {
  const remoteFile = { items: [sub('R1')], deleted: {}, orderUpdatedAt: 10 };
  const initialLocal = [sub('A')];
  const merged = mergeSubscriptions(
    initialLocal,
    remoteFile.items,
    {},
    remoteFile.deleted,
    5,
    remoteFile.orderUpdatedAt
  );

  // The user adds C after the first GET but before the retry GET.
  const latestLocal = [sub('C', { addedAt: 200 }), sub('A')];
  const retryRemote = {
    items: [sub('R1'), sub('B')],
    deleted: {},
    orderUpdatedAt: 20,
  };
  const retryMerged = mergeSubscriptions(
    latestLocal,
    retryRemote.items,
    {},
    retryRemote.deleted,
    6,
    retryRemote.orderUpdatedAt
  );

  assert.equal(merged.items.some((item) => item.channelId === 'A'), true);
  assert.equal(
    retryMerged.items.some((item) => item.channelId === 'C'),
    true,
    'the channel added mid-sync must survive'
  );
  assert.equal(retryMerged.items.some((item) => item.channelId === 'B'), true);
});

check('the final local merge keeps a channel removed mid-sync removed', () => {
  const finalMerged = mergeSubscriptions(
    [sub('A'), sub('C', { addedAt: 200 })],
    [sub('R1')],
    {},
    {},
    5,
    10
  );
  const latestLocal = [sub('C', { addedAt: 200 })];
  const applied = mergeSubscriptions(
    latestLocal,
    finalMerged.items,
    { A: 300 },
    finalMerged.tombstones,
    6,
    finalMerged.orderUpdatedAt
  );

  assert.equal(applied.items.some((item) => item.channelId === 'A'), false);
  assert.equal(applied.items.some((item) => item.channelId === 'C'), true);
});

check('no replacement is needed when the merged state already equals local', () => {
  const merged = mergeSubscriptions([sub('A')], [sub('B')], {}, {}, 5, 10);
  const same = mergeSubscriptions(merged.items, [], {}, {}, 10, 10);
  assert.equal(
    localSubscriptionChanged(same.items, same.tombstones, same.orderUpdatedAt, same),
    false
  );
});

check('an identical remote file does not trigger another upload', () => {
  const merged = mergeSubscriptions([sub('A')], [sub('B')], {}, {}, 5, 10);
  const remote = {
    version: 2,
    orderUpdatedAt: merged.orderUpdatedAt,
    items: merged.items,
    deleted: merged.tombstones,
  };
  assert.equal(subscriptionPayloadChanged(merged, remote), false);
});

check('WebDAV folder and file names are encoded per segment', () => {
  assert.equal(
    buildWebdavUrl('https://dav.example.com/base', 'Kissly 备份/中文#1', '设置?x.json'),
    'https://dav.example.com/base/Kissly%20%E5%A4%87%E4%BB%BD/%E4%B8%AD%E6%96%87%231/%E8%AE%BE%E7%BD%AE%3Fx.json'
  );
});

check('a trailing slash on the WebDAV base does not produce a double slash', () => {
  assert.equal(
    buildWebdavUrl('https://dav.example.com/base/', 'Kissly', 'subscriptions.json'),
    'https://dav.example.com/base/Kissly/subscriptions.json'
  );
});

check('the folder URL itself is encoded too', () => {
  assert.equal(
    buildWebdavUrl('https://dav.example.com', '我的 备份'),
    'https://dav.example.com/%E6%88%91%E7%9A%84%20%E5%A4%87%E4%BB%BD'
  );
});

check('a locally added channel stays at the top when the remote order is newer', () => {
  const local = [
    sub('C', { addedAt: 300, order: 0 }),
    sub('A', { addedAt: 100, order: 1 }),
  ];
  const remote = [
    sub('A', { addedAt: 100, order: 0 }),
    sub('B', { addedAt: 50, order: 1 }),
  ];
  const merged = mergeSubscriptions(local, remote, {}, {}, 5, 10);
  assert.deepEqual(
    merged.items.map((item) => item.channelId),
    ['C', 'A', 'B'],
    'the local addition must not be pushed to the end by a newer remote order'
  );
});

check('channels added on both devices are ordered deterministically by time', () => {
  const local = [
    sub('C', { addedAt: 300, order: 0 }),
    sub('A', { addedAt: 100, order: 1 }),
  ];
  const remote = [
    sub('A', { addedAt: 100, order: 0 }),
    sub('B', { addedAt: 200, order: 1 }),
  ];
  const merged = mergeSubscriptions(local, remote, {}, {}, 5, 10);
  assert.deepEqual(
    merged.items.map((item) => item.channelId),
    ['C', 'B', 'A']
  );
});

check('a first sync keeps the remote order instead of sorting every item by age', () => {
  const remote = [
    sub('B', { addedAt: 50, order: 0 }),
    sub('A', { addedAt: 100, order: 1 }),
  ];
  const merged = mergeSubscriptions([], remote, {}, {}, 0, 10);
  assert.deepEqual(
    merged.items.map((item) => item.channelId),
    ['B', 'A']
  );
});

check('channel statistics survive a merge from either device', () => {
  const localOnlyStats = mergeSubscriptions(
    [sub('A', { subscriberCount: '1.2M', videoCount: '340' })],
    [sub('A')],
    {},
    {},
    5,
    10
  );
  assert.equal(localOnlyStats.items[0].subscriberCount, '1.2M');
  assert.equal(localOnlyStats.items[0].videoCount, '340');

  const remoteOnlyStats = mergeSubscriptions(
    [sub('A')],
    [sub('A', { subscriberCount: '800K', videoCount: '120' })],
    {},
    {},
    5,
    10
  );
  assert.equal(remoteOnlyStats.items[0].subscriberCount, '800K');
  assert.equal(remoteOnlyStats.items[0].videoCount, '120');
});

check('channel statistics changes are detected as a payload difference', () => {
  const merged = mergeSubscriptions(
    [sub('A', { subscriberCount: '1.2M', videoCount: '340' })],
    [sub('A')],
    {},
    {},
    5,
    10
  );
  const remote = {
    version: 2,
    orderUpdatedAt: merged.orderUpdatedAt,
    items: merged.items.map((item) => ({
      ...item,
      subscriberCount: '1.3M',
    })),
    deleted: merged.tombstones,
  };
  assert.equal(subscriptionPayloadChanged(merged, remote), true);
});

check('a WebDAV 412 is detected by type, not by its message text', () => {
  assert.equal(isWebdavConflictError(new Error('upstream said 412')), false);
  const conflict = new WebdavConflictError();
  assert.equal(isWebdavConflictError(conflict), true);
  assert.equal(conflict.status, 412);
});

console.log(`subscription-sync: ${count} assertions passed`);
