import type { Settings, SubtitleWeight } from './types';

export const DESIGN_VERSION = 10;

function upgradeWeight(
  weight: SubtitleWeight,
  line: 'original' | 'translation'
): SubtitleWeight {
  // The old four-step scale was 400/600/800/900. On the new
  // 400/500/600/700/800 scale the old defaults move to the new defaults
  // (original 700, translation 500), while custom 400/800 stay visually
  // equivalent and the old 900 is capped at the new 800.
  if (weight === 'medium') return line === 'original' ? 'bold' : 'normal';
  if (weight === 'bold' || weight === 'heavy') return 'heavy';
  return weight;
}

/**
 * One-time defaults and behavior migrations applied when a saved install
 * predates a design revision. Pure and idempotent so it can be unit-tested:
 * the caller passes the persisted version and receives a migrated copy.
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
  // Design v10 turns precision-listening auto-advance off by default. Reset
  // installs still carrying the old default on once; after this migration an
  // explicit on choice is preserved.
  if (previousDesign < 10 && next.subtitle.autoNext) {
    next.subtitle = { ...next.subtitle, autoNext: false };
  }
  // The typography redesign introduced a separate precision-listening size.
  // Existing installs start listening at 20.
  if (previousDesign < 6) {
    next.subtitle = {
      ...next.subtitle,
      listeningFontSize: 20,
      translationWeight:
        next.subtitle.translationWeight === 'regular'
          ? 'medium'
          : next.subtitle.translationWeight,
    };
  }
  // Design v7 expands the shared weight scale to 400/500/600/700/800. The old
  // 600 defaults become the new original 700 / translation 500 defaults, while
  // explicit 400 choices stay thin and 800/900 both map to the new 800 cap.
  if (previousDesign > 0 && previousDesign < 7) {
    next.subtitle = {
      ...next.subtitle,
      originalWeight: upgradeWeight(next.subtitle.originalWeight, 'original'),
      translationWeight: upgradeWeight(
        next.subtitle.translationWeight,
        'translation'
      ),
    };
  }
  // The title display default moves from bilingual to untranslated. Reset
  // installs still carrying the old bilingual preference once.
  if (previousDesign < 8 && next.titleTranslationMode === 'bilingual') {
    next.titleTranslationMode = 'none';
  }
  next.designVersion = DESIGN_VERSION;
  return next;
}
