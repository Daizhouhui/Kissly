import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./ts-resolve.mjs', import.meta.url);

const {
  favoritesLocalChanged,
  favoritesPayloadChanged,
  mergeFavorites,
} = await import('../src/core/sync/favorites.ts');
const { mergeSentences, sentencesPayloadChanged } = await import(
  '../src/core/sync/sentences.ts'
);

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

function fav(videoId, savedAt, extra = {}) {
  return {
    videoId,
    title: `Video ${videoId}`,
    author: `Author ${videoId}`,
    thumbnail: `https://img/${videoId}.jpg`,
    savedAt,
    ...extra,
  };
}

function sentence(id, savedAt, extra = {}) {
  return {
    id,
    videoId: `video-${id}`,
    videoTitle: `Video ${id}`,
    videoAuthor: 'Channel',
    start: 1,
    end: 2,
    text: `Spoken ${id}`,
    translation: `译文 ${id}`,
    savedAt,
    ...extra,
  };
}

check('favorites from both devices survive the union', () => {
  const merged = mergeFavorites([fav('A', 10)], [fav('B', 20)], {}, {});
  assert.deepEqual(
    merged.items.map((item) => item.videoId),
    ['B', 'A']
  );
  assert.equal(merged.items[0].title, 'Video B');
});

check('a local field wins over an empty remote one', () => {
  const merged = mergeFavorites(
    [fav('A', 10, { thumbnail: 'local.jpg' })],
    [fav('A', 10, { thumbnail: undefined })],
    {},
    {}
  );
  assert.equal(merged.items[0].thumbnail, 'local.jpg');
  assert.equal(merged.items[0].author, 'Author A');
});

check('a delete on one device removes the item on the other', () => {
  const merged = mergeFavorites([], [fav('A', 10)], {}, { A: 50 });
  assert.equal(merged.items.length, 0);
});

check('a favorite saved after the delete marker comes back', () => {
  const merged = mergeFavorites([fav('A', 60)], [fav('A', 10)], {}, { A: 50 });
  assert.equal(merged.items.length, 1);
  assert.deepEqual(merged.tombstones, {});
});

check('tombstones from both sides keep the newer timestamp', () => {
  const merged = mergeFavorites([], [], { A: 20 }, { A: 50, B: 30 });
  assert.deepEqual(merged.tombstones, { A: 50, B: 30 });
});

check('a first sync adopts the remote list without uploading again', () => {
  const merged = mergeFavorites([], [fav('A', 10), fav('B', 20)], {}, {});
  const remote = {
    version: 2,
    updatedAt: 1,
    items: merged.items,
    deleted: merged.tombstones,
  };
  assert.equal(favoritesPayloadChanged(merged, remote), false);
  assert.equal(favoritesLocalChanged([], {}, merged), true);
});

check('a changed favorite or tombstone counts as a payload difference', () => {
  const merged = mergeFavorites([fav('A', 10)], [], {}, {});
  assert.equal(
    favoritesPayloadChanged(merged, {
      version: 2,
      updatedAt: 1,
      items: [fav('A', 11)],
      deleted: {},
    }),
    true
  );
  assert.equal(
    favoritesPayloadChanged(merged, {
      version: 2,
      updatedAt: 1,
      items: merged.items,
      deleted: { A: 5 },
    }),
    true
  );
  assert.equal(
    favoritesPayloadChanged(merged, {
      version: 1,
      updatedAt: 1,
      items: merged.items,
      deleted: {},
    }),
    true
  );
});

check('a local list that already equals the merge is not replaced', () => {
  const merged = mergeFavorites([fav('A', 10)], [], {}, {});
  assert.equal(favoritesLocalChanged([fav('A', 10)], {}, merged), false);
  assert.equal(
    favoritesLocalChanged([fav('A', 10)], { B: 3 }, merged),
    true
  );
});

check('broken remote favorite rows are dropped instead of crashing', () => {
  const merged = mergeFavorites(
    [],
    [{ videoId: '' }, { videoId: 'B', savedAt: 'nope' }, null],
    {},
    {}
  );
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].videoId, 'B');
  assert.equal(merged.items[0].savedAt, 0);
});

check('duplicate sentence ids are collapsed', () => {
  const merged = mergeSentences(
    [],
    [sentence('s1', 10), sentence('s1', 11)],
    {},
    {}
  );
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].id, 's1');
});

check('sentence favorites keep the newest 500 and drop the rest', () => {
  const local = Array.from({ length: 600 }, (_, index) =>
    sentence(`s${index}`, index)
  );
  const merged = mergeSentences(local, [], {}, {});
  assert.equal(merged.items.length, 500);
  assert.equal(merged.items[0].id, 's599');
  assert.equal(merged.items[499].id, 's100');
});

check('a deleted sentence does not come back through the union', () => {
  const merged = mergeSentences(
    [sentence('s1', 10)],
    [sentence('s1', 10)],
    { s1: 20 },
    {}
  );
  assert.equal(merged.items.length, 0);
  assert.deepEqual(merged.tombstones, { s1: 20 });
});

check('an unchanged sentence file does not trigger an upload', () => {
  const merged = mergeSentences([sentence('s1', 10)], [], {}, {});
  const remote = {
    version: 2,
    updatedAt: 1,
    items: merged.items,
    deleted: merged.tombstones,
  };
  assert.equal(sentencesPayloadChanged(merged, remote), false);
});

console.log(`collection-sync: ${count} assertions passed`);
