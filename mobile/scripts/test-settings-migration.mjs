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
assert.equal(DESIGN_VERSION, 5);

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

// 5. 历史主题色迁移仍然只做一次
assert.equal(migrateSettingsForDesign(2, settings({ themeAccent: 'violet' })).themeAccent, 'sage');
assert.equal(migrateSettingsForDesign(0, settings({ themeAccent: 'blue' })).themeAccent, 'sage');
assert.equal(migrateSettingsForDesign(4, settings({ themeAccent: 'violet' })).themeAccent, 'violet');

function withAutoNext(value) {
  const next = settings();
  next.subtitle = { ...next.subtitle, autoNext: value };
  return next;
}

// 6. 旧版本曾持久化 autoNext=false：升级后恢复产品默认开启
assert.equal(migrateSettingsForDesign(4, withAutoNext(false)).subtitle.autoNext, true);

// 7. 已经迁移过的版本：用户明确关闭时保留
assert.equal(migrateSettingsForDesign(5, withAutoNext(false)).subtitle.autoNext, false);

// 8. 迁移不修改传入对象
const input = settings({ discoverLayout: 'grid' });
migrateSettingsForDesign(3, input);
assert.equal(input.discoverLayout, 'grid');
assert.equal(migrateSettingsForDesign(4, withAutoNext(false)).designVersion, DESIGN_VERSION);

console.log('settings-migration: 13 assertions passed');
