import { BROWSER_HEADERS, httpJson } from '../http';
import { loadCachedEntry, saveCached } from '../storage';
import { VideoItem } from '../types';
import {
  CHANNEL_FIRST_CACHE_PREFIX,
  FEED_STORE_TTL,
} from './constants';
import { chooseContinuationToken } from './continuation';
import { ChannelInfo, parseChannelInfo, parseCountLabel } from './channelMetadata';

export { CHANNEL_BATCH_SIZE } from './constants';
export type { ChannelInfo } from './channelMetadata';
export { parseCountLabel } from './channelMetadata';

const BROWSE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const BROWSE_URL = `https://www.youtube.com/youtubei/v1/browse?key=${BROWSE_KEY}&prettyPrint=false`;
// Videos tab of a channel. This is the same parameter the YouTube web client
// uses; without it the browse response opens the channel home tab instead.
const VIDEOS_TAB = 'EgZ2aWRlb3PyBgQKAjoA';
const PLAYLISTS_TAB = 'EglwbGF5bGlzdHPyBgQKAkIA';

export type ChannelVideoPage = {
  items: VideoItem[];
  continuation?: string;
  channelInfo?: ChannelInfo;
};

export type ChannelPlaylist = {
  playlistId: string;
  title: string;
  thumbnail: string;
  videoCount?: number;
};

const pageCache = new Map<string, { at: number; page: ChannelVideoPage }>();
const PAGE_TTL = 5 * 60 * 1000;

function pageCacheKey(channelId: string, continuation?: string): string {
  return `${channelId}:${continuation ?? 'first'}`;
}

/** Read the in-memory first page without triggering a network request. */
export function peekChannelVideoPage(
  channelId: string,
  continuation?: string
): ChannelVideoPage | null {
  const cached = pageCache.get(pageCacheKey(channelId, continuation));
  if (!cached || Date.now() - cached.at >= PAGE_TTL) return null;
  return cached.page;
}

export async function loadChannelFirstPage(
  channelId: string
): Promise<ChannelVideoPage | null> {
  const entry = await loadCachedEntry<ChannelVideoPage>(
    `${CHANNEL_FIRST_CACHE_PREFIX}${channelId}`,
    FEED_STORE_TTL
  );
  if (!entry) return null;
  // Preserve the persisted timestamp so a no-force fetch cannot treat a
  // six-day-old snapshot as a fresh five-minute page cache hit.
  pageCache.set(pageCacheKey(channelId), { at: entry.at, page: entry.value });
  return entry.value;
}

export async function saveChannelFirstPage(
  channelId: string,
  page: ChannelVideoPage
): Promise<void> {
  if (!page.items.length) return;
  await saveCached(`${CHANNEL_FIRST_CACHE_PREFIX}${channelId}`, page);
}

function textOf(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.content === 'string') return value.content;
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value.runs)) {
    return value.runs.map((run: any) => run?.text ?? '').join('');
  }
  return '';
}

function durationFromText(text: string): number | undefined {
  const parts = String(text || '')
    .split(':')
    .map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function relativeMs(value: string): number {
  const text = String(value ?? '').toLowerCase();
  const match = text.match(
    /(\d+(?:[.,]\d+)?)\s*(second|minute|hour|day|week|month|year)s?\s*(?:ago|前)/
  );
  if (!match) return Date.now();
  const amount = Number(match[1].replace(',', '.')) || 0;
  const unit = match[2];
  const seconds: Record<string, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000,
  };
  return Date.now() - amount * (seconds[unit] ?? 1) * 1000;
}

function thumbnailsOf(value: any): string {
  const sources =
    value?.contentImage?.thumbnailViewModel?.image?.sources ??
    value?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail
      ?.thumbnailViewModel?.image?.sources;
  if (Array.isArray(sources) && sources.length) {
    return String(sources[sources.length - 1]?.url ?? '');
  }
  const thumbs = value?.thumbnail?.thumbnails;
  if (Array.isArray(thumbs) && thumbs.length) {
    return String(thumbs[thumbs.length - 1]?.url ?? '');
  }
  return '';
}

function durationOf(value: any): number | undefined {
  const badges =
    value?.contentImage?.thumbnailViewModel?.overlays?.flatMap(
      (overlay: any) => overlay?.thumbnailBottomOverlayViewModel?.badges ?? []
    ) ?? [];
  for (const badge of badges) {
    const text = badge?.thumbnailBadgeViewModel?.text;
    if (typeof text === 'string') {
      const parts = text.split(':').map(Number);
      if (parts.every((part: number) => Number.isFinite(part))) {
        return parts.reduce((total: number, part: number) => total * 60 + part, 0);
      }
    }
  }
  const length = textOf(value?.lengthText);
  if (length) {
    const parts = length.split(':').map(Number);
    if (parts.every((part) => Number.isFinite(part))) {
      return parts.reduce((total, part) => total * 60 + part, 0);
    }
  }
  return undefined;
}

