import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

register('./ts-resolve.mjs', import.meta.url);

const { findCueIndexAt } = await import('../src/core/cueIndex.ts');
const batching = await import('../src/core/translate/batching.ts');
const config = await import('../src/core/translate/config.ts');
const windowModule = await import('../src/core/translate/window.ts');

const sessionSource = readFileSync(
  new URL('../src/core/translate/session.ts', import.meta.url),
  'utf8'
);
const compiledSession = ts.transpileModule(sessionSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

function loadSessionFactory({
  settings,
  translateTexts,
  loadCachedEntry = async () => null,
  saveCached = async () => {},
  pickBestCueCache = () => null,
}) {
  const module = { exports: {} };
  vm.runInNewContext(compiledSession, {
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    require(id) {
      switch (id) {
        case '../cueIndex':
          return { findCueIndexAt };
        case '../store':
          return { getSettings: () => settings };
        case '../types':
          return {};
        case '../storage':
          return { loadCachedEntry, saveCached };
        case './autoOrder':
          return { autoCacheProviders: () => ['auto', 'system', 'microsoft', 'google2'] };
        case './batching':
          return batching;
        case './cacheKey':
          return { cueCacheKeyForProvider: () => 'cue-cache-key' };
        case './cacheSelection':
          return { pickBestCueCache };
        case './config':
          return config;
        case './index':
          return { translateTexts };
        case './window':
          return windowModule;
        default:
          throw new Error(`Unexpected import: ${id}`);
      }
    },
  });
  return module.exports.createSubtitleSession;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeout = 4000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeout) throw new Error('waitFor timeout');
    await sleep(20);
  }
}

function makeCues(count) {
  return Array.from({ length: count }, (_, index) => ({
    start: index,
    end: index + 1,
    text: `line${index}`,
  }));
}

function settingsFor(provider) {
  return {
    provider,
    sourceLang: 'en',
    targetLang: 'zh-CN',
    requestTimeoutMs: 20000,
    openaiProfiles: [],
  };
}

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

await (async () => {
  const cues = makeCues(3000);
  const calls = [];
  const createSession = loadSessionFactory({
    settings: settingsFor('microsoft'),
    translateTexts: async (texts) => {
      calls.push(texts);
      return { texts: texts.map((text) => `译:${text}`), provider: 'microsoft' };
    },
  });

  const session = createSession({
    videoId: 'video',
    cues,
    trackKey: 'en:manual',
    from: 'en',
    initialAnchorTime: 1000,
    durationSeconds: 3000,
  });
  session.start();
  await waitFor(() => calls.length > 0 && session.getProgress().pending === false);

  assert.ok(
    calls[0].includes('line1000'),
    'the first batch must contain the cue under the playback anchor'
  );
  const requested = new Set(calls.flat());
  assert.ok(
    requested.size <= 40,
    `a 3000-line video must only request its window (got ${requested.size})`
  );
  assert.ok(
    session.getProgress().translated <= 40,
    'only the current window is translated on open'
  );
  assert.equal(session.getProgress().total, 3000);
  await session.stop();
  count += 1;
  console.log(`  ok ${count}. a long video translates only the current window`);
})();

await (async () => {
  const cues = makeCues(200);
  let saveCount = 0;
  const progress = [];
  const createSession = loadSessionFactory({
    settings: settingsFor('microsoft'),
    translateTexts: async (texts) =>
      ({ texts: texts.map((text) => `译:${text}`), provider: 'microsoft' }),
    saveCached: async () => {
      saveCount += 1;
    },
    pickBestCueCache: () => ({
      at: Date.now(),
      provider: 'microsoft',
      translations: cues.map((_, index) => (index < 178 ? '已有译文' : '')),
    }),
  });

  const session = createSession({
    videoId: 'video',
    cues,
    trackKey: 'en:manual',
    initialAnchorTime: 0,
    durationSeconds: 200,
    onProgress: (value) => progress.push(value),
  });
  session.start();
  await sleep(400);
  assert.equal(session.getProgress().translated, 178, 'cached lines are shown first');
  assert.equal(session.getProgress().phase, 'idle', '89% coverage must not auto-fill');
  assert.equal(saveCount, 0, 'no provider request and no cache write on a pure cache hit');
  await session.stop();
  count += 1;
  console.log(`  ok ${count}. 89% coverage stays lazy`);
})();

