import type { Cue } from '../types';

export type CueTranslationTask = {
  /** Original cue indexes, ascending. Kept as indexes so merges never drift. */
  indices: number[];
};

/** Cues that still need a provider request inside an index range. */
export function collectPendingCueIndices(
  cues: Cue[],
  translations: string[],
  excluded: Set<number>,
  startIndex = 0,
  endIndex = cues.length - 1
): number[] {
  const result: number[] = [];
  const start = Math.max(0, Math.floor(startIndex));
  const end = Math.min(cues.length - 1, Math.floor(endIndex));
  for (let index = start; index <= end; index += 1) {
    if (!cues[index]?.text?.trim()) continue;
    if ((translations[index] ?? '').trim()) continue;
    if (excluded.has(index)) continue;
    result.push(index);
  }
  return result;
}

/**
 * Priority order for window translation:
 * 1. the batch that contains the playback anchor;
 * 2. the batch immediately before it (quick rewind stays translated);
 * 3. the rest of the window towards the end;
 * 4. the earlier lines of the window.
 *
 * `pending` is the ascending list of cue indexes that still need work and are
 * not already in flight.
 */
export function planForegroundTasks(
  pending: number[],
  anchorIndex: number,
  batchSize: number
): CueTranslationTask[] {
  if (!pending.length) return [];
  const size = Math.max(1, Math.floor(batchSize));
  const anchorPos = pending.findIndex((index) => index >= anchorIndex);

  // Everything left of the anchor: nearest pending line wins.
  if (anchorPos < 0) {
    const tasks: CueTranslationTask[] = [];
    let chunkEnd = pending.length - 1;
    while (chunkEnd >= 0) {
      const chunkStart = Math.max(0, chunkEnd - size + 1);
      tasks.push({ indices: pending.slice(chunkStart, chunkEnd + 1) });
      chunkEnd = chunkStart - 1;
    }
    return tasks;
  }

  const tasks: CueTranslationTask[] = [];

  // 1. Anchor batch: from the anchor forward, filled to the batch size.
  const headStart = anchorPos;
  const headEnd = Math.min(pending.length - 1, headStart + size - 1);
  tasks.push({ indices: pending.slice(headStart, headEnd + 1) });

  // 2. One batch immediately before the anchor batch.
  const beforeEnd = headStart - 1;
  const beforeStart = Math.max(0, beforeEnd - size + 1);
  if (beforeEnd >= 0) {
    tasks.push({ indices: pending.slice(beforeStart, beforeEnd + 1) });
  }

  // 3. The rest of the window towards the end.
  for (let pos = headEnd + 1; pos < pending.length; pos += size) {
    tasks.push({ indices: pending.slice(pos, Math.min(pending.length, pos + size)) });
  }

  // 4. Remaining earlier lines, closest first.
  let chunkEnd = beforeStart - 1;
  while (chunkEnd >= 0) {
    const chunkStart = Math.max(0, chunkEnd - size + 1);
    tasks.push({ indices: pending.slice(chunkStart, chunkEnd + 1) });
    chunkEnd = chunkStart - 1;
  }

  return tasks;
}

/** Auto-fill always starts from the first untranslated line of the video. */
export function planBackgroundTask(
  pending: number[],
  batchSize: number
): CueTranslationTask | null {
  if (!pending.length) return null;
  const size = Math.max(1, Math.floor(batchSize));
  return { indices: pending.slice(0, size) };
}

/** Coverage counts only caption lines that actually have text. */
export function translationCoverage(
  cues: Cue[],
  translations: string[]
): { total: number; translated: number; coverage: number } {
  let total = 0;
  let translated = 0;
  for (let index = 0; index < cues.length; index += 1) {
    if (!cues[index]?.text?.trim()) continue;
    total += 1;
    if ((translations[index] ?? '').trim()) translated += 1;
  }
  return {
    total,
    translated,
    coverage: total ? translated / total : 1,
  };
}

export type AutoFillState = {
  coverage: number;
  foregroundPending: boolean;
  foreground: boolean;
  ad: boolean;
  seeking: boolean;
  backgroundInFlight: number;
  concurrency?: number;
};

/**
 * Auto-fill only runs when the video is already nearly complete, the window
 * has nothing left, the app is in the foreground and no ad/seek is in progress.
 * At most `concurrency` (default 1) background task may run.
 */
export function shouldStartAutoFill(
  state: AutoFillState,
  threshold = 0.9
): boolean {
  if (state.backgroundInFlight >= (state.concurrency ?? 1)) return false;
  if (state.foregroundPending) return false;
  if (!state.foreground || state.ad || state.seeking) return false;
  return state.coverage >= threshold;
}
