import type { Cue } from './types';

/**
 * Find the last cue whose start is at or before `time`. Cues are sorted, so a
 * binary search keeps the 900ms playback tick cheap for 1–2h videos.
 */
export function findCueIndexAt(
  cues: Pick<Cue, 'start'>[],
  time: number,
  tolerance = 0.12
): number {
  if (!cues.length || !Number.isFinite(time)) return -1;
  const target = time + Math.max(0, tolerance);
  let low = 0;
  let high = cues.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (cues[middle].start <= target) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}
