import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const scriptDir = dirname(fileURLToPath(import.meta.url));

const cache = new Map();
function loadTs(file) {
  const absolute = resolve(file);
  if (cache.has(absolute)) return cache.get(absolute);
  const compiled = ts.transpileModule(readFileSync(absolute, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  cache.set(absolute, module.exports);
  const requireModule = (id) => {
    if (id.startsWith('.')) return loadTs(resolve(dirname(absolute), `${id}.ts`));
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    console,
    require: requireModule,
  });
  cache.set(absolute, module.exports);
  return module.exports;
}

const { DEFAULT_SETTINGS } = loadTs(resolve(scriptDir, '../src/core/defaults.ts'));
const { normalizeSettings } = loadTs(
  resolve(scriptDir, '../src/core/settingsNormalize.ts')
);

const dirty = {
  ...DEFAULT_SETTINGS,
  sourceLang: 'not-a-language',
  targetLang: null,
  learningLang: 'xx',
  provider: 'broken-engine',
  titleTranslationMode: 'broken',
  defaultTab: 'broken',
  discoverLayout: 'broken',
  theme: 'broken',
  themeAccent: 'broken',
  speechRate: Number.NaN,
  speechPitch: 99,
  speechAccent: 'broken',
  requestTimeoutMs: -1,
  deepseekModel: '',
  deepseekThinking: 'yes',
  subtitle: {
    ...DEFAULT_SETTINGS.subtitle,
    fontSize: 999,
    landscapeFontSize: 1,
    mode: 'broken',
    position: 'broken',
    backgroundOpacity: 2,
    scrollMode: 'broken',
    sentenceMode: 'broken',
    originalFont: 'broken',
    translationFont: 'broken',
    originalWeight: 'broken',
    translationWeight: 'broken',
    originalTiming: 'broken',
    listeningOriginalMode: 'broken',
    listeningTranslationMode: 'broken',
    repeatCount: 0,
    repeatInterval: 99,
  },
};

const fixed = normalizeSettings(dirty);

assert.equal(fixed.sourceLang, DEFAULT_SETTINGS.sourceLang);
assert.equal(fixed.targetLang, DEFAULT_SETTINGS.targetLang);
assert.equal(fixed.learningLang, DEFAULT_SETTINGS.learningLang);
assert.equal(fixed.provider, DEFAULT_SETTINGS.provider);
assert.equal(fixed.titleTranslationMode, DEFAULT_SETTINGS.titleTranslationMode);
assert.equal(fixed.defaultTab, DEFAULT_SETTINGS.defaultTab);
assert.equal(fixed.discoverLayout, DEFAULT_SETTINGS.discoverLayout);
assert.equal(fixed.theme, DEFAULT_SETTINGS.theme);
assert.equal(fixed.themeAccent, DEFAULT_SETTINGS.themeAccent);
assert.equal(fixed.speechRate, DEFAULT_SETTINGS.speechRate);
assert.equal(fixed.speechPitch, 2);
assert.equal(fixed.speechAccent, DEFAULT_SETTINGS.speechAccent);
assert.equal(fixed.requestTimeoutMs, 5000);
assert.equal(fixed.deepseekModel, DEFAULT_SETTINGS.deepseekModel);
assert.equal(fixed.deepseekThinking, false);

assert.equal(fixed.subtitle.fontSize, 40);
assert.equal(fixed.subtitle.landscapeFontSize, 12);
assert.equal(fixed.subtitle.mode, DEFAULT_SETTINGS.subtitle.mode);
assert.equal(fixed.subtitle.position, DEFAULT_SETTINGS.subtitle.position);
assert.equal(fixed.subtitle.backgroundOpacity, 1);
assert.equal(fixed.subtitle.scrollMode, DEFAULT_SETTINGS.subtitle.scrollMode);
assert.equal(fixed.subtitle.sentenceMode, DEFAULT_SETTINGS.subtitle.sentenceMode);
assert.equal(fixed.subtitle.originalFont, DEFAULT_SETTINGS.subtitle.originalFont);
assert.equal(fixed.subtitle.translationFont, DEFAULT_SETTINGS.subtitle.translationFont);
assert.equal(fixed.subtitle.originalWeight, DEFAULT_SETTINGS.subtitle.originalWeight);
assert.equal(fixed.subtitle.translationWeight, DEFAULT_SETTINGS.subtitle.translationWeight);
assert.equal(fixed.subtitle.originalTiming, DEFAULT_SETTINGS.subtitle.originalTiming);
assert.equal(
  fixed.subtitle.listeningOriginalMode,
  DEFAULT_SETTINGS.subtitle.listeningOriginalMode
);
assert.equal(
  fixed.subtitle.listeningTranslationMode,
  DEFAULT_SETTINGS.subtitle.listeningTranslationMode
);
assert.equal(fixed.subtitle.repeatCount, 1);
assert.equal(fixed.subtitle.repeatInterval, 10);

console.log('settings-normalize: 31 assertions passed');
