import type { VideoItem } from './types';

/** Deduplicate by videoId and keep the newest first. */
export function uniqueVideoItems(items: VideoItem[]): VideoItem[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (!item.videoId || seen.has(item.videoId)) return false;
      seen.add(item.videoId);
      return true;
    })
    .sort((a, b) => b.published - a.published);
}

export function mergeHomePool(
  current: VideoItem[],
  incoming: VideoItem[],
  limit: number
): VideoItem[] {
  return uniqueVideoItems([...current, ...incoming]).slice(0, Math.max(0, limit));
}

export function mergeChannelItems(
  current: VideoItem[],
  incoming: VideoItem[]
): VideoItem[] {
  return uniqueVideoItems([...incoming, ...current]);
}

/** Split a buffer into the next display batch and the remaining queue. */
export function takeChannelBatch(
  buffer: VideoItem[],
  size: number
): { batch: VideoItem[]; rest: VideoItem[] } {
  const count = Math.max(0, size);
  return {
    batch: buffer.slice(0, count),
    rest: buffer.slice(count),
  };
}
