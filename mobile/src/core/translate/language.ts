/**
 * ML Kit needs a concrete source language: it cannot detect a language and its
 * `auto` branch used to silently pick English. The app knows which caption
 * track it fetched (`learningLang`), so that is the best source when the user
 * left the translation source on "auto".
 */
export function resolveSystemSource(
  from: string | undefined,
  learningLang: string | undefined
): string {
  const source = String(from ?? '').trim();
  if (source && source.toLowerCase() !== 'auto') return source;
  const fallback = String(learningLang ?? '').trim();
  return fallback || 'en';
}

/**
 * Languages exposed by ML Kit Translate on iOS and Android. Keep this list
 * conservative: a false positive sends an unsupported code to the native
 * module and produces an opaque platform error, while a false negative only
 * shows the friendly "use another engine" message.
 */
export const SYSTEM_TRANSLATE_LANGUAGES = new Set([
  'af', 'sq', 'ar', 'be', 'bn', 'bg', 'ca', 'zh', 'hr', 'cs',
  'da', 'nl', 'en', 'eo', 'et', 'fi', 'fr', 'gl', 'ka', 'de',
  'el', 'gu', 'ht', 'he', 'hi', 'hu', 'is', 'id', 'ga', 'it',
  'ja', 'kn', 'ko', 'lv', 'lt', 'mk', 'ms', 'mt', 'mr',
  'no', 'fa', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'es', 'sw',
  'sv', 'tl', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'vi', 'cy',
]);

/** Historical or regional tags that the native ML Kit enum accepts. */
const SYSTEM_LANGUAGE_ALIASES: Record<string, string> = {
  iw: 'he',
  in: 'id',
  ji: 'yi',
  jw: 'jv',
  fil: 'tl',
  nb: 'no',
  nn: 'no',
  cmn: 'zh',
};

/**
 * Normalize a BCP-47-ish tag to the base code ML Kit expects. Region and
 * script suffixes are dropped (`zh-Hans`/`zh-CN` -> `zh`, `pt-BR` -> `pt`).
 * Returns an empty string for `auto` or a blank tag.
 */
export function normalizeSystemLanguage(tag: string | undefined): string {
  const raw = String(tag ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (!raw || raw === 'auto') return '';
  const base = raw.split('-')[0] ?? '';
  return SYSTEM_LANGUAGE_ALIASES[base] ?? base;
}

export class UnsupportedSystemLanguageError extends Error {
  readonly code = 'ERR_SYSTEM_LANGUAGE';
  readonly languageTag: string;

  constructor(tag: string, field: string) {
    const shown = tag.trim() || '空';
    super(
      `系统翻译不支持${field}语言“${shown}”，请改用微软/谷歌，或在设置中选择系统翻译支持的语言。`
    );
    this.name = 'UnsupportedSystemLanguageError';
    this.languageTag = tag;
  }
}

/**
 * Validate before calling native ML Kit so the UI gets a useful message
 * instead of `ERR_SYSTEM_LANGUAGE` from the platform bridge. The returned
 * value is the canonical base code to pass to the native module.
 */
export function assertSystemLanguageSupported(
  tag: string | undefined,
  field: '原文' | '译文'
): string {
  const normalized = normalizeSystemLanguage(tag);
  if (!normalized || !SYSTEM_TRANSLATE_LANGUAGES.has(normalized)) {
    throw new UnsupportedSystemLanguageError(String(tag ?? ''), field);
  }
  return normalized;
}
