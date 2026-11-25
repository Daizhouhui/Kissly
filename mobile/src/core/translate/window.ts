import { findCueIndexAt } from '../cueIndex';
import type { Cue } from '../types';
import {
  SEEK_JUMP_SEC,
  WINDOW_AHEAD_SEC,
  WINDOW_BEFORE_SEC,
  WINDOW_MAX_CUES,
  WINDOW_REFILL_AHEAD_SEC,
} from './config';

/** Inclusive cue index range plus the time range it was derived from. */
export type CueWindow = {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
};

/** Video end in seconds; falls back to the last cue when metadata is missing. */
export function videoEndSeconds(
  cues: Cue[],
  durationSeconds?: number
): number {
  if (
    typeof durationSeconds === 'number' &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0
  ) {
    return durationSeconds;
  }
  let end = 0;
  for (const cue of cues) {
    if (Number.isFinite(cue.end)) end = Math.max(end, cue.end);
  }
  return end;
}

function anchorIndexFor(cues: Cue[], time: number): number {
  const index = findCueIndexAt(cues, time);
  if (index >= 0) return Math.min(cues.length - 1, index);
  if (!cues.length) return -1;
  // Before the first cue: use the first line. After the last: use the last.
  return cues[0].start <= time ? cues.length - 1 : 0;
}

/**
 * Map a time range onto cue indexes and truncate to `WINDOW_MAX_CUES` around
 * the playback anchor. The anchor cue is guaranteed to stay inside the window.
 */
export function computeWindow(
  cues: Cue[],
  anchorTime: number,
  durationSeconds?: number
): CueWindow | null {
  if (!cues.length) return null;
  const duration = videoEndSeconds(cues, durationSeconds);
  const anchor = Number.isFinite(anchorTime) ? Math.max(0, anchorTime) : 0;
  const startTime = Math.max(0, anchor - WINDOW_BEFORE_SEC);
  const endTime = Math.min(duration, anchor + WINDOW_AHEAD_SEC);

  let startIndex = cues.findIndex((cue) => cue.end >= startTime);
  if (startIndex < 0) startIndex = cues.length - 1;
  let endIndex = -1;
  for (let index = cues.length - 1; index >= 0; index -= 1) {
    if (cues[index].start <= endTime) {
      endIndex = index;
      break;
    }
  }
  if (endIndex < 0) endIndex = 0;
  if (endIndex < startIndex) endIndex = startIndex;

  const anchorIndex = Math.max(
    startIndex,
    Math.min(endIndex, anchorIndexFor(cues, anchor))
  );
  const span = endIndex - startIndex + 1;
  if (span > WINDOW_MAX_CUES) {
    const half = Math.floor(WINDOW_MAX_CUES / 2);
    startIndex = Math.max(
      startIndex,
      Math.min(anchorIndex - half, endIndex - WINDOW_MAX_CUES + 1)
    );
    endIndex = Math.min(endIndex, startIndex + WINDOW_MAX_CUES - 1);
    if (anchorIndex < startIndex) startIndex = anchorIndex;
    if (anchorIndex > endIndex) {
      endIndex = anchorIndex;
      startIndex = Math.max(0, endIndex - WINDOW_MAX_CUES + 1);
    }
  }

  return { startIndex, endIndex, startTime, endTime };
}

/**
 * Keep the already-active window and extend its tail. Forward playback should
 * never throw away the earlier lines of the current window.
 */
export function extendWindow(
  current: CueWindow,
  cues: Cue[],
  anchorTime: number,
  durationSeconds?: number
): CueWindow {
  const duration = videoEndSeconds(cues, durationSeconds);
  const anchor = Number.isFinite(anchorTime) ? Math.max(0, anchorTime) : 0;
  const endTime = Math.min(duration, anchor + WINDOW_AHEAD_SEC);
  if (endTime <= current.endTime + 0.5) return current;

  let endIndex = current.endIndex;
  for (let index = cues.length - 1; index > current.endIndex; index -= 1) {
    if (cues[index].start <= endTime) {
      endIndex = index;
      break;
    }
  }
  if (endIndex === current.endIndex) return current;
  // Growing the tail must not turn the window into the whole transcript: once
  // the cap is exceeded, rebuild around the anchor (which still keeps the
  // 15s look-back the reader needs for a quick rewind).
  if (endIndex - current.startIndex + 1 > WINDOW_MAX_CUES) {
    return computeWindow(cues, anchor, duration) ?? current;
  }
  return {
    ...current,
    endIndex,
    endTime,
  };
}

/** The window is about to run out of look-ahead: extend its tail. */
export function needsWindowRefill(
  window: CueWindow,
  anchorTime: number,
  durationSeconds?: number,
  cues?: Cue[]
): boolean {
  const duration = cues ? videoEndSeconds(cues, durationSeconds) : durationSeconds;
  if (typeof duration === 'number' && window.endTime >= duration - 0.5) {
    return false;
  }
  return anchorTime + WINDOW_REFILL_AHEAD_SEC > window.endTime;
}

/**
 * A playback jump beyond the current window (with a tolerance) is a seek: the
 * window is rebuilt so the new position is not stuck behind the old queue.
 */
export function isSeekJump(
  window: CueWindow,
  anchorTime: number,
  jumpSeconds = SEEK_JUMP_SEC
): boolean {
  return (
    anchorTime < window.startTime - jumpSeconds ||
    anchorTime > window.endTime + jumpSeconds
  );
}

/** Anchor moved outside the window bounds but not by a real seek. */
export function isAnchorOutsideWindow(
  window: CueWindow,
  anchorTime: number
): boolean {
  return anchorTime < window.startTime || anchorTime > window.endTime;
}
