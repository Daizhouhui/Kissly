import { loadCached, saveCached } from '../storage';
import type { VideoMeta } from '../types';
import {
  VIDEO_INFO_TTL_MS,
  normalizeVideoInfo,
  videoInfoFromMeta,
} from './videoInfo';
import type { VideoInfo } from './videoInfo';

const PREFIX = 'video-meta:';

function cacheKey(videoId: string): string {
  return `${PREFIX}${videoId}`;
}

export async function loadCachedVideoInfo(
  videoId: string
): Promise<VideoInfo | null> {
  const value = await loadCached<unknown>(cacheKey(videoId), VIDEO_INFO_TTL_MS);
  const info = normalizeVideoInfo(value);
  return info && info.videoId === videoId ? info : null;
}

export async function saveVideoInfo(
  videoId: string,
  meta: VideoMeta
): Promise<void> {
  await saveCached(cacheKey(videoId), videoInfoFromMeta(meta));
}
