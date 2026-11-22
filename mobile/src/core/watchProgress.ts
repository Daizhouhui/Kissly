import type { HistoryItem } from './types';

export type HistoryPatch = Partial<Omit<HistoryItem, 'videoId'>> & {
  videoId: string;
};

function clamp01(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value)));
}

function positive(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || Number(value) <= 0) return undefined;
  return Number(value);
}

/**
 * Single merge point for watch history.
 *
 * The caller may run at any time (interval, pause, unmount, stale screen), so
 * every field is merged against the latest stored entry instead of replacing
 * it. `progress` is the furthest point and never goes backwards; `resumeAt` is
 * the last position and only moves when playback actually advanced.
 */
export function mergeHistoryEntry(
  previous: HistoryItem | undefined,
  patch: HistoryPatch,
  now: number
): HistoryItem {
  const progress = Math.max(
    clamp01(previous?.progress),
    clamp01(patch.progress)
  );
  const duration = positive(patch.duration) ?? previous?.duration;
  const candidateResume = Number(patch.resumeAt);
  const resumeAt =
    Number.isFinite(candidateResume) && candidateResume > 0.5
      ? candidateResume
      : previous?.resumeAt;

  return {
    videoId: patch.videoId,
    title: patch.title?.trim() || previous?.title || patch.videoId,
    author: patch.author?.trim() || previous?.author || '',
    thumbnail: patch.thumbnail || previous?.thumbnail,
    savedAt: previous?.savedAt ?? patch.savedAt ?? now,
    lastWatchedAt: patch.lastWatchedAt ?? now,
    progress,
    resumeAt:
      resumeAt == null
        ? undefined
        : Math.max(0, duration ? Math.min(resumeAt, duration) : resumeAt),
    duration,
  };
}

/** Last known position in seconds, falling back to the furthest fraction. */
export function resumeAtOf(
  item: Pick<HistoryItem, 'progress' | 'resumeAt' | 'duration'>
): number {
  const duration = positive(item.duration);
  const stored = Number(item.resumeAt);
  if (Number.isFinite(stored) && stored > 0) {
    return duration ? Math.max(0, Math.min(stored, duration)) : Math.max(0, stored);
  }
  if (!duration) return 0;
  return clamp01(item.progress) * duration;
}

/** How much of the timeline should be painted in list cards. */
export function watchedFraction(
  item: Pick<HistoryItem, 'progress' | 'resumeAt' | 'duration'>
): number {
  const duration = positive(item.duration);
  if (!duration) return clamp01(item.progress);
  return Math.max(0, Math.min(1, resumeAtOf(item) / duration));
}

/** Remaining minutes for the continue card; null when duration is unknown. */
export function remainingSeconds(
  item: Pick<HistoryItem, 'progress' | 'resumeAt' | 'duration'>
): number | null {
  const duration = positive(item.duration);
  if (!duration) return null;
  return Math.max(0, duration - resumeAtOf(item));
}

 /**
 * Route params arrive as strings. Anything not a usable second value becomes 0.
 */
export function parseStartAt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 1) return 0;
  return parsed;
}

/**
 * Start position to hand to the player.
 * Avoid resuming in the last three seconds, which would land on the end screen.
 */
export function resumeTarget(
  item: Pick<HistoryItem, 'progress' | 'resumeAt' | 'duration'>
): number {
  const duration = positive(item.duration);
  const target = resumeAtOf(item);
  if (!duration) return target;
  if (target < 1 || target >= duration - 3) return 0;
  return target;
}
