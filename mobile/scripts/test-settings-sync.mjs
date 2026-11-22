import assert from 'node:assert/strict';

import {
  changedSettingKeys,
  mergeSettings,
  pickSyncedSettings,
  settingsFileChanged,
  stampsForAllKeys,
} from '../src/core/settingsSync.ts';

let count = 0;
function check(name, fn) {
  fn();
  count += 1;
  console.log(`  ok ${count}. ${name}`);
}

// Mirrors BASE; kept local because defaults.ts imports its type
// without the `type` keyword and Node's type stripping cannot erase it.
const BASE = {
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  learningLang: 'en',
  interfaceLang: 'zh-CN',
  provider: 'auto',
  autoFallbackDeepSeek: true,
  autoFreeOrder: ['microsoft', 'google', 'google2'],
  autoPaidOrder: ['deepseek', 'siliconflow', 'openai'],
  translateTitles: true,
  titleTranslationMode: 'bilingual',
  defaultTab: 'video',
  discoverLayout: 'grid',
  theme: 'system',
  themeAccent: 'sage',
  keepAwake: true,
  speechRate: 0.9,
  speechPitch: 1,
  designVersion: 3,
  subtitle: {
    fontSize: 20,
    landscapeFontSize: 24,
    mode: 'bilingual',
    position: 'bottom',
    backgroundOpacity: 0.55,
    showOnVideo: true,
    transcript: true,
    scrollMode: 'top',
    sentenceMode: 'smart',
    originalFont: 'default',
    translationFont: 'default',
    originalWeight: 'medium',
    translationWeight: 'regular',
    autoNext: true,
    hideVideo: false,
    hideTitle: true,
    repeatCount: 2,
    repeatInterval: 1,
    originalTiming: 'always',
    listeningOriginalMode: 'after',
    listeningTranslationMode: 'together',
  },
  webdav: {
    url: 'https://app.koofr.net/dav/Koofr',
    username: '',
    password: '',
    enabled: false,
    folder: 'Kissly',
  },
  deepseekModel: 'deepseek-chat',
  siliconflowModel: 'Qwen/Qwen3.5-9B',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
  requestTimeoutMs: 20000,
};

const local = {
  ...BASE,
  sourceLang: 'fr',
  targetLang: 'zh-CN',
  provider: 'auto',
  subtitle: { ...BASE.subtitle, fontSize: 20 },
  theme: 'dark',
  webdav: { ...BASE.webdav, password: 'local-secret' },
};
const remoteSettings = {
  ...BASE,
  sourceLang: 'auto',
  targetLang: 'ja',
  provider: 'deepseek',
  theme: 'light',
  webdav: { ...BASE.webdav, password: 'remote-secret' },
};

const localStamps = { ...stampsForAllKeys(100), sourceLang: 200 };
const remoteStamps = { ...stampsForAllKeys(150), targetLang: 250 };

check('newer local key survives a newer remote file', () => {
  const merged = mergeSettings(
    local,
    localStamps,
    100,
    pickSyncedSettings(remoteSettings),
    remoteStamps,
    150
  );
  assert.equal(merged.settings.sourceLang, 'fr');
  assert.equal(merged.settings.targetLang, 'ja');
  assert.deepEqual(merged.fromRemote.sort(), ['provider', 'targetLang']);
});

check('per-key stamps choose the latest writer, not the whole file', () => {
  const merged = mergeSettings(
    local,
    localStamps,
    100,
    pickSyncedSettings(remoteSettings),
    remoteStamps,
    150
  );
  assert.equal(merged.stamps.sourceLang, 200);
  assert.equal(merged.stamps.targetLang, 250);
  assert.equal(merged.stamps.provider, 150);
  assert.equal(merged.updatedAt, 250);
});

check('both devices can change different rows without wiping one', () => {
  const merged = mergeSettings(
    { ...local, targetLang: 'ko', provider: 'auto' },
    { ...localStamps, targetLang: 300 },
    100,
    pickSyncedSettings(remoteSettings),
    remoteStamps,
    150
  );
  assert.equal(merged.settings.sourceLang, 'fr');
  assert.equal(merged.settings.targetLang, 'ko');
  assert.equal(merged.settings.provider, 'deepseek');
});

