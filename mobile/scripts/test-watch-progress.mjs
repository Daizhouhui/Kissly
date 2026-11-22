import assert from 'node:assert/strict';

import {
  mergeHistoryEntry,
  parseStartAt,
  remainingSeconds,
  resumeAtOf,
  resumeTarget,
  watchedFraction,
} from '../src/core/watchProgress.ts';

const base = {
  videoId: 'v1',
  title: 'Old title',
  author: 'Old author',
  savedAt: 1_000,
  lastWatchedAt: 1_000,
  progress: 0.5,
  resumeAt: 600,
  duration: 1_200,
};

// D1: a peek that reports 0 must not wipe the previous progress.
const peek = mergeHistoryEntry(base, { videoId: 'v1', progress: 0, resumeAt: 0 }, 2_000);
assert.equal(peek.progress, 0.5, 'progress must not go backwards');
assert.equal(peek.resumeAt, 600, 'a 0s sample must not erase the resume point');
assert.equal(peek.savedAt, 1_000, 'savedAt is immutable');
assert.equal(peek.lastWatchedAt, 2_000, 'lastWatchedAt moves on accepted write');

// D2: a rewind of the *resume point* is allowed, but the furthest progress stays.
const rewind = mergeHistoryEntry(base, { videoId: 'v1', progress: 0.1, resumeAt: 120 }, 3_000);
assert.equal(rewind.progress, 0.5, 'furthest progress stays');
assert.equal(rewind.resumeAt, 120, 'resume point follows the user');

// Watching further raises both values.
const forward = mergeHistoryEntry(base, { videoId: 'v1', progress: 0.8, resumeAt: 960 }, 4_000);
assert.equal(forward.progress, 0.8);
assert.equal(forward.resumeAt, 960);

// Duration missing on an old entry: remaining is unknown, not "1 minute".
assert.equal(remainingSeconds({ progress: 0.5, duration: undefined }), null);
assert.equal(watchedFraction({ progress: 0.5, duration: undefined }), 0.5);

// Card geometry uses the resume point, not the furthest point.
assert.equal(watchedFraction({ progress: 0.9, resumeAt: 120, duration: 1_200 }), 0.1);
assert.equal(remainingSeconds({ progress: 0.9, resumeAt: 120, duration: 1_200 }), 1_080);

// Resume target: never land in the last three seconds.
assert.equal(resumeTarget({ progress: 0.99, resumeAt: 1_198, duration: 1_200 }), 0);
assert.equal(resumeTarget({ progress: 0.5, resumeAt: 600, duration: 1_200 }), 600);

// Missing duration falls back to the stored fraction for geometry.
assert.equal(resumeAtOf({ progress: 0.5, duration: undefined }), 0);

// Route params are strings; only a usable second value survives.
assert.equal(parseStartAt('120'), 120);
assert.equal(parseStartAt('0'), 0);
assert.equal(parseStartAt('abc'), 0);
assert.equal(parseStartAt('-5'), 0);

console.log('watch-progress: 16 assertions passed');