await (async () => {
  const cues = makeCues(200);
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const createSession = loadSessionFactory({
    settings: settingsFor('microsoft'),
    translateTexts: async (texts) => {
      calls.push(texts);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(10);
      active -= 1;
      return { texts: texts.map((text) => `译:${text}`), provider: 'microsoft' };
    },
    pickBestCueCache: () => ({
      at: Date.now(),
      provider: 'microsoft',
      translations: cues.map((_, index) => (index < 180 ? '已有译文' : '')),
    }),
  });

  const session = createSession({
    videoId: 'video',
    cues,
    trackKey: 'en:manual',
    initialAnchorTime: 0,
    durationSeconds: 200,
  });
  session.start();
  await waitFor(() => session.getProgress().phase === 'done');

  assert.ok(calls.length >= 2, 'remaining lines are filled in the background');
  assert.equal(calls[0][0], 'line180', 'auto-fill starts from the first missing line');
  assert.equal(calls[0].length, 12, 'free engines fill 12 lines per background task');
  assert.equal(maxActive, 1, 'only one background task may run');
  assert.equal(session.getProgress().translated, 200);
  assert.equal(session.getProgress().total, 200);
  await session.stop();
  count += 1;
  console.log(`  ok ${count}. 90% coverage fills the rest with one background task`);
})();

await (async () => {
  const cues = makeCues(200);
  const calls = [];
  const createSession = loadSessionFactory({
    settings: settingsFor('microsoft'),
    translateTexts: async (texts) => {
      calls.push(texts);
      return { texts: texts.map((text) => `译:${text}`), provider: 'microsoft' };
    },
    pickBestCueCache: () => ({
      at: Date.now(),
      provider: 'microsoft',
      translations: cues.map((_, index) => (index < 180 ? '已有译文' : '')),
    }),
  });
  const session = createSession({
    videoId: 'video',
    cues,
    trackKey: 'en:manual',
    initialAnchorTime: 0,
    durationSeconds: 200,
  });
  session.setPlaybackState({
    playing: true,
    foreground: false,
    ad: false,
    seeking: false,
  });
  session.start();
  await sleep(300);
  assert.equal(calls.length, 0, 'a backgrounded app must not auto-fill');
  await session.stop();
  count += 1;
  console.log(`  ok ${count}. auto-fill waits for the app to be in the foreground`);
})();

check('coverage excludes empty caption lines', () => {
  const cues = makeCues(10).map((cue, index) =>
    index < 3 ? { ...cue, text: '' } : cue
  );
  const translations = cues.map((_, index) => (index < 5 ? '译' : ''));
  const result = batching.translationCoverage(cues, translations);
  assert.equal(result.total, 7);
  assert.equal(result.translated, 2);
  assert.equal(result.coverage, 2 / 7);
});

check('auto-fill trigger honours the 90% threshold and foreground state', () => {
  const base = {
    coverage: 0.9,
    foregroundPending: false,
    foreground: true,
    ad: false,
    seeking: false,
    backgroundInFlight: 0,
  };
  assert.equal(batching.shouldStartAutoFill({ ...base, coverage: 0.89 }), false);
  assert.equal(batching.shouldStartAutoFill(base), true);
  assert.equal(batching.shouldStartAutoFill({ ...base, seeking: true }), false);
});

await (async () => {
  // 0.5s-per-line auto captions: the 40-cue cap ends around 20s even though the
  // nominal look-ahead is 120s. Playback must still pick up the current line.
  const cues = Array.from({ length: 3000 }, (_, index) => ({
    start: index * 0.5,
    end: (index + 1) * 0.5,
    text: `line${index}`,
  }));
  const calls = [];
  const createSession = loadSessionFactory({
    settings: settingsFor('microsoft'),
    translateTexts: async (texts) => {
      calls.push(texts);
      return { texts: texts.map((text) => `译:${text}`), provider: 'microsoft' };
    },
  });
  const session = createSession({
    videoId: 'video',
    cues,
    trackKey: 'en:auto',
    from: 'en',
    initialAnchorTime: 0,
    durationSeconds: 1500,
  });
  session.start();
  await waitFor(() => calls.length > 0 && session.getProgress().pending === false);
  assert.ok(session.getProgress().translated <= 40, 'the first window respects the cap');

  session.setAnchor(60);
  await waitFor(() => calls.some((texts) => texts.includes('line120')), 4000);
  assert.ok(
    calls.some((texts) => texts.includes('line120')),
    'dense captions rebuild the window once playback leaves the index range'
  );
  await session.stop();
  count += 1;
  console.log(`  ok ${count}. dense captions keep following the playback position`);
})();

console.log(`auto-complete: ${count} checks passed`);