check('a version 1 remote file is read as one timestamp for all keys', () => {
  const merged = mergeSettings(
    local,
    localStamps,
    100,
    pickSyncedSettings(remoteSettings),
    undefined,
    150
  );
  assert.equal(merged.settings.sourceLang, 'fr');
  assert.equal(merged.settings.targetLang, 'ja');
  assert.equal(merged.stamps.targetLang, 150);
});

check('an old local file with no stamps keeps the newer remote values', () => {
  const merged = mergeSettings(
    { ...BASE, sourceLang: 'auto' },
    {},
    100,
    pickSyncedSettings({ ...BASE, sourceLang: 'es' }),
    undefined,
    500
  );
  assert.equal(merged.settings.sourceLang, 'es');
});

check('missing key on a version 2 file never overwrites the local value', () => {
  const merged = mergeSettings(
    { ...local, sourceLang: 'fr' },
    { ...localStamps, sourceLang: 10 },
    100,
    { targetLang: 'ja' },
    { ...remoteStamps, targetLang: 0 },
    150
  );
  assert.equal(merged.settings.sourceLang, 'fr');
});

check('webdav, theme and accent never travel in the payload', () => {
  const payload = pickSyncedSettings(local);
  assert.equal('webdav' in payload, false);
  assert.equal('theme' in payload, false);
  assert.equal('themeAccent' in payload, false);
  assert.equal(payload.subtitle.fontSize, 20);
});

check('changedSettingKeys reports a nested subtitle edit as the top key', () => {
  const next = {
    ...local,
    subtitle: { ...local.subtitle, fontSize: 31 },
  };
  assert.deepEqual(changedSettingKeys(local, next), ['subtitle']);
});

check('changedSettingKeys ignores equal values and reports theme', () => {
  assert.deepEqual(changedSettingKeys(local, { ...local }), []);
  assert.deepEqual(changedSettingKeys(local, { ...local, theme: 'light' }), [
    'theme',
  ]);
});

check('settingsFileChanged detects new values and new stamps', () => {
  const merged = mergeSettings(
    local,
    localStamps,
    100,
    pickSyncedSettings(remoteSettings),
    remoteStamps,
    150
  );
  const payload = {
    updatedAt: merged.updatedAt,
    stamps: merged.stamps,
    settings: pickSyncedSettings(merged.settings),
  };
  const sameRemote = {
    version: 2,
    updatedAt: merged.updatedAt,
    stamps: merged.stamps,
    settings: payload.settings,
  };
  assert.equal(settingsFileChanged(payload, sameRemote), false);
  assert.equal(
    settingsFileChanged(
      { ...payload, stamps: { ...payload.stamps, keepAwake: 999 } },
      sameRemote
    ),
    true
  );
  assert.equal(settingsFileChanged(payload, undefined), true);
});

check('a partial local stamp map does not make untouched keys look new', () => {
  const merged = mergeSettings(
    { ...local, targetLang: 'zh-CN' },
    { keepAwake: 3000 },
    3000,
    pickSyncedSettings({ ...remoteSettings, targetLang: 'ja' }),
    { ...stampsForAllKeys(2000), targetLang: 2000 },
    2000
  );
  assert.equal(merged.settings.targetLang, 'ja');
  assert.equal(merged.settings.keepAwake, local.keepAwake);
});

check('a second 412 merge keeps keys written by the other device', () => {
  const first = mergeSettings(
    local,
    localStamps,
    100,
    pickSyncedSettings(remoteSettings),
    remoteStamps,
    150
  );
  const late = {
    ...BASE,
    provider: 'siliconflow',
    defaultTab: 'subscriptions',
  };
  const retry = mergeSettings(
    first.settings,
    first.stamps,
    first.updatedAt,
    pickSyncedSettings(late),
    { ...stampsForAllKeys(0), provider: 400, defaultTab: 400 },
    400
  );
  assert.equal(retry.settings.provider, 'siliconflow');
  assert.equal(retry.settings.defaultTab, 'subscriptions');
  assert.equal(retry.settings.sourceLang, 'fr');
  assert.equal(retry.settings.targetLang, 'ja');
});

console.log(`settings-sync: ${count} assertions passed`);