function viewCountOf(value: any): number | undefined {
  const candidates = [
    textOf(value?.viewCountText),
    textOf(value?.shortViewCountText),
    ...(value?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel
      ?.metadataRows ?? []).flatMap((row: any) =>
      (row?.metadataParts ?? []).map((part: any) => textOf(part?.text))
    ),
  ].filter(Boolean);
  for (const text of candidates) {
    if (!/(view|观看|播放)/i.test(text)) continue;
    const normalized = text.replace(/,/g, '');
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*(万|亿|千|[KMB])?/i);
    const number = Number(match?.[1] ?? 0);
    if (!number) continue;
    const suffix = (match?.[2] ?? '').toUpperCase();
    if (suffix === '万') return Math.round(number * 10000);
    if (suffix === '亿') return Math.round(number * 100000000);
    if (suffix === '千') return Math.round(number * 1000);
    if (suffix === 'K') return Math.round(number * 1000);
    if (suffix === 'M') return Math.round(number * 1000000);
    if (suffix === 'B') return Math.round(number * 1000000000);
    return Math.round(number);
  }
  return undefined;
}

function publishedOf(value: any): number {
  const rows =
    value?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel
      ?.metadataRows ?? [];
  const parts = rows.flatMap((row: any) => row?.metadataParts ?? []);
  for (const part of parts) {
    const text = textOf(part?.text);
    if (/(ago|前)$/i.test(text)) return relativeMs(text);
  }
  const published = textOf(value?.publishedTimeText);
  return published ? relativeMs(published) : Date.now();
}

function parsePage(
  data: any,
  channelId: string,
  channelTitle: string,
  channelAvatar?: string,
  sortByPublished = true
): ChannelVideoPage {
  const items: VideoItem[] = [];
  const seen = new Set<string>();

  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const lockup = node.lockupViewModel;
    if (lockup && typeof lockup.contentId === 'string') {
      const videoId = lockup.contentId;
      if (videoId && !seen.has(videoId)) {
        seen.add(videoId);
        const title =
          textOf(lockup.metadata?.lockupMetadataViewModel?.title) || 'Untitled';
        items.push({
          videoId,
          title,
          channelId,
          channelTitle,
          channelAvatar,
          published: publishedOf(lockup),
          thumbnail:
            thumbnailsOf(lockup) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          duration: durationOf(lockup),
          viewCount: viewCountOf(lockup),
          isShort: false,
        });
      }
    }
    const video = node.videoRenderer;
    if (video && typeof video.videoId === 'string') {
      const videoId = video.videoId;
      if (!seen.has(videoId)) {
        seen.add(videoId);
        items.push({
          videoId,
          title: textOf(video.title) || 'Untitled',
          channelId,
          channelTitle,
          channelAvatar,
          published: publishedOf(video),
          thumbnail:
            thumbnailsOf(video) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          duration: durationOf(video),
          viewCount: viewCountOf(video),
          isShort: false,
        });
      }
    }
    const playlistVideo = node.playlistVideoRenderer;
    if (playlistVideo && typeof playlistVideo.videoId === 'string') {
      const videoId = playlistVideo.videoId;
      if (!seen.has(videoId)) {
        seen.add(videoId);
        const byline = playlistVideo.shortBylineText?.runs?.[0];
        items.push({
          videoId,
          title: textOf(playlistVideo.title) || 'Untitled',
          channelId:
            byline?.navigationEndpoint?.browseEndpoint?.browseId || channelId,
          channelTitle: byline?.text || channelTitle,
          channelAvatar,
          published: publishedOf(playlistVideo),
          thumbnail:
            thumbnailsOf(playlistVideo) ||
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          duration:
            durationOf(playlistVideo) ||
            durationFromText(textOf(playlistVideo.lengthText)),
          viewCount: viewCountOf(playlistVideo),
          isShort: false,
        });
      }
    }
    for (const key of Object.keys(node)) {
      if (
        key === 'lockupViewModel' ||
        key === 'videoRenderer' ||
        key === 'playlistVideoRenderer' ||
        key === 'continuationCommand'
      ) {
        continue;
      }
      visit(node[key]);
    }
  };
  visit(data);

  return {
    items: sortByPublished
      ? items.sort((a, b) => b.published - a.published)
      : items,
    continuation: chooseContinuationToken(data),
    channelInfo: parseChannelInfo(data),
  };
}

