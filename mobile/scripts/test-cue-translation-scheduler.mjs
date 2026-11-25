import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

import { findCueIndexAt } from '../src/core/cueIndex.ts';
import * as schedule from '../src/core/translate/schedule.ts';

const source = readFileSync(
  new URL('../src/core/translate/index.ts', import.meta.url),
  'utf8'
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

function loadTranslate({ googleTranslate, saveCached }) {
  const module = { exports: {} };
  const settings = {
    provider: 'google',
    sourceLang: 'en',
    targetLang: 'zh-CN',
    requestTimeoutMs: 20000,
    openaiProfiles: [],
  };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    console,
    setTimeout,
    clearTimeout,
    require(id) {
      if (id === '../cueIndex') return { findCueIndexAt };
      if (id === '../secrets') return { getSecret: async () => 'key' };
      if (id === '../store') return { getSettings: () => settings };
      if (id === '../storage') {
        return {
          loadCachedEntry: async () => null,
          loadJson: async (_key, fallback) => fallback,
          saveCached,
          saveJson: async () => {},
        };
      }
      if (id === '../types') return {};
      if (id === '../utils') return { hashString: (value) => String(value).length };
      if (id === './autoOrder') {
        return {
          autoCacheProviders: () => ['google'],
          buildProviderChain: () => ['google'],
        };
      }
      if (id === './ai') {
        return {
          aiTranslate: async () => [],
          deepseekConfig: () => ({}),
          openaiConfig: () => ({}),
          openrouterConfig: () => ({}),
          siliconflowConfig: () => ({}),
        };
      }
      if (id === './cacheKey') {
        return {
          cueCacheKeyForProvider: (_videoId, _track, _from, _to, _settings, provider) =>
            `cue:${provider}`,
          titleCacheKey: () => 'title',
          providerCacheScope: () => 'scope',
        };
      }
      if (id === './cacheSelection') return { pickBestCueCache: () => null };
      if (id === './credentials') return { getActiveOpenAiKey: async () => '' };
      if (id === './google') return { googleTranslate };
      if (id === './google2') return { google2Translate: googleTranslate };
      if (id === './microsoft') return { microsoftTranslate: googleTranslate };
      if (id === './schedule') return schedule;
      if (id === './system') return { systemTranslateTexts: googleTranslate };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  return module.exports.translateCueList;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeCues(count) {
  return Array.from({ length: count }, (_, index) => ({
    start: index,
    end: index + 1,
    text: `line${index}`,
  }));
}

await (async () => {
  const cues = makeCues(36);
  const starts = [];
  const saves = [];
  let active = 0;
  let maxActive = 0;
  const googleTranslate = async (texts) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    starts.push(texts[0]);
    await sleep(20);
    active -= 1;
    return texts.map((text) => `译:${text}`);
  };
  const saveCached = async (key, payload) => {
    saves.push({ key, payload });
  };
  const translateCueList = loadTranslate({ googleTranslate, saveCached });

  let anchor = 24;
  const progress = [];
  const result = await translateCueList(
    'video',
    cues,
    'en:manual',
    {
      from: 'en',
      anchorTime: 24,
      getAnchorTime: () => anchor,
      shouldStop: () => false,
    },
    (partial) => {
      progress.push(partial.filter((cue) => cue.translation).length);
    }
  );

  assert.equal(starts[0], 'line24', 'the batch under the playback anchor must start first');
  assert.equal(maxActive, 2, 'at most two translation requests may run at once');
  assert.deepEqual(
    Array.from(result.cues, (cue) => cue.text),
    cues.map((cue) => cue.text),
    'translated cues keep their original order'
  );
  assert.ok(
    result.cues.every((cue) => cue.translation),
    'every cue is eventually translated'
  );
  assert.equal(progress.at(-1), 36);
  assert.equal(
    saves.at(-1).payload.cues.filter((cue) => cue.translation).length,
    36,
    'the final cache snapshot contains every translated line'
  );
  console.log('  ok anchor batches start first and all results merge in order');

  // A seek during an in-flight request must reprioritize batches that have not
  // started yet, without restarting or duplicating the first request.
  anchor = 0;
  const dynamicStarts = [];
  const dynamicTranslate = async (texts) => {
    dynamicStarts.push(texts[0]);
    if (texts[0] === 'line0') anchor = 24;
    await sleep(20);
    return texts.map((text) => `译:${text}`);
  };
  const dynamicList = loadTranslate({
    googleTranslate: dynamicTranslate,
    saveCached: async () => {},
  });
  const dynamicResult = await dynamicList('video', cues, 'en:manual', {
    from: 'en',
    anchorTime: 0,
    getAnchorTime: () => anchor,
    shouldStop: () => false,
  });
  assert.equal(dynamicStarts[0], 'line0');
  assert.equal(dynamicStarts[1], 'line24', 'a seek re-prioritizes the second idle worker');
  assert.ok(dynamicResult.cues.every((cue) => cue.translation));
  console.log('  ok a mid-flight seek reprioritizes only unstarted batches');

  // Empty caption lines are deliberately not sent to the model: some providers
  // omit empty array entries, which looks like a line-count mismatch.
  const blankCues = makeCues(12);
  blankCues[5].text = '   ';
  const blankTexts = [];
  const blankList = loadTranslate({
    googleTranslate: async (texts) => {
      blankTexts.push(...texts);
      return texts.map((text) => `译:${text}`);
    },
    saveCached: async () => {},
  });
  const blankResult = await blankList('video', blankCues, 'en:manual', {
    from: 'en',
    anchorTime: 0,
    shouldStop: () => false,
  });
  assert.equal(blankTexts.length, 11, 'the blank cue is excluded from the request');
  assert.ok(blankTexts.every((text) => text.trim()), 'no empty string reaches the model');
  assert.equal(blankResult.cues[5].translation, '');
  assert.equal(
    blankResult.cues.filter((cue) => cue.translation).length,
    11,
    'every non-empty cue still has a translation'
  );
  console.log('  ok blank caption lines never reach the model');

  // A provider may return fewer strings than requested without throwing. The
  // scheduler must settle that batch instead of re-requesting it forever.
  let partialCalls = 0;
  const partialList = loadTranslate({
    googleTranslate: async (texts) => {
      partialCalls += 1;
      return texts.slice(0, -1).map((text) => `译:${text}`);
    },
    saveCached: async () => {},
  });
  const partialResult = await partialList('video', makeCues(12), 'en:manual', {
    from: 'en',
    anchorTime: 0,
    shouldStop: () => false,
  });
  assert.equal(partialCalls, 1, 'a short provider result must not loop forever');
  assert.equal(
    partialResult.cues.filter((cue) => cue.translation).length,
    11,
    'the lines that were returned are kept in their original positions'
  );
  console.log('  ok a short provider result settles the batch without a retry loop');
})();

console.log('cue-translation-scheduler: 4 checks passed');
