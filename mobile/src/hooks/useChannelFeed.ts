import { useCallback, useEffect, useRef, useState } from 'react';

import { mergeChannelItems, takeChannelBatch, uniqueVideoItems } from '../core/feedBatches';
import { VideoItem } from '../core/types';
import {
  fetchChannelVideosPage,
  loadChannelFirstPage,
  peekChannelVideoPage,
  saveChannelFirstPage,
} from '../core/youtube/channelVideos';
import { CHANNEL_BATCH_SIZE } from '../core/youtube/constants';
import { fetchChannelFeed } from '../core/youtube/rss';

export type ChannelFeedOptions = {
  channelTitle?: string;
  channelAvatar?: string;
  enabled?: boolean;
};

type PrefetchedPage = {
  items: VideoItem[];
  continuation?: string;
};

function enrich(items: VideoItem[], avatar?: string): VideoItem[] {
  if (!avatar) return items;
  return items.map((item) => ({
    ...item,
    channelAvatar: item.channelAvatar ?? avatar,
  }));
}

/**
 * Shared channel timeline used by /channel and by the home channel filter.
 * The first page stays in a buffer; each loadMore exposes exactly one batch of
 * CHANNEL_BATCH_SIZE items and prefetches the next continuation in the
 * background.
 */
export function useChannelFeed(channelId: string, options: ChannelFeedOptions = {}) {
  const { channelTitle = 'YouTube', channelAvatar, enabled = true } = options;
  const [items, setItems] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  const itemsRef = useRef<VideoItem[]>([]);
  const bufferRef = useRef<VideoItem[]>([]);
  const continuationRef = useRef<string | undefined>(undefined);
  const prefetchedRef = useRef<PrefetchedPage | null>(null);
  const prefetchingRef = useRef(false);
  const prefetchPromiseRef = useRef<Promise<void> | null>(null);
  const moreLock = useRef(false);
  const generationRef = useRef(0);
  const refreshSeqRef = useRef(0);
  const activeChannelRef = useRef('');

  const applyItems = (next: VideoItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  const syncHasMore = () => {
    setHasMore(
      bufferRef.current.length > 0 ||
        !!continuationRef.current ||
        !!prefetchedRef.current?.items.length
    );
  };

  const reset = () => {
    itemsRef.current = [];
    bufferRef.current = [];
    continuationRef.current = undefined;
    prefetchedRef.current = null;
    prefetchingRef.current = false;
    prefetchPromiseRef.current = null;
    moreLock.current = false;
    setItems([]);
    setHasMore(false);
    setLoadingMore(false);
    setRefreshing(false);
    setError('');
  };

  const addToBuffer = (pageItems: VideoItem[]) => {
    const seen = new Set([
      ...itemsRef.current.map((item) => item.videoId),
      ...bufferRef.current.map((item) => item.videoId),
    ]);
    const fresh = pageItems.filter((item) => !seen.has(item.videoId));
    bufferRef.current = uniqueVideoItems([...bufferRef.current, ...fresh]);
  };

  const consumeBatch = () => {
    if (!bufferRef.current.length) return false;
    const { batch, rest } = takeChannelBatch(
      bufferRef.current,
      CHANNEL_BATCH_SIZE
    );
    bufferRef.current = rest;
    applyItems(mergeChannelItems(itemsRef.current, batch));
    syncHasMore();
    return true;
  };

  const applyFirstPage = (page: { items: VideoItem[]; continuation?: string }, preserveLoaded: boolean) => {
    const incoming = enrich(page.items, channelAvatar);
    const current = itemsRef.current;
    if (!incoming.length && current.length) {
      if (page.continuation !== undefined) continuationRef.current = page.continuation;
      return;
    }
    const merged = mergeChannelItems(current, incoming);
    // A background refresh must not shrink a list the user already scrolled
    // through; keep every loaded item and put newer uploads in front.
    if (preserveLoaded && current.length > CHANNEL_BATCH_SIZE) {
      applyItems(merged);
      bufferRef.current = [];
    } else {
      const { batch, rest } = takeChannelBatch(merged, CHANNEL_BATCH_SIZE);
      applyItems(batch);
      bufferRef.current = rest;
    }
    continuationRef.current = page.continuation;
    prefetchedRef.current = null;
    syncHasMore();
  };

  const applyRssFirstPage = (feed: VideoItem[]) => {
    if (itemsRef.current.length || !feed.length) return;
    const { batch, rest } = takeChannelBatch(enrich(feed, channelAvatar), CHANNEL_BATCH_SIZE);
    applyItems(batch);
    bufferRef.current = rest;
    continuationRef.current = undefined;
    syncHasMore();
  };

  const fetchContinuation = useCallback(
    async (token: string) => {
      return fetchChannelVideosPage(channelId, {
        continuation: token,
        channelTitle,
        channelAvatar,
      });
    },
    [channelAvatar, channelId, channelTitle]
  );

  const prefetchNext = useCallback(async () => {
    const token = continuationRef.current;
    if (!enabled || !token || prefetchingRef.current || prefetchedRef.current) return;
    const generation = generationRef.current;
    prefetchingRef.current = true;
    const task = (async () => {
      try {
        const page = await fetchContinuation(token);
        if (generation !== generationRef.current) return;
        const seen = new Set([
          ...itemsRef.current.map((item) => item.videoId),
          ...bufferRef.current.map((item) => item.videoId),
        ]);
        const fresh = enrich(page.items, channelAvatar).filter(
          (item) => !seen.has(item.videoId)
        );
        if (!fresh.length && !page.continuation) {
          continuationRef.current = undefined;
          syncHasMore();
          return;
        }
        prefetchedRef.current = { items: fresh, continuation: page.continuation };
      } catch {
        // Prefetch failure is silent. The same token is retried when the user
        // reaches the bottom of the list.
      } finally {
        if (generation === generationRef.current) {
          prefetchingRef.current = false;
          prefetchPromiseRef.current = null;
        }
      }
    })();
    prefetchPromiseRef.current = task;
    await task;
  }, [channelAvatar, enabled, fetchContinuation]);

  const backgroundRefresh = useCallback(
    async (generation: number) => {
      const refreshSeq = ++refreshSeqRef.current;
      try {
        const page = await fetchChannelVideosPage(channelId, {
          channelTitle,
          channelAvatar,
          force: true,
        });
        if (generation !== generationRef.current || refreshSeq !== refreshSeqRef.current) {
          return;
        }
        applyFirstPage(page, true);
        void saveChannelFirstPage(channelId, page);
        void prefetchNext();
      } catch {
        // The cached page already gave the user something usable.
      }
    },
    [channelAvatar, channelId, channelTitle, prefetchNext]
  );

  const loadInitial = useCallback(async () => {
    if (!enabled || !channelId) return;
    activeChannelRef.current = channelId;
    const generation = ++generationRef.current;
    reset();
    setLoading(true);
    const memory = peekChannelVideoPage(channelId);
    if (memory?.items.length) {
      applyFirstPage(memory, false);
      setLoading(false);
      void backgroundRefresh(generation);
      return;
    }

    const stored = await loadChannelFirstPage(channelId);
    if (generation !== generationRef.current) return;
    if (stored?.items.length) {
      applyFirstPage(stored, false);
      setLoading(false);
      void backgroundRefresh(generation);
      return;
    }

    let pageOk = false;
    let rssOk = false;
    const pageTask = (async () => {
      try {
        const page = await fetchChannelVideosPage(channelId, {
          channelTitle,
          channelAvatar,
        });
        pageOk = true;
        if (generation !== generationRef.current) return;
        applyFirstPage(page, false);
        setLoading(false);
        setError('');
        void saveChannelFirstPage(channelId, page);
        void prefetchNext();
      } catch {
        // RSS below may still satisfy the first paint.
      }
    })();

    const rssTask = (async () => {
      try {
        const feed = await fetchChannelFeed(channelId, false);
        rssOk = true;
        if (generation !== generationRef.current) return;
        applyRssFirstPage(feed);
        if (itemsRef.current.length) setLoading(false);
      } catch {
        // innertube remains the primary path.
      }
    })();

    await Promise.allSettled([pageTask, rssTask]);
    if (generation !== generationRef.current) return;
    setLoading(false);
    if (!pageOk && !rssOk && !itemsRef.current.length) {
      setError('频道视频加载失败，请稍后重试。');
    }
  }, [backgroundRefresh, channelAvatar, channelId, channelTitle, enabled, prefetchNext]);

  useEffect(() => {
    if (!enabled || !channelId) {
      generationRef.current += 1;
      activeChannelRef.current = '';
      reset();
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      return;
    }
    void loadInitial();
    return () => {
      generationRef.current += 1;
      moreLock.current = false;
    };
  }, [channelId, enabled, loadInitial]);

  const refresh = useCallback(async () => {
    if (!enabled || !channelId) return;
    const generation = generationRef.current;
    const refreshSeq = ++refreshSeqRef.current;
    setRefreshing(true);
    setError('');
    try {
      const page = await fetchChannelVideosPage(channelId, {
        channelTitle,
        channelAvatar,
        force: true,
      });
      if (generation !== generationRef.current || refreshSeq !== refreshSeqRef.current) {
        return;
      }
      if (page.items.length) {
        applyFirstPage(page, true);
        void saveChannelFirstPage(channelId, page);
        void prefetchNext();
      }
    } catch (reason) {
      if (generation === generationRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (generation === generationRef.current) setRefreshing(false);
    }
  }, [channelAvatar, channelId, channelTitle, enabled, prefetchNext]);

  const loadMore = useCallback(async () => {
    if (!enabled || moreLock.current || loading || loadingMore || !hasMore) return;
    moreLock.current = true;
    setLoadingMore(true);
    const generation = generationRef.current;
    try {
      // One batch is already buffered: no network request.
      if (bufferRef.current.length >= CHANNEL_BATCH_SIZE) {
        consumeBatch();
        if (continuationRef.current) void prefetchNext();
        return;
      }

      let filled = false;
      if (!prefetchedRef.current && prefetchPromiseRef.current) {
        await prefetchPromiseRef.current;
        if (generation !== generationRef.current) return;
      }
      if (prefetchedRef.current) {
        const page = prefetchedRef.current;
        prefetchedRef.current = null;
        addToBuffer(page.items);
        continuationRef.current = page.continuation;
        filled = true;
      } else if (continuationRef.current) {
        const token = continuationRef.current;
        try {
          const page = await fetchContinuation(token);
          if (generation !== generationRef.current) return;
          addToBuffer(enrich(page.items, channelAvatar));
          continuationRef.current = page.continuation;
          filled = true;
        } catch {
          // Keep the token; the next onEndReached retries it.
        }
      }

      if (filled) {
        consumeBatch();
        if (continuationRef.current) void prefetchNext();
      }
      if (
        !bufferRef.current.length &&
        !continuationRef.current &&
        !prefetchedRef.current
      ) {
        setHasMore(false);
      } else {
        syncHasMore();
      }
    } finally {
      if (generation === generationRef.current) {
        moreLock.current = false;
        setLoadingMore(false);
      }
    }
  }, [
    channelAvatar,
    enabled,
    fetchContinuation,
    hasMore,
    loading,
    loadingMore,
    prefetchNext,
  ]);

  const active = enabled && activeChannelRef.current === channelId;
  return {
    items: active ? items : [],
    loading: active ? loading : enabled,
    refreshing: active ? refreshing : false,
    loadingMore: active ? loadingMore : false,
    hasMore: active ? hasMore : false,
    error: active ? error : '',
    refresh,
    loadMore,
  };
}