export async function fetchChannelVideosPage(
  channelId: string,
  options: {
    continuation?: string;
    channelTitle?: string;
    channelAvatar?: string;
    force?: boolean;
    timeoutMs?: number;
  } = {}
): Promise<ChannelVideoPage> {
  const {
    continuation,
    channelTitle = 'YouTube',
    channelAvatar,
    timeoutMs = 20000,
  } = options;
  const cacheKey = pageCacheKey(channelId, continuation);
  const cached = pageCache.get(cacheKey);
  if (!options.force && cached && Date.now() - cached.at < PAGE_TTL) {
    return cached.page;
  }

  const body: Record<string, unknown> = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20260101.00.00',
        hl: 'en',
        gl: 'US',
      },
    },
  };
  if (continuation) body.continuation = continuation;
  else {
    body.browseId = channelId;
    body.params = VIDEOS_TAB;
  }

  const data = await httpJson(BROWSE_URL, {
    method: 'POST',
    timeoutMs,
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type': 'application/json',
      Origin: 'https://www.youtube.com',
      Referer: `https://www.youtube.com/channel/${channelId}/videos`,
    },
    body,
  });
  const page = parsePage(data, channelId, channelTitle, channelAvatar);
  pageCache.set(cacheKey, { at: Date.now(), page });
  return page;
}

export async function fetchPlaylistVideosPage(
  playlistId: string,
  options: {
    continuation?: string;
    channelId?: string;
    channelTitle?: string;
    channelAvatar?: string;
  } = {}
): Promise<ChannelVideoPage> {
  const {
    continuation,
    channelId = '',
    channelTitle = 'YouTube',
    channelAvatar,
  } = options;
  const body: Record<string, unknown> = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20260101.00.00',
        hl: 'en',
        gl: 'US',
      },
    },
  };
  if (continuation) body.continuation = continuation;
  else body.browseId = `VL${playlistId}`;

  const data = await httpJson(BROWSE_URL, {
    method: 'POST',
    timeoutMs: 20000,
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type': 'application/json',
      Origin: 'https://www.youtube.com',
      Referer: `https://www.youtube.com/playlist?list=${playlistId}`,
    },
    body,
  });
  return parsePage(data, channelId, channelTitle, channelAvatar, false);
}

function parsePlaylistsPage(data: any): {
  items: ChannelPlaylist[];
  continuation?: string;
} {
  const items: ChannelPlaylist[] = [];
  const seen = new Set<string>();

  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const lockup = node.lockupViewModel;
    if (lockup && typeof lockup.contentId === 'string' && !seen.has(lockup.contentId)) {
      const id = String(lockup.contentId);
      if (id && !id.startsWith('UC')) {
        seen.add(id);
        const title =
          textOf(lockup.metadata?.lockupMetadataViewModel?.title) || '播放列表';
        const rows =
          lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel
            ?.metadataRows ?? [];
        const badgeText =
          lockup.contentImage?.collectionThumbnailViewModel?.primaryThumbnail
            ?.thumbnailViewModel?.overlays
            ?.flatMap(
              (overlay: any) =>
                overlay?.thumbnailOverlayBadgeViewModel?.thumbnailBadges ?? []
            )
            ?.map((badge: any) => textOf(badge?.thumbnailBadgeViewModel?.text))
            ?.find((text: string) => /(video|视频)/i.test(text)) ?? '';
        const countText =
          rows
            .flatMap((row: any) => row?.metadataParts ?? [])
            .map((part: any) => textOf(part?.text))
            .find((text: string) => /(video|视频)/i.test(text)) ??
          badgeText;
        const count = parseCountLabel(countText);
        items.push({
          playlistId: id,
          title,
          thumbnail: thumbnailsOf(lockup),
          videoCount: count,
        });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'lockupViewModel' || key === 'continuationCommand') continue;
      visit(node[key]);
    }
  };
  visit(data);
  return {
    items,
    continuation: chooseContinuationToken(data),
  };
}

export async function fetchChannelPlaylistsPage(
  channelId: string,
  options: { continuation?: string; force?: boolean } = {}
): Promise<{ items: ChannelPlaylist[]; continuation?: string }> {
  const body: Record<string, unknown> = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20260101.00.00',
        hl: 'en',
        gl: 'US',
      },
    },
  };
  if (options.continuation) body.continuation = options.continuation;
  else {
    body.browseId = channelId;
    body.params = PLAYLISTS_TAB;
  }
  const data = await httpJson(BROWSE_URL, {
    method: 'POST',
    timeoutMs: 20000,
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type': 'application/json',
      Origin: 'https://www.youtube.com',
      Referer: `https://www.youtube.com/channel/${channelId}/playlists`,
    },
    body,
  });
  return parsePlaylistsPage(data);
}

export function clearChannelVideoCache() {
  pageCache.clear();
}
