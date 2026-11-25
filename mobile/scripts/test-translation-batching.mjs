import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./ts-resolve.mjs', import.meta.url);

const {
  batchSizeForProvider,
  BATCH_SIZE_AI_BACKGROUND,
  BATCH_SIZE_AI_FOREGROUND,
  BATCH_SIZE_FREE_BACKGROUND,
  BATCH_SIZE_FREE_FOREGROUND,
} = await import('../src/core/translate/config.ts');
const {
  collectPendingCueIndices,
  planBackgroundTask,
  planForegroundTasks,
  shouldStartAutoFill,
  translationCoverage,
} = await import('../src/core/translate/batching.ts');

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

function makeCues(count, text = (index) => `line${index}`) {
  return Array.from({ length: count }, (_, index) => ({
    start: index,
    end: index + 1,
    text: text(index),
  }));
}

check('free engines use 6 foreground / 12 background', () => {
  for (const provider of ['google', 'google2', 'microsoft', 'system']) {
    assert.equal(batchSizeForProvider(provider, false), BATCH_SIZE_FREE_FOREGROUND);
    assert.equal(batchSizeForProvider(provider, true), BATCH_SIZE_FREE_BACKGROUND);
  }
});

check('paid AI engines use 12 foreground / 18 background', () => {
  for (const provider of ['deepseek', 'siliconflow', 'openrouter', 'openai']) {
    assert.equal(batchSizeForProvider(provider, false), BATCH_SIZE_AI_FOREGROUND);
    assert.equal(batchSizeForProvider(provider, true), BATCH_SIZE_AI_BACKGROUND);
  }
});

check('auto starts on the free sizes until a paid fallback answers', () => {
  assert.equal(batchSizeForProvider('auto', false), 6);
  assert.equal(batchSizeForProvider('auto', true), 12);
});

check('pending collection skips empty lines, translations and exclusions', () => {
  const cues = makeCues(10, (index) => (index === 4 ? '   ' : `line${index}`));
  const translations = cues.map((_, index) => (index < 3 ? `译${index}` : ''));
  const pending = collectPendingCueIndices(cues, translations, new Set([7]));
  assert.deepEqual(pending, [3, 5, 6, 8, 9]);
});

check('window ranges limit pending collection', () => {
  const cues = makeCues(30);
  const pending = collectPendingCueIndices(cues, [], new Set(), 10, 19);
  assert.deepEqual(pending, Array.from({ length: 10 }, (_, index) => index + 10));
});

check('foreground order: anchor, one batch back, forward, then earlier', () => {
  const pending = Array.from({ length: 40 }, (_, index) => index + 100);
  const tasks = planForegroundTasks(pending, 110, 6);
  assert.deepEqual(tasks[0].indices, [110, 111, 112, 113, 114, 115]);
  assert.deepEqual(tasks[1].indices, [104, 105, 106, 107, 108, 109]);
  assert.deepEqual(tasks[2].indices, [116, 117, 118, 119, 120, 121]);
  const last = tasks.at(-1).indices;
  assert.deepEqual(last, [100, 101, 102, 103], 'earlier lines come last');
});

check('anchor beyond every pending line starts from the nearest line back', () => {
  const pending = Array.from({ length: 10 }, (_, index) => index + 100);
  const tasks = planForegroundTasks(pending, 200, 6);
  assert.deepEqual(tasks[0].indices, [104, 105, 106, 107, 108, 109], 'filled to one batch');
  assert.deepEqual(tasks[1].indices, [100, 101, 102, 103]);
});

check('AI background batches stay at the provider 18-item limit', () => {
  const pending = Array.from({ length: 40 }, (_, index) => index);
  const task = planBackgroundTask(pending, BATCH_SIZE_AI_BACKGROUND);
  assert.equal(task.indices.length, 18);
  assert.equal(task.indices[0], 0, 'auto-fill starts from the first missing line');
});

check('coverage ignores empty caption lines in the denominator', () => {
  const cues = makeCues(10, (index) => (index < 2 ? '' : `line${index}`));
  const translations = cues.map((_, index) => (index < 4 ? '译' : ''));
  const result = translationCoverage(cues, translations);
  assert.equal(result.total, 8);
  assert.equal(result.translated, 2);
  assert.equal(result.coverage, 0.25);
});

check('auto-fill triggers exactly at 90% and only in a stable foreground', () => {
  const base = {
    coverage: 0.89,
    foregroundPending: false,
    foreground: true,
    ad: false,
    seeking: false,
    backgroundInFlight: 0,
  };
  assert.equal(shouldStartAutoFill(base), false, '89% must not trigger');
  assert.equal(shouldStartAutoFill({ ...base, coverage: 0.9 }), true);
  assert.equal(
    shouldStartAutoFill({ ...base, coverage: 0.9, foregroundPending: true }),
    false,
    'an unfinished window blocks auto-fill'
  );
  assert.equal(
    shouldStartAutoFill({ ...base, coverage: 0.9, foreground: false }),
    false,
    'background app must not auto-fill'
  );
  assert.equal(shouldStartAutoFill({ ...base, coverage: 0.9, ad: true }), false);
  assert.equal(shouldStartAutoFill({ ...base, coverage: 0.9, seeking: true }), false);
  assert.equal(
    shouldStartAutoFill({ ...base, coverage: 0.9, backgroundInFlight: 1 }),
    false,
    'only one background task may run'
  );
});

console.log(`translation-batching: ${count} checks passed`);
