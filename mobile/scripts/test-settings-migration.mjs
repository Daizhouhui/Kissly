import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../src/core/defaults.ts';
import { DESIGN_VERSION, migrateSettingsForDesign } from '../src/core/settingsMigration.ts';

function settings(patch = {}) {
  return { ...structuredClone(DEFAULT_SETTINGS), ...patch };
}

// 1. 旧版本停在网格：升级后被一次性拉回列表，并写入新的设计版本
const oldGrid = migrateSettingsForDesign(3, settings({ discoverLayout: 'grid' }));
assert.equal(oldGrid.discoverLayout, 'list');
assert.equal(oldGrid.designVersion, DESIGN_VERSION);
assert.equal(DESIGN_VERSION, 10);

// 2. 旧版本已经停在列表：保持列表
assert.equal(
  migrateSettingsForDesign(3, settings({ discoverLayout: 'list' })).discoverLayout,
  'list'
);

// 3. 新版本用户手动选网格：升级后保留用户选择，不再强制改回
const manualGrid = migrateSettingsForDesign(4, settings({ discoverLayout: 'grid' }));
assert.equal(manualGrid.discoverLayout, 'grid');

// 4. 全新安装：默认列表，不会被迁移改成网格
const fresh = migrateSettingsForDesign(0, settings());
assert.equal(fresh.discoverLayout, 'list');
assert.equal(fresh.subtitle.originalWeight, 'bold');
assert.equal(fresh.subtitle.translationWeight, 'normal');

// 5. 全新安装：标题翻译默认显示原文
const freshTitle = migrateSettingsForDesign(0, settings());
assert.equal(freshTitle.translateTitles, true);
assert.equal(freshTitle.titleTranslationMode, 'none');

// 6. 旧版本默认双语：升级后一次性切到不翻译
const oldTitleDefaults = migrateSettingsForDesign(
  7,
  settings({ translateTitles: true, titleTranslationMode: 'bilingual' })
);
assert.equal(oldTitleDefaults.translateTitles, true);
assert.equal(oldTitleDefaults.titleTranslationMode, 'none');

// 7. 旧版本手动选择仅译文：升级后保留
const explicitTitleMode = migrateSettingsForDesign(
  7,
  settings({ translateTitles: true, titleTranslationMode: 'translation' })
);
assert.equal(explicitTitleMode.translateTitles, true);
assert.equal(explicitTitleMode.titleTranslationMode, 'translation');

// 8. 手动关闭标题翻译：升级后保持关闭
const titleMasterOff = migrateSettingsForDesign(
  7,
  settings({ translateTitles: false, titleTranslationMode: 'bilingual' })
);
assert.equal(titleMasterOff.translateTitles, false);
assert.equal(titleMasterOff.titleTranslationMode, 'none');

// 9. 历史主题色迁移仍然只做一次
assert.equal(migrateSettingsForDesign(2, settings({ themeAccent: 'violet' })).themeAccent, 'sage');
assert.equal(migrateSettingsForDesign(0, settings({ themeAccent: 'blue' })).themeAccent, 'sage');
assert.equal(migrateSettingsForDesign(4, settings({ themeAccent: 'violet' })).themeAccent, 'violet');

function withAutoNext(value) {
  const next = settings();
  next.subtitle = { ...next.subtitle, autoNext: value };
  return next;
}

// 6. 全新安装：精听自动播放下一句默认关闭
assert.equal(fresh.subtitle.autoNext, false);

// 7. 旧版本仍保存着旧的默认开启：升级后一次性关闭
assert.equal(migrateSettingsForDesign(9, withAutoNext(true)).subtitle.autoNext, false);

// 8. 已经迁移过的版本：用户手动开启时保留
assert.equal(migrateSettingsForDesign(10, withAutoNext(true)).subtitle.autoNext, true);

// 9. 旧版本曾关闭：升级后保持关闭
assert.equal(migrateSettingsForDesign(4, withAutoNext(false)).subtitle.autoNext, false);

// 8. 迁移不修改传入对象
const input = settings({ discoverLayout: 'grid' });
migrateSettingsForDesign(3, input);
assert.equal(input.discoverLayout, 'grid');
assert.equal(migrateSettingsForDesign(4, withAutoNext(false)).designVersion, DESIGN_VERSION);

function withSubtitle(patch) {
  const next = settings();
  next.subtitle = { ...next.subtitle, ...patch };
  return next;
}

// 9. v5 migration gives existing users an independent 20px listening size.
//    On the new 400/500/600/700/800 scale, the old 600 original default
//    becomes 700 and the old 400 translation default becomes 500.
const legacyTypography = migrateSettingsForDesign(
  5,
  withSubtitle({
    listeningFontSize: 37,
    originalWeight: 'medium',
    translationWeight: 'regular',
  })
);
assert.equal(legacyTypography.subtitle.listeningFontSize, 20);
assert.equal(legacyTypography.subtitle.originalWeight, 'bold');
assert.equal(legacyTypography.subtitle.translationWeight, 'normal');

// 10. A v6 install still carrying the old 600 defaults moves to the new
//     original 700 / translation 500 defaults once.
const currentDefaults = migrateSettingsForDesign(
  6,
  withSubtitle({
    listeningFontSize: 30,
    originalWeight: 'medium',
    translationWeight: 'medium',
  })
);
assert.equal(currentDefaults.subtitle.listeningFontSize, 30);
assert.equal(currentDefaults.subtitle.originalWeight, 'bold');
assert.equal(currentDefaults.subtitle.translationWeight, 'normal');

// 11. Explicit old 400 stays thin, while old 800 and 900 both land on the
//     new 800 cap. The custom listening size survives.
const currentCustom = migrateSettingsForDesign(
  6,
  withSubtitle({
    listeningFontSize: 30,
    originalWeight: 'bold',
    translationWeight: 'regular',
  })
);
assert.equal(currentCustom.subtitle.listeningFontSize, 30);
assert.equal(currentCustom.subtitle.originalWeight, 'heavy');
assert.equal(currentCustom.subtitle.translationWeight, 'regular');
assert.equal(
  migrateSettingsForDesign(6, withSubtitle({ originalWeight: 'heavy' })).subtitle
    .originalWeight,
  'heavy'
);

console.log('settings-migration: 35 assertions passed');
