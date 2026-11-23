import type { Settings } from './types';

export const DESIGN_VERSION = 4;

/**
 * One-time visual defaults applied when a saved install predates a design
 * revision. Pure and idempotent so it can be unit-tested: the caller passes
 * the persisted version and receives a migrated copy.
 */
export function migrateSettingsForDesign(previousDesign: number, settings: Settings): Settings {
  const next: Settings = { ...settings };
  if (previousDesign < 1 && next.themeAccent === 'blue') {
    next.themeAccent = 'sage';
  }
  if (previousDesign < 3 && next.themeAccent === 'violet') {
    next.themeAccent = 'sage';
  }
  // 1.3.0 saved whichever layout the device had, and the old default was
  // grid. Move installs that still sit on grid to the new list default once;
  // later manual choices (designVersion already 4) are kept.
  if (previousDesign < 4 && next.discoverLayout === 'grid') {
    next.discoverLayout = 'list';
  }
  next.designVersion = DESIGN_VERSION;
  return next;
}
