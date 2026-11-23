import type { Cue, ProviderId } from '../types';

export type CueCachePayload = {
  cues: Cue[];
  provider: ProviderId;
};

export type LoadedCueCache = {
  at: number;
  value: CueCachePayload;
};

export type PickedCueCache = {
  at: number;
  provider: ProviderId;
  translations: string[];
};

/**
 * A cache from another provider is still useful only when it was produced from
 * the exact same cue list. Start/end may move by a millisecond after an SRT
 * round-trip; the text itself must match.
 */
export function cueCacheMatches(cues: Cue[], cached: CueCachePayload): boolean {
  if (!Array.isArray(cached?.cues) || cached.cues.length !== cues.length) {
    return false;
  }
  return cached.cues.every(
    (cue, index) =>
      Math.abs(cue.start - cues[index].start) < 0.002 &&
      Math.abs(cue.end - cues[index].end) < 0.002 &&
      cue.text === cues[index].text
  );
}

/**
 * Choose one cached list instead of mixing providers line by line. The list
 * with the most translated lines wins; a newer list wins a tie. A single
 * provider keeps the transcript wording consistent.
 */
export function pickBestCueCache(
  cues: Cue[],
  entries: Array<LoadedCueCache | null>
): PickedCueCache | null {
  let best: (PickedCueCache & { translated: number }) | null = null;
  for (const entry of entries) {
    if (!entry?.value || !cueCacheMatches(cues, entry.value)) continue;
    const translations = cues.map((_, index) => {
      const value = entry.value.cues[index]?.translation;
      return typeof value === 'string' ? value : '';
    });
    const translated = translations.filter(Boolean).length;
    if (!translated) continue;
    if (
      !best ||
      translated > best.translated ||
      (translated === best.translated && entry.at > best.at)
    ) {
      best = {
        at: entry.at,
        provider: entry.value.provider,
        translations,
        translated,
      };
    }
  }
  return best;
}
