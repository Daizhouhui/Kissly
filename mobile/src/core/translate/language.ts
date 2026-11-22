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
