import type { VideoMeta } from '../types';

export type VideoInfo = {
  videoId: string;
  title: string;
  author: string;
  channelId?: string;
  lengthSeconds: number;
  thumbnail: string;
};

export const VIDEO_INFO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Keep only stable fields. Caption URLs are signed and must stay fresh. */
export function videoInfoFromMeta(
  meta: Pick<
    VideoMeta,
    'videoId' | 'title' | 'author' | 'channelId' | 'lengthSeconds' | 'thumbnail'
  >
): VideoInfo {
  return {
    videoId: meta.videoId,
    title: typeof meta.title === 'string' ? meta.title : '',
    author: typeof meta.author === 'string' ? meta.author : '',
    channelId:
      typeof meta.channelId === 'string' && meta.channelId
        ? meta.channelId
        : undefined,
    lengthSeconds:
      typeof meta.lengthSeconds === 'number' && meta.lengthSeconds > 0
        ? meta.lengthSeconds
        : 0,
    thumbnail: typeof meta.thumbnail === 'string' ? meta.thumbnail : '',
  };
}

export function normalizeVideoInfo(value: unknown): VideoInfo | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.videoId !== 'string' || !raw.videoId) return null;
  return {
    videoId: raw.videoId,
    title: typeof raw.title === 'string' ? raw.title : '',
    author: typeof raw.author === 'string' ? raw.author : '',
    channelId:
      typeof raw.channelId === 'string' && raw.channelId
        ? raw.channelId
        : undefined,
    lengthSeconds:
      typeof raw.lengthSeconds === 'number' && raw.lengthSeconds > 0
        ? raw.lengthSeconds
        : 0,
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : '',
  };
}
