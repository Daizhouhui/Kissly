import assert from 'node:assert/strict';

import {
  mergeChannelItems,
  mergeHomePool,
  takeChannelBatch,
  uniqueVideoItems,
} from '../src/core/feedBatches.ts';
import {
  CHANNEL_BATCH_SIZE,
  HOME_FIRST_BATCH,
  HOME_POOL_LIMIT,
} from '../src/core/youtube/constants.ts';

function video(index, channelId = 'UC-test', published = index) {
  return {
    videoId: `v${index}`,
    title: `Video ${index}`,
    channelId,
    channelTitle: 'Test channel',
    published: 1_700_000_000_000 + published,
    thumbnail: `https://i.ytimg.com/vi/v${index}/hqdefault.jpg`,
  };
}

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

check('feed constants match the loading spec', () => {
  assert.equal(CHANNEL_BATCH_SIZE, 20);
  assert.equal(HOME_POOL_LIMIT, 2000);
  assert.equal(HOME_FIRST_BATCH, 8);
});

check('home pool is capped at HOME_POOL_LIMIT and newest-first', () => {
  const incoming = Array.from({ length: HOME_POOL_LIMIT + 100 }, (_, index) =>
    video(index)
  );
  const pool = mergeHomePool([], incoming, HOME_POOL_LIMIT);
  assert.equal(pool.length, HOME_POOL_LIMIT);
  assert.equal(pool[0].videoId, `v${HOME_POOL_LIMIT + 99}`);
  assert.equal(pool.at(-1).videoId, 'v100');
});

check('home pool deduplicates by videoId across streaming batches', () => {
  const first = [video(3), video(2)];
  const second = [video(2), video(5), video(4)];
  const pool = mergeHomePool(first, second, HOME_POOL_LIMIT);
  assert.deepEqual(
    pool.map((item) => item.videoId),
    ['v5', 'v4', 'v3', 'v2']
  );
});

check('channel batches expose 20 items at a time without duplicates', () => {
  const source = Array.from({ length: 45 }, (_, index) => video(index));
  const { batch, rest } = takeChannelBatch(source, CHANNEL_BATCH_SIZE);
  assert.equal(batch.length, 20);
  assert.equal(rest.length, 25);
  const seen = new Set([...batch, ...rest].map((item) => item.videoId));
  assert.equal(seen.size, 45);

  const next = takeChannelBatch(rest, CHANNEL_BATCH_SIZE);
  assert.equal(next.batch.length, 20);
  assert.equal(next.rest.length, 5);
  assert.equal(
    new Set([...batch, ...next.batch, ...next.rest].map((item) => item.videoId)).size,
    45
  );
});

check('buffered items 21-30 appear in the second scroll, never dropped', () => {
  const firstPage = Array.from({ length: 30 }, (_, index) =>
    video(index, 'UC-test', 1000 - index)
  );
  const first = takeChannelBatch(firstPage, CHANNEL_BATCH_SIZE);
  assert.equal(first.batch.length, 20);
  assert.equal(first.rest.length, 10);
  assert.deepEqual(
    first.rest.map((item) => item.videoId),
    Array.from({ length: 10 }, (_, index) => `v${index + 20}`)
  );

  // continuation page 31-60 is older and appended behind the ten buffered
  // items, exactly like a real channel timeline.
  const secondPage = Array.from({ length: 30 }, (_, index) =>
    video(index + 30, 'UC-test', 1000 - (index + 30))
  );
  const buffer = uniqueVideoItems([...first.rest, ...secondPage]);
  const second = takeChannelBatch(buffer, CHANNEL_BATCH_SIZE);
  const ids = second.batch.map((item) => item.videoId);
  for (let index = 20; index <= 29; index += 1) {
    assert.ok(ids.includes(`v${index}`), `missing buffered v${index}`);
  }
  assert.equal(ids.length, 20);
});

check('refresh merges new channel data in front and keeps loaded items', () => {
  const loaded = Array.from({ length: 40 }, (_, index) => video(index));
  const incoming = Array.from({ length: 30 }, (_, index) => video(index + 20));
  const merged = mergeChannelItems(loaded, incoming);
  assert.equal(merged.length, 50);
  assert.equal(merged[0].videoId, 'v49');
  assert.equal(new Set(merged.map((item) => item.videoId)).size, 50);
});

console.log(`home-feed: ${count} assertions passed`);
