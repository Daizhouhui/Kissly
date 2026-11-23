import { DEFAULT_SETTINGS, TARGET_LANGUAGES } from './defaults';
import {
  normalizeAutoFreeOrder,
  normalizeAutoPaidOrder,
} from './translate/autoOrder';
import {
  normalizeOpenAiProfileId,
  normalizeOpenAiProfiles,
} from './translate/openaiProfiles';
import type { Settings } from './types';

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function numberInRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  integer = false
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.min(max, Math.max(min, parsed));
  return integer ? Math.round(clamped) : clamped;
}

function languageOf(value: unknown, fallback: string): string {
  if (value === 'auto') return 'auto';
  return TARGET_LANGUAGES.some((item) => item.code === value)
    ? String(value)
    : fallback;
}

export function normalizeSettings(settings: Settings): Settings {
  const openaiProfiles = normalizeOpenAiProfiles(
    settings.openaiProfiles,
    settings.openaiBaseUrl,
    settings.openaiModel
  );
  const openaiProfileId = normalizeOpenAiProfileId(
    settings.openaiProfileId,
    openaiProfiles
  );
  const activeOpenAi =
    openaiProfiles.find((profile) => profile.id === openaiProfileId) ??
    openaiProfiles[0];
  const subtitle = settings.subtitle;
  return {
    ...settings,
    sourceLang: languageOf(settings.sourceLang, DEFAULT_SETTINGS.sourceLang),
    targetLang: languageOf(settings.targetLang, DEFAULT_SETTINGS.targetLang),
    learningLang: TARGET_LANGUAGES.some(
      (item) => item.code === settings.learningLang
    )
      ? settings.learningLang
      : DEFAULT_SETTINGS.learningLang,
    provider: oneOf(
      settings.provider,
      [
        'auto',
        'system',
        'microsoft',
        'google',
        'google2',
        'deepseek',
        'siliconflow',
        'openrouter',
        'openai',
      ] as const,
      DEFAULT_SETTINGS.provider
    ),
    autoFreeOrder: normalizeAutoFreeOrder(settings.autoFreeOrder),
    autoPaidOrder: normalizeAutoPaidOrder(settings.autoPaidOrder),
    titleTranslationMode: oneOf(
      settings.titleTranslationMode,
      ['none', 'bilingual', 'translation'] as const,
      DEFAULT_SETTINGS.titleTranslationMode
    ),
    defaultTab: oneOf(
      settings.defaultTab,
      ['video', 'podcast', 'learning', 'me'] as const,
      DEFAULT_SETTINGS.defaultTab
    ),
    discoverLayout: oneOf(
      settings.discoverLayout,
      ['list', 'grid', 'large'] as const,
      DEFAULT_SETTINGS.discoverLayout
    ),
    theme: oneOf(
      settings.theme,
      ['system', 'light', 'dark'] as const,
      DEFAULT_SETTINGS.theme
    ),
    themeAccent: oneOf(
      settings.themeAccent,
      ['sage', 'violet', 'blue', 'teal', 'orange', 'rose', 'green'] as const,
      DEFAULT_SETTINGS.themeAccent
    ),
    speechRate: numberInRange(settings.speechRate, 0.5, 2, DEFAULT_SETTINGS.speechRate),
    speechPitch: numberInRange(settings.speechPitch, 0.5, 2, DEFAULT_SETTINGS.speechPitch),
    requestTimeoutMs: numberInRange(
      settings.requestTimeoutMs,
      5000,
      120000,
      DEFAULT_SETTINGS.requestTimeoutMs,
      true
    ),
    deepseekModel: settings.deepseekModel || DEFAULT_SETTINGS.deepseekModel,
    siliconflowModel:
      settings.siliconflowModel || DEFAULT_SETTINGS.siliconflowModel,
    openrouterModel:
      settings.openrouterModel || DEFAULT_SETTINGS.openrouterModel,
    subtitle: {
      ...subtitle,
      fontSize: numberInRange(
        subtitle?.fontSize,
        12,
        40,
        DEFAULT_SETTINGS.subtitle.fontSize,
        true
      ),
      landscapeFontSize: numberInRange(
        subtitle?.landscapeFontSize,
        12,
        60,
        DEFAULT_SETTINGS.subtitle.landscapeFontSize,
        true
      ),
      mode: oneOf(
        subtitle?.mode,
        ['bilingual', 'original', 'translation'] as const,
        DEFAULT_SETTINGS.subtitle.mode
      ),
      position: oneOf(
        subtitle?.position,
        ['bottom', 'top'] as const,
        DEFAULT_SETTINGS.subtitle.position
      ),
      backgroundOpacity: numberInRange(
        subtitle?.backgroundOpacity,
        0,
        1,
        DEFAULT_SETTINGS.subtitle.backgroundOpacity
      ),
      scrollMode: oneOf(
        subtitle?.scrollMode,
        ['top', 'page'] as const,
        DEFAULT_SETTINGS.subtitle.scrollMode
      ),
      sentenceMode: oneOf(
        subtitle?.sentenceMode,
        ['smart', 'whole'] as const,
        DEFAULT_SETTINGS.subtitle.sentenceMode
      ),
      originalFont: oneOf(
        subtitle?.originalFont,
        ['default', 'rounded', 'serif', 'geometric', 'kai'] as const,
        DEFAULT_SETTINGS.subtitle.originalFont
      ),
      translationFont: oneOf(
        subtitle?.translationFont,
        ['default', 'rounded', 'serif', 'geometric', 'kai'] as const,
        DEFAULT_SETTINGS.subtitle.translationFont
      ),
      originalWeight: oneOf(
        subtitle?.originalWeight,
        ['regular', 'medium', 'bold'] as const,
        DEFAULT_SETTINGS.subtitle.originalWeight
      ),
      translationWeight: oneOf(
        subtitle?.translationWeight,
        ['regular', 'medium', 'bold'] as const,
        DEFAULT_SETTINGS.subtitle.translationWeight
      ),
      originalTiming: oneOf(
        subtitle?.originalTiming,
        ['always', 'after'] as const,
        DEFAULT_SETTINGS.subtitle.originalTiming
      ),
      listeningOriginalMode: oneOf(
        subtitle?.listeningOriginalMode,
        ['after', 'always', 'tap'] as const,
        DEFAULT_SETTINGS.subtitle.listeningOriginalMode
      ),
      listeningTranslationMode: oneOf(
        subtitle?.listeningTranslationMode,
        ['always', 'together', 'tap'] as const,
        DEFAULT_SETTINGS.subtitle.listeningTranslationMode
      ),
      repeatCount: numberInRange(
        subtitle?.repeatCount,
        1,
        20,
        DEFAULT_SETTINGS.subtitle.repeatCount,
        true
      ),
      repeatInterval: numberInRange(
        subtitle?.repeatInterval,
        0,
        10,
        DEFAULT_SETTINGS.subtitle.repeatInterval
      ),
    },
    openaiProfiles,
    openaiProfileId,
    // Translation and cache code read the legacy flat fields. Keep them as a
    // mirror of the active profile so old callers and old caches still work.
    openaiBaseUrl: activeOpenAi?.baseUrl ?? settings.openaiBaseUrl,
    openaiModel: activeOpenAi?.model ?? settings.openaiModel,
  };
}
