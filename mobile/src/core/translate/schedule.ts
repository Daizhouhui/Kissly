export type CueBatchRange = {
  start: number;
  end: number;
};

/** Split cue indexes into fixed, contiguous batches. */
export function cueBatchRanges(count: number, batchSize: number): CueBatchRange[] {
  if (count <= 0) return [];
  const size = Math.max(1, Math.floor(batchSize));
  const result: CueBatchRange[] = [];
  for (let start = 0; start < count; start += size) {
    result.push({ start, end: Math.min(count, start + size) });
  }
  return result;
}

/** Locate the batch that contains the cue at `anchorIndex`. */
export function batchIndexAtAnchor(
  ranges: CueBatchRange[],
  anchorIndex: number
): number {
  if (!ranges.length) return -1;
  if (!Number.isFinite(anchorIndex) || anchorIndex < 0) return 0;
  const candidate = Math.floor(anchorIndex);
  const last = ranges.length - 1;
  if (candidate >= ranges[last].end) return last;

  let low = 0;
  let high = last;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle];
    if (candidate < range.start) high = middle - 1;
    else if (candidate >= range.end) low = middle + 1;
    else return middle;
  }
  return 0;
}

/**
 * Pick the next batch to translate, relative to the current playback position.
 *
 * Forward batches win first so playback always has upcoming subtitles ready;
 * only after the rest of the video is covered do we fill the earlier gaps.
 */
export function pickNextCueBatch(
  ranges: CueBatchRange[],
  anchorIndex: number,
  isPending: (batchIndex: number) => boolean
): number {
  if (!ranges.length) return -1;
  const anchorBatch = batchIndexAtAnchor(ranges, anchorIndex);
  for (let index = anchorBatch; index < ranges.length; index += 1) {
    if (isPending(index)) return index;
  }
  for (let index = anchorBatch - 1; index >= 0; index -= 1) {
    if (isPending(index)) return index;
  }
  return -1;
}
