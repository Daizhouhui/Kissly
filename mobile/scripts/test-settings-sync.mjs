import assert from 'node:assert/strict';

import {
  changedSettingKeys,
  mergeSettings,
  pickSyncedSettings,
  settingsFileChanged,
  stampsForAllKeys,
  SYNCED_SETTING_KEYS,
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
    listeningFontSize: 20,
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
  openrouterModel: 'openai/gpt-4o-mini',
  openaiProfiles: [
    {
      id: 'default',
      name: 'OpenAI 兼容',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    },
  ],
  openaiProfileId: 'default',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
  requestTimeoutMs: 20000,
};

const local = {
  ...BASE,
  sourceLang: 'fr',
  provider: 'auto',
  theme: 'dark',
  subtitle: { ...BASE.subtitle, fontSize: 20 },
  webdav: { ...BASE.webdav, password: 'local-secret' },
};
const remoteSettings = {
  ...BASE,
  sourceLang: 'auto',
  targetLang: 'ja',
  provider: 'deepseek',
  theme: 'light',
  deepseekModel: 'deepseek-reasoner',
  subtitle: { ...BASE.subtitle, fontSize: 31 },
  webdav: { ...BASE.webdav, password: 'remote-secret' },
};

const localStamps = { ...stampsForAllKeys(100), sourceLang: 200 };
const remoteStamps = { ...stampsForAllKeys(150), targetLang: 250 };

function merge(localSettings, localMap, localAt, remote, remoteMap, remoteAt) {
  return mergeSettings(
    localSettings,
    localMap,
    localAt,
    remote ? pickSyncedSettings(remote) : undefined,
    remoteMap,
    remoteAt
  );
}

check('only the language pair is in the synced key list', () => {
  assert.deepEqual([...SYNCED_SETTING_KEYS], [
    'sourceLang',
    'targetLang',
    'learningLang',
  ]);
});

check('the payload carries three languages and nothing else', () => {
  const payload = pickSyncedSettings(local);
  assert.deepEqual(Object.keys(payload).sort(), [
    'learningLang',
    'sourceLang',
    'targetLang',
  ]);
  assert.equal('webdav' in payload, false);
  assert.equal('theme' in payload, false);
  assert.equal('subtitle' in payload, false);
  assert.equal('provider' in payload, false);
  assert.equal('openaiProfiles' in payload, false);
});

check('newer local key survives a newer remote file', () => {
  const merged = merge(local, localStamps, 100, remoteSettings, remoteStamps, 150);
  assert.equal(merged.settings.sourceLang, 'fr');
  assert.equal(merged.settings.targetLang, 'ja');
  assert.deepEqual(merged.fromRemote.sort(), ['targetLang']);
});

check('per-key stamps choose the latest writer, not the whole file', () => {
  const merged = merge(local, localStamps, 100, remoteSettings, remoteStamps, 150);
  assert.equal(merged.stamps.sourceLang, 200);
  assert.equal(merged.stamps.targetLang, 250);
  assert.equal(merged.stamps.learningLang, 150);
  assert.equal(merged.updatedAt, 250);
});

check('both devices can change different languages without wiping one', () => {
  const merged = merge(
    { ...local, targetLang: 'ko' },
    { ...localStamps, targetLang: 300 },
    100,
    remoteSettings,
    remoteStamps,
    150
  );
  assert.equal(merged.settings.sourceLang, 'fr');
  assert.equal(merged.settings.targetLang, 'ko');
});

check('a remote provider, model or subtitle size never reaches local', () => {
  // The remote file still carries the old wide payload from earlier versions.
  const merged = merge(local, localStamps, 100, remoteSettings, remoteStamps, 150);
  assert.equal(merged.settings.provider, 'auto');
  assert.equal(merged.settings.theme, 'dark');
  assert.equal(merged.settings.deepseekModel, 'deepseek-chat');
  assert.equal(merged.settings.subtitle.fontSize, 20);
});

check('a version 1 remote file is read as one timestamp for all keys', () => {
  const merged = merge(local, localStamps, 100, remoteSettings, undefined, 150);
  assert.equal(merged.settings.sourceLang, 'fr');
  assert.equal(merged.settings.targetLang, 'ja');
  assert.equal(merged.stamps.targetLang, 150);
});

check('an old local file with no stamps keeps the newer remote values', () => {
  const merged = merge(
    { ...BASE, sourceLang: 'auto' },
    {},
    100,
    { ...BASE, sourceLang: 'es' },
    undefined,
    500
  );
  assert.equal(merged.settings.sourceLang, 'es');
});

check('missing key on a version 2 file never overwrites the local value', () => {
  const merged = merge(
    { ...local, sourceLang: 'fr' },
    { ...localStamps, sourceLang: 10 },
    100,
    { targetLang: 'ja' },
    { ...remoteStamps, targetLang: 0 },
    150
  );
  assert.equal(merged.settings.sourceLang, 'fr');
});

check('changedSettingKeys still reports edits outside the synced list', () => {
  const next = {
    ...local,
    subtitle: { ...local.subtitle, fontSize: 31 },
  };
  assert.deepEqual(changedSettingKeys(local, next), ['subtitle']);
  assert.deepEqual(changedSettingKeys(local, { ...local, theme: 'light' }), [
    'theme',
  ]);
  assert.deepEqual(changedSettingKeys(local, { ...local }), []);
});

check('settingsFileChanged detects new values and new stamps', () => {
  const merged = merge(local, localStamps, 100, remoteSettings, remoteStamps, 150);
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
      { ...payload, stamps: { ...payload.stamps, learningLang: 999 } },
      sameRemote
    ),
    true
  );
  assert.equal(settingsFileChanged(payload, undefined), true);
});

check('a partial local stamp map does not make untouched keys look new', () => {
  const merged = merge(
    { ...local, targetLang: 'zh-CN' },
    { learningLang: 3000 },
    3000,
    { ...remoteSettings, targetLang: 'ja' },
    { ...stampsForAllKeys(2000), targetLang: 2000 },
    2000
  );
  assert.equal(merged.settings.targetLang, 'ja');
  assert.equal(merged.settings.learningLang, local.learningLang);
});

check('a second 412 merge keeps languages written by the other device', () => {
  const first = merge(local, localStamps, 100, remoteSettings, remoteStamps, 150);
  const late = {
    ...BASE,
    learningLang: 'ja',
    defaultTab: 'subscriptions',
  };
  const retry = merge(
    first.settings,
    first.stamps,
    first.updatedAt,
    late,
    { ...stampsForAllKeys(0), learningLang: 400 },
    400
  );
  assert.equal(retry.settings.learningLang, 'ja');
  assert.equal(retry.settings.sourceLang, 'fr');
  assert.equal(retry.settings.targetLang, 'ja');
  assert.equal(retry.settings.defaultTab, 'video');
});

console.log(`settings-sync: ${count} assertions passed`);
