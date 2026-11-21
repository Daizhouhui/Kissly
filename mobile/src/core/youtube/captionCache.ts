import { Cue } from '../types';
import { loadCached, removeKey, saveCached } from '../storage';

/**
 * Captions are expensive to resolve: YouTube may need several track requests
 * and a WebView fallback. Keep the raw source subtitles for a month so reopening
 * a video starts from the transcript immediately.
 */
const CAPTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type CachedCaptions = {
  cues: Cue[];
  trackKey: string;
};

function cacheKey(videoId: string, learningLang: string) {
  return `captions:v2:${videoId}:${learningLang}`;
}

export async function loadCachedCaptions(
  videoId: string,
  learningLang: string
): Promise<CachedCaptions | null> {
  const entry = await loadCached<CachedCaptions>(
    cacheKey(videoId, learningLang),
    CAPTION_TTL_MS
  );
  if (!entry?.cues?.length || !entry.trackKey) return null;
  return entry;
}

export async function saveCachedCaptions(
  videoId: string,
  learningLang: string,
  cues: Cue[],
  trackKey: string
): Promise<void> {
  if (!cues.length || !trackKey) return;
  await saveCached(cacheKey(videoId, learningLang), { cues, trackKey });
}

export async function clearCachedCaptions(
  videoId: string,
  learningLang: string
): Promise<void> {
  await removeKey(cacheKey(videoId, learningLang));
}
