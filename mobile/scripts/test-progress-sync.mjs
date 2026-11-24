import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./ts-resolve.mjs', import.meta.url);

const {
  applyProgressToHistory,
  mergeProgress,
  progressFromHistory,
  progressLocalChanged,
  progressPayloadChanged,
} = await import('../src/core/sync/progress.ts');

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

const DAY = 24 * 60 * 60 * 1000;

function entry(videoId, lastWatchedAt, extra = {}) {
  return {
    videoId,
    title: `Video ${videoId}`,
    author: 'Channel',
    savedAt: lastWatchedAt,
    lastWatchedAt,
    progress: 0.5,
    resumeAt: 10,
    duration: 100,
    ...extra,
  };
}

function progress(videoId, lastWatchedAt, extra = {}) {
  return {
    videoId,
    title: `Remote ${videoId}`,
    author: 'Remote Channel',
    progress: 0.5,
    resumeAt: 10,
    duration: 100,
    lastWatchedAt,
    ...extra,
  };
}

check('the newer watch wins the resume point', () => {
  const merged = mergeProgress(
    [progress('v1', 100, { resumeAt: 30, progress: 0.3 })],
    [progress('v2', 200, { resumeAt: 60, progress: 0.8 })],
    {},
    {}
  );
  assert.equal(merged.items[0].videoId, 'v2');
  assert.equal(merged.items[0].resumeAt, 60);
});

check('progress stays monotonic while resumeAt follows the newer entry', () => {
  const merged = mergeProgress(
    [progress('v1', 100, { resumeAt: 90, progress: 0.9, title: 'Local' })],
    [progress('v1', 200, { resumeAt: 5, progress: 0.9, title: 'Remote' })],
    {},
    {}
  );
  assert.equal(merged.items[0].progress, 0.9);
  assert.equal(merged.items[0].resumeAt, 5);
  assert.equal(merged.items[0].title, 'Remote');
});

check('a local entry newer than the remote file is kept', () => {
  const merged = mergeProgress(
    [progress('v1', 300, { resumeAt: 70 })],
    [progress('v1', 200, { resumeAt: 10 })],
    {},
    {}
  );
  assert.equal(merged.items[0].lastWatchedAt, 300);
  assert.equal(merged.items[0].resumeAt, 70);
});

check('a deleted history entry does not come back', () => {
  const merged = mergeProgress(
    [],
    [progress('v1', 10)],
    {},
    { v1: 50 }
  );
  assert.equal(merged.items.length, 0);
});

check('watching again after a clear remove the tombstone', () => {
  const merged = mergeProgress(
    [progress('v1', 60)],
    [],
    {},
    { v1: 50 }
  );
  assert.equal(merged.items.length, 1);
  assert.deepEqual(merged.tombstones, {});
});

check('apply keeps the local title and only takes the position', () => {
  const history = [entry('v1', 100, { title: 'Local title', resumeAt: 30, progress: 0.3 })];
  const merged = mergeProgress(
    [],
    [
      progress('v1', 200, {
        title: 'Remote title',
        author: 'Remote author',
        resumeAt: 60,
        progress: 0.8,
      }),
    ]
  );
  const next = applyProgressToHistory(history, merged);
  assert.equal(next.length, 1);
  assert.equal(next[0].title, 'Local title');
  assert.equal(next[0].resumeAt, 60);
  assert.equal(next[0].progress, 0.8);
});

check('a video seen only on the other device is recreated with its card fields', () => {
  const merged = mergeProgress([], [progress('v2', 200, { title: 'Remote' })]);
  const next = applyProgressToHistory([], merged);
  assert.equal(next.length, 1);
  assert.equal(next[0].videoId, 'v2');
  assert.equal(next[0].title, 'Remote');
  assert.equal(next[0].savedAt, 200);
});

check('a remote resume point without a title cannot render and is skipped', () => {
  const merged = mergeProgress([], [
    { videoId: 'v3', progress: 0.4, lastWatchedAt: 200 },
  ]);
  const next = applyProgressToHistory([], merged);
  assert.equal(next.length, 0);
});

check('apply drops a local entry removed on the other device', () => {
  const history = [entry('v1', 100), entry('v2', 200)];
  const merged = mergeProgress([], [], {}, { v1: 150 });
  const next = applyProgressToHistory(history, merged);
  assert.deepEqual(
    next.map((item) => item.videoId),
    ['v2']
  );
});

check('apply keeps the newest 120 entries', () => {
  const history = Array.from({ length: 130 }, (_, index) =>
    entry(`v${index}`, index)
  );
  const next = applyProgressToHistory(history, mergeProgress([], [], {}, {}));
  assert.equal(next.length, 120);
  assert.equal(next[0].videoId, 'v129');
});

check('only the newest 60 recent entries leave the device', () => {
  const now = 10_000 * DAY;
  const history = Array.from({ length: 80 }, (_, index) =>
    entry(`v${index}`, now - index * 60 * 60 * 1000)
  );
  const items = progressFromHistory(history, now);
  assert.equal(items.length, 60);
  assert.equal(items[0].videoId, 'v0');
});

check('records older than 30 days are not uploaded', () => {
  const now = 100 * DAY;
  const history = [
    entry('fresh', now - 5 * DAY),
    entry('stale', now - 40 * DAY),
  ];
  const items = progressFromHistory(history, now);
  assert.deepEqual(
    items.map((item) => item.videoId),
    ['fresh']
  );
  assert.equal(items[0].title, 'Video fresh');
});

check('an unchanged progress file does not trigger an upload', () => {
  const merged = mergeProgress([], [progress('v1', 100)], {}, {});
  const remote = {
    version: 1,
    updatedAt: 1,
    items: merged.items,
    deleted: merged.tombstones,
  };
  assert.equal(progressPayloadChanged(merged, remote), false);
});

check('a moved resume point or a new tombstone counts as a difference', () => {
  const merged = mergeProgress([], [progress('v1', 100)], {}, {});
  assert.equal(
    progressPayloadChanged(merged, {
      version: 1,
      updatedAt: 1,
      items: [progress('v1', 100, { resumeAt: 11 })],
      deleted: {},
    }),
    true
  );
  assert.equal(
    progressPayloadChanged(merged, {
      version: 1,
      updatedAt: 1,
      items: merged.items,
      deleted: { v1: 9 },
    }),
    true
  );
});

check('local history that already matches the merge is not replaced', () => {
  const now = Date.now();
  const merged = mergeProgress([], [progress('v1', now)], {}, {});
  const history = [entry('v1', now, { progress: 0.5, resumeAt: 10 })];
  assert.equal(progressLocalChanged(history, {}, merged), false);
  assert.equal(progressLocalChanged([], {}, merged), true);
});

console.log(`progress-sync: ${count} assertions passed`);
