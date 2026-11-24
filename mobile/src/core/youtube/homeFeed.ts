import { loadJson, removeKey, saveJson } from '../storage';
import { Subscription, VideoItem } from '../types';
import {
  fetchChannelVideosPage,
  ChannelVideoPage,
} from './channelVideos';
import {
  CHANNEL_BATCH_SIZE,
  FEED_STORE_TTL,
  HOME_CONCURRENCY,
  HOME_FIRST_BATCH,
  HOME_POOL_CACHE_KEY,
  HOME_POOL_LIMIT,
  HOME_REQUEST_TIMEOUT_MS,
} from './constants';
import { fetchChannelFeed } from './rss';

export type HomeChannelPage = ChannelVideoPage & {
  channelId: string;
  channelTitle: string;
  channelAvatar?: string;
  source: 'innertube' | 'rss';
};

export type HomeFeedBatch = {
  items: VideoItem[];
  pages: HomeChannelPage[];
  done: number;
  total: number;
};

export type HomeFeedOptions = {
  force?: boolean;
  onBatch?: (batch: HomeFeedBatch) => void;
  timeoutMs?: number;
  concurrency?: number;
  batchSize?: number;
};

export type HomeFeedResult = {
  items: VideoItem[];
  pages: HomeChannelPage[];
};

export type HomeCursorSnapshot = {
  continuation?: string;
  exhausted: boolean;
  firstPageLoaded: boolean;
};

export type HomePoolCache = {
  at: number;
  updatedAt: number;
  items: VideoItem[];
  cursors?: Record<string, HomeCursorSnapshot>;
};

function uniqueSorted(items: VideoItem[]): VideoItem[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (!item.videoId || seen.has(item.videoId)) return false;
      seen.add(item.videoId);
      return true;
    })
    .sort((a, b) => b.published - a.published);
}

async function loadHomeChannelPage(
  sub: Subscription,
  options: Required<Pick<HomeFeedOptions, 'force' | 'timeoutMs'>>
): Promise<HomeChannelPage> {
  try {
    const page = await fetchChannelVideosPage(sub.channelId, {
      channelTitle: sub.title,
      channelAvatar: sub.avatar,
      force: options.force,
      timeoutMs: options.timeoutMs,
    });
    return {
      channelId: sub.channelId,
      channelTitle: sub.title,
      channelAvatar: sub.avatar,
      source: 'innertube',
      items: page.items.slice(0, CHANNEL_BATCH_SIZE),
      continuation: page.continuation,
    };
  } catch {
    // RSS has no continuation and normally returns about fifteen entries.
    // Never request it twice just to fill the twenty-item budget.
    const items = await fetchChannelFeed(
      sub.channelId,
      options.force,
      options.timeoutMs
    );
    return {
      channelId: sub.channelId,
      channelTitle: sub.title,
      channelAvatar: sub.avatar,
      source: 'rss',
      items: items.slice(0, CHANNEL_BATCH_SIZE),
    };
  }
}

/**
 * Fetch one channel page per subscription with bounded concurrency and
 * stream a batch every HOME_FIRST_BATCH completed channels. The callback
 * receives only new pages, so callers can merge without re-sorting everything.
 */
export async function fetchHomeFeed(
  subscriptions: Subscription[],
  options: HomeFeedOptions = {}
): Promise<HomeFeedResult> {
  const total = subscriptions.length;
  if (!total) return { items: [], pages: [] };

  const force = options.force ?? false;
  const timeoutMs = options.timeoutMs ?? HOME_REQUEST_TIMEOUT_MS;
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? HOME_CONCURRENCY, total)
  );
  const batchSize = Math.max(1, options.batchSize ?? HOME_FIRST_BATCH);
  const pages: HomeChannelPage[] = [];
  let done = 0;
  let pending: HomeChannelPage[] = [];

  const flush = (final = false) => {
    if (!pending.length) return;
    const batchPages = pending;
    pending = [];
    options.onBatch?.({
      items: uniqueSorted(batchPages.flatMap((page) => page.items)),
      pages: batchPages,
      done,
      total,
    });
  };

  const runPool = async (
    list: Subscription[],
    workerCount: number,
    flushEvery: number
  ) => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        const sub = list[cursor];
        cursor += 1;
        try {
          const page = await loadHomeChannelPage(sub, { force, timeoutMs });
          pages.push(page);
          pending.push(page);
        } catch {
          // A single dead channel must not block the rest of the home feed.
        }
        done += 1;
        if (flushEvery > 0 && done % flushEvery === 0) flush();
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(workerCount, list.length) }, worker)
    );
  };

  // The first screen must wait only for the first HOME_FIRST_BATCH channels.
  // Do not refill the pool with channel 9 before channel 8 has settled.
  const first = subscriptions.slice(0, batchSize);
  await runPool(first, Math.min(concurrency, first.length), 0);
  flush();
  if (done >= total) {
    flush(true);
    return {
      items: uniqueSorted(pages.flatMap((page) => page.items)).slice(
        0,
        HOME_POOL_LIMIT
      ),
      pages,
    };
  }

  const rest = subscriptions.slice(batchSize);
  await runPool(rest, Math.min(concurrency, rest.length), batchSize);
  flush(true);

  return {
    items: uniqueSorted(pages.flatMap((page) => page.items)).slice(
      0,
      HOME_POOL_LIMIT
    ),
    pages,
  };
}

export async function loadHomePoolCache(): Promise<HomePoolCache | null> {
  const cache = await loadJson<HomePoolCache | null>(HOME_POOL_CACHE_KEY, null);
  if (!cache?.at || !Array.isArray(cache.items)) return null;
  if (Date.now() - cache.at > FEED_STORE_TTL) {
    void removeKey(HOME_POOL_CACHE_KEY);
    return null;
  }
  return cache;
}

export async function saveHomePoolCache(
  items: VideoItem[],
  updatedAt: number,
  cursors?: Record<string, HomeCursorSnapshot>,
  at = Date.now()
): Promise<void> {
  await saveJson(HOME_POOL_CACHE_KEY, {
    at,
    updatedAt,
    items,
    ...(cursors && Object.keys(cursors).length ? { cursors } : {}),
  } satisfies HomePoolCache);
}
