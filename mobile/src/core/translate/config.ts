import type { ProviderId } from '../types';

/**
 * P0 safety switches. Flip one of these to fall back to the previous
 * behaviour without touching the rest of the translation chain:
 * - `LAZY_TRANSLATION_ENABLED`: player.tsx uses the old full-list
 *   `translateCueList()` path when false.
 * - `AUTO_COMPLETE_ENABLED`: window translation keeps working, the 90%
 *   background fill stops.
 * - `REQUEST_GATE_ENABLED`: providers call `httpText` directly again.
 * - `CAPTION_PROGRESSIVE_ENABLED`: reserved for the optional progressive
 *   YouTube caption track (not implemented yet).
 */
export const LAZY_TRANSLATION_ENABLED = true;
export const AUTO_COMPLETE_ENABLED = true;
export const REQUEST_GATE_ENABLED = true;
export const CAPTION_PROGRESSIVE_ENABLED = false;

/** Translations are kept much longer than source captions in practice. */
export const CUE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Playback window: a little look-back for quick rewinds, a lot of look-ahead. */
export const WINDOW_BEFORE_SEC = 15;
export const WINDOW_AHEAD_SEC = 120;
/** Extend the window when the remaining look-ahead drops under this value. */
export const WINDOW_REFILL_AHEAD_SEC = 30;
/** Cap per window so dense auto-captions cannot flood a single pass. */
export const WINDOW_MAX_CUES = 40;
/** A playback jump bigger than this rebuilds the window instead of extending it. */
export const SEEK_JUMP_SEC = 10;

/**
 * The provider endpoints have hard batch maxima (Google2 / Microsoft = 12
 * items, AI = 18 items / 1600 chars). Foreground batches are smaller so the
 * current line appears sooner; background batches sit exactly on the limit so
 * auto-fill needs fewer requests.
 */
export const BATCH_SIZE_FREE_FOREGROUND = 6;
export const BATCH_SIZE_FREE_BACKGROUND = 12;
export const BATCH_SIZE_AI_FOREGROUND = 12;
export const BATCH_SIZE_AI_BACKGROUND = 18;

/** Coverage at which the remaining subtitles are filled in the background. */
export const AUTO_COMPLETE_COVERAGE = 0.9;
export const AUTO_COMPLETE_CONCURRENCY = 1;

/** Two workers is the safe middle ground for phone networks and free APIs. */
export const TRANSLATE_CONCURRENCY = 2;
/** One delayed retry is allowed for a transient batch failure. */
export const TRANSLATE_RETRY_DELAY_MS = 2000;
/** Playback anchors arrive every ~900ms; applying them once per second is enough. */
export const ANCHOR_THROTTLE_MS = 1000;
/** Cache writes replace a whole-video snapshot, so throttle them. */
export const CACHE_WRITE_THROTTLE_MS = 3000;
/** Progress callbacks carry the whole cue array; throttle React setState. */
export const PROGRESS_THROTTLE_MS = 300;

const AI_PROVIDERS: readonly ProviderId[] = [
  'deepseek',
  'siliconflow',
  'openrouter',
  'openai',
];

export function isAiProvider(provider: ProviderId): boolean {
  return AI_PROVIDERS.includes(provider);
}

/**
 * Batch size for the scheduling layer. `auto` starts on the free order, so it
 * uses free sizes until a paid fallback actually answers; the session then
 * switches to the AI sizes for the rest of the run.
 */
export function batchSizeForProvider(
  provider: ProviderId,
  background: boolean
): number {
  if (isAiProvider(provider)) {
    return background
      ? BATCH_SIZE_AI_BACKGROUND
      : BATCH_SIZE_AI_FOREGROUND;
  }
  return background
    ? BATCH_SIZE_FREE_BACKGROUND
    : BATCH_SIZE_FREE_FOREGROUND;
}
