import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { mergeHomePool } from '../core/feedBatches';
import {
  hasMoreFeed,
  isChannelExhausted,
  shouldTranslateTitles,
} from '../core/feedPolicy';
import { translateTitles } from '../core/translate';
import { useAppStore } from '../core/store';
import { Subscription, VideoItem } from '../core/types';
import {
  fetchChannelVideosPage,
} from '../core/youtube/channelVideos';
import {
  CHANNEL_BATCH_SIZE,
  FEED_FRESH_TTL,
  HOME_CONCURRENCY,
  HOME_POOL_LIMIT,
  HOME_REQUEST_TIMEOUT_MS,
} from '../core/youtube/constants';
import {
  fetchHomeFeed,
  HomeCursorSnapshot,
  HomeFeedBatch,
  loadHomePoolCache,
  saveHomePoolCache,
} from '../core/youtube/homeFeed';
import { useChannelFeed } from './useChannelFeed';

const HOME_PAGE_SIZE = 12;
const NEXT_PAGE_SIZE = 10;

type ChannelCursor = {
  channelId: string;
  title: string;
  avatar?: string;
  continuation?: string;
  exhausted: boolean;
  firstPageLoaded: boolean;
  lastFetchAt: number;
};

function titleScopeOf(settings: {
  translateTitles: boolean;
  titleTranslationMode: string;
  provider: string;
  sourceLang: string;
  targetLang: string;
  deepseekModel: string;
  deepseekThinking?: boolean;
  siliconflowModel: string;
  openrouterModel: string;
  openaiBaseUrl: string;
  openaiModel: string;
  autoFreeOrder?: string[];
  autoPaidOrder?: string[];
}): string {
  return JSON.stringify([
    settings.translateTitles,
    settings.titleTranslationMode,
    settings.provider,
    settings.sourceLang,
    settings.targetLang,
    settings.deepseekModel,
    settings.deepseekThinking ?? false,
    settings.siliconflowModel,
    settings.openrouterModel,
    settings.openaiBaseUrl,
    settings.openaiModel,
    settings.autoFreeOrder ?? [],
    settings.autoPaidOrder ?? [],
  ]);
}

function carryTranslations(
  items: VideoItem[],
  previous: VideoItem[]
): VideoItem[] {
  const byId = new Map(
    previous
      .filter((item) => item.translatedTitle)
      .map((item) => [item.videoId, item.translatedTitle])
  );
  return items.map((item) => ({
    ...item,
    translatedTitle: byId.get(item.videoId) ?? item.translatedTitle,
  }));
}

export function useFeed(channelFilter = '') {
  const subscriptions = useAppStore((state) => state.subscriptions);
  const titleTranslationScope = useAppStore((state) => titleScopeOf(state.settings));
  const [pool, setPool] = useState<VideoItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(HOME_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);

  const requestRef = useRef(0);
  const poolRef = useRef<VideoItem[]>([]);
  const visibleRef = useRef(HOME_PAGE_SIZE);
  const cursorsRef = useRef<Map<string, ChannelCursor>>(new Map());
  const moreLock = useRef(false);
  const translatedTitles = useRef(new Set<string>());
  const updatedAtRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filterSub = channelFilter
    ? subscriptions.find((sub) => sub.channelId === channelFilter)
    : undefined;
  const channelFeed = useChannelFeed(channelFilter, {
    channelTitle: filterSub?.title,
    channelAvatar: filterSub?.avatar,
    enabled: Boolean(channelFilter),
  });

  const subsKey = subscriptions.map((sub) => sub.channelId).sort().join(',');

  const setPoolSafe = (items: VideoItem[]) => {
    poolRef.current = items;
    setPool(items);
  };

  const rememberCursor = (sub: Subscription) => {
    const old = cursorsRef.current.get(sub.channelId);
    if (old) {
      old.title = sub.title;
      old.avatar = sub.avatar;
      return old;
    }
    const cursor: ChannelCursor = {
      channelId: sub.channelId,
      title: sub.title,
      avatar: sub.avatar,
      exhausted: false,
      firstPageLoaded: false,
      lastFetchAt: 0,
    };
    cursorsRef.current.set(sub.channelId, cursor);
    return cursor;
  };

  const cursorSnapshot = (): Record<string, HomeCursorSnapshot> => {
    const snapshot: Record<string, HomeCursorSnapshot> = {};
    for (const [channelId, cursor] of cursorsRef.current) {
      snapshot[channelId] = {
        continuation: cursor.continuation,
        exhausted: cursor.exhausted,
        firstPageLoaded: cursor.firstPageLoaded,
      };
    }
    return snapshot;
  };

  const scheduleCacheSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void saveHomePoolCache(
        poolRef.current.slice(0, HOME_POOL_LIMIT),
        updatedAtRef.current,
        cursorSnapshot(),
        updatedAtRef.current || Date.now()
      );
    }, 300);
  }, []);

  const enrich = (items: VideoItem[]): VideoItem[] => {
    const avatarMap = new Map(
      useAppStore.getState().subscriptions.map((sub) => [sub.channelId, sub.avatar])
    );
    return items.map((item) => ({
      ...item,
      channelAvatar: item.channelAvatar ?? avatarMap.get(item.channelId),
    }));
  };

  const computeHasMore = () => {
    const subs = useAppStore.getState().subscriptions;
    return hasMoreFeed({
      visibleCount: visibleRef.current,
      poolLength: poolRef.current.length,
      poolLimit: HOME_POOL_LIMIT,
      hasLiveChannel: subs.some((sub) => {
        const cursor = cursorsRef.current.get(sub.channelId);
        return !cursor || !cursor.exhausted;
      }),
    });
  };

  const translateVisibleTitles = async (items: VideoItem[], requestId: number) => {
    const settingsAtStart = useAppStore.getState().settings;
    if (!shouldTranslateTitles(settingsAtStart)) return;
    const scopeAtStart = titleScopeOf(settingsAtStart);
    const missing = Array.from(
      new Set(
        items
          .filter((item) => !item.translatedTitle && !translatedTitles.current.has(item.title))
          .map((item) => item.title)
      )
    ).slice(0, 80);
    if (!missing.length) return;
    try {
      const translated = await translateTitles(missing);
      const latest = useAppStore.getState().settings;
      if (
        requestId !== requestRef.current ||
        !shouldTranslateTitles(latest) ||
        scopeAtStart !== titleScopeOf(latest)
      ) {
        return;
      }
      missing.forEach((title) => translatedTitles.current.add(title));
      const map = new Map(missing.map((title, index) => [title, translated[index]]));
      setPoolSafe(
        poolRef.current.map((item) => ({
          ...item,
          translatedTitle: map.get(item.title) ?? item.translatedTitle,
        }))
      );
    } catch {
      // Title translation failure must never hide the feed.
    }
  };

  const applyHomeBatch = (batch: HomeFeedBatch, requestId: number) => {
    if (requestId !== requestRef.current) return;
    const merged = mergeHomePool(
      poolRef.current,
      enrich(batch.items),
      HOME_POOL_LIMIT
    );
    setPoolSafe(merged);
    const nextVisible = Math.max(
      visibleRef.current,
      Math.min(HOME_PAGE_SIZE, merged.length)
    );
    visibleRef.current = nextVisible;
    setVisibleCount(nextVisible);
    const stamp = Date.now();
    updatedAtRef.current = stamp;
    setUpdatedAt(stamp);
    setLoading(false);

    for (const page of batch.pages) {
      cursorsRef.current.set(page.channelId, {
        channelId: page.channelId,
        title: page.channelTitle,
        avatar: page.channelAvatar,
        continuation: page.continuation,
        // RSS has no continuation, but keep the channel live so a later
        // scroll retries innertube instead of ending at ~12 RSS items.
        exhausted: isChannelExhausted(page.source, page.continuation),
        firstPageLoaded: true,
        lastFetchAt: Date.now(),
      });
    }
    scheduleCacheSave();
    void translateVisibleTitles(merged.slice(0, nextVisible), requestId);
  };

  const load = useCallback(
    async (force = false) => {
      if (channelFilter) return;
      const subs = useAppStore.getState().subscriptions;
      const requestId = ++requestRef.current;
      moreLock.current = false;
      setLoadingMore(false);
      translatedTitles.current = new Set();

      if (!subs.length) {
        setPoolSafe([]);
        visibleRef.current = 0;
        setVisibleCount(0);
        setLoading(false);
        setRefreshing(false);
        setHasMore(false);
        updatedAtRef.current = 0;
        setUpdatedAt(0);
        scheduleCacheSave();
        return;
      }

      if (force) setRefreshing(true);
      else if (!poolRef.current.length) setLoading(true);

      const cached = await loadHomePoolCache();
      if (requestId !== requestRef.current) return;

      const currentIds = new Set(subs.map((sub) => sub.channelId));
      const cachedItems = cached?.items
        ? cached.items.filter((item) => currentIds.has(item.channelId))
        : [];
      const currentPool = poolRef.current.filter((item) =>
        currentIds.has(item.channelId)
      );

      let baseItems = mergeHomePool(
        currentPool,
        cachedItems,
        HOME_POOL_LIMIT
      );
      if (baseItems.length) {
        setPoolSafe(baseItems);
        const nextVisible = Math.min(
          Math.max(visibleRef.current, HOME_PAGE_SIZE),
          baseItems.length
        );
        visibleRef.current = nextVisible;
        setVisibleCount(nextVisible);
        setLoading(false);
        if (cachedItems.length) {
          const stamp = cached?.at || Date.now();
          updatedAtRef.current = stamp;
          setUpdatedAt(stamp);
        }
        void translateVisibleTitles(baseItems.slice(0, nextVisible), requestId);
      }

      cursorsRef.current = new Map();
      if (cached?.cursors) {
        for (const sub of subs) {
          const snapshot = cached.cursors[sub.channelId];
          if (!snapshot) continue;
          cursorsRef.current.set(sub.channelId, {
            channelId: sub.channelId,
            title: sub.title,
            avatar: sub.avatar,
            continuation: snapshot.continuation,
            // Never trust a persisted "exhausted" flag: earlier builds could
            // stop pagination after a transient failure. Retry once; a real
            // end is re-marked after the next request.
            exhausted: false,
            firstPageLoaded: snapshot.firstPageLoaded,
            lastFetchAt: 0,
          });
        }
      }
      for (const item of baseItems) {
        const sub = subs.find((entry) => entry.channelId === item.channelId);
        if (sub) rememberCursor(sub);
      }

      const knownIds = new Set<string>([
        ...baseItems.map((item) => item.channelId),
        ...cursorsRef.current.keys(),
      ]);
      const newSubs = subs.filter((sub) => !knownIds.has(sub.channelId));
      const cacheAge = cached ? Date.now() - cached.at : Number.POSITIVE_INFINITY;

      let targets: Subscription[] = [];
      if (force) targets = subs;
      else if (newSubs.length) targets = newSubs;
      else if (!baseItems.length || cacheAge > FEED_FRESH_TTL) targets = subs;

      if (!targets.length) {
        setHasMore(computeHasMore());
        setLoading(false);
        setRefreshing(false);
        scheduleCacheSave();
        return;
      }

      if (!baseItems.length) setLoading(true);
      setHasMore(true);

      try {
        const result = await fetchHomeFeed(targets, {
          force,
          onBatch: (batch) => applyHomeBatch(batch, requestId),
        });
        if (requestId !== requestRef.current) return;

        const fullRefresh = force || targets.length === subs.length;
        if (fullRefresh) {
          const refreshedIds = new Set(result.pages.map((page) => page.channelId));
          const previousChannelsToKeep = poolRef.current.filter(
            (item) => !refreshedIds.has(item.channelId)
          );
          const fresh = carryTranslations(
            mergeHomePool(
              [],
              [...enrich(result.items), ...previousChannelsToKeep],
              HOME_POOL_LIMIT
            ),
            poolRef.current
          );
          if (fresh.length) {
            setPoolSafe(fresh);
            visibleRef.current = Math.min(
              Math.max(visibleRef.current, HOME_PAGE_SIZE),
              fresh.length
            );
            setVisibleCount(visibleRef.current);
            if (result.pages.length) {
              const stamp = Date.now();
              updatedAtRef.current = stamp;
              setUpdatedAt(stamp);
            }
          }
          for (const page of result.pages) {
            cursorsRef.current.set(page.channelId, {
              channelId: page.channelId,
              title: page.channelTitle,
              avatar: page.channelAvatar,
              continuation: page.continuation,
              // A timeout fallback to RSS must not permanently exhaust the
              // channel; the next scroll should try innertube again.
              exhausted: isChannelExhausted(page.source, page.continuation),
              firstPageLoaded: true,
              lastFetchAt: Date.now(),
            });
          }
        } else if (result.items.length) {
          const merged = mergeHomePool(
            poolRef.current,
            enrich(result.items),
            HOME_POOL_LIMIT
          );
          setPoolSafe(merged);
          visibleRef.current = Math.min(
            Math.max(visibleRef.current, HOME_PAGE_SIZE),
            merged.length
          );
          setVisibleCount(visibleRef.current);
          const stamp = Date.now();
          updatedAtRef.current = stamp;
          setUpdatedAt(stamp);
        }

        setHasMore(computeHasMore());
        scheduleCacheSave();
      } catch {
        if (requestId !== requestRef.current) return;
        if (!poolRef.current.length) {
          setHasMore(false);
        } else {
          setHasMore(computeHasMore());
        }
      } finally {
        if (requestId === requestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [channelFilter, scheduleCacheSave]
  );

  useEffect(() => {
    if (channelFilter) {
      requestRef.current += 1;
      return;
    }
    void load(false);
    return () => {
      requestRef.current += 1;
    };
  }, [subsKey, channelFilter, load]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (channelFilter) {
      await channelFeed.loadMore();
      return;
    }
    if (moreLock.current || loading || refreshing || !hasMore) return;

    if (visibleRef.current < poolRef.current.length) {
      const next = Math.min(
        poolRef.current.length,
        visibleRef.current + NEXT_PAGE_SIZE
      );
      visibleRef.current = next;
      setVisibleCount(next);
      setHasMore(computeHasMore());
      void translateVisibleTitles(poolRef.current.slice(0, next), requestRef.current);
      return;
    }

    moreLock.current = true;
    setLoadingMore(true);
    const requestId = requestRef.current;
    try {
      const selected = useAppStore.getState().subscriptions;
      const live = selected
        .filter((sub) => {
          const cursor = cursorsRef.current.get(sub.channelId);
          return !cursor || !cursor.exhausted;
        })
        .sort((a, b) => {
          const aCursor = cursorsRef.current.get(a.channelId);
          const bCursor = cursorsRef.current.get(b.channelId);
          // First pass: channels whose first page has never been loaded.
          // After that: least recently fetched, so no channel starves.
          const aLoaded = aCursor?.firstPageLoaded ? 1 : 0;
          const bLoaded = bCursor?.firstPageLoaded ? 1 : 0;
          if (aLoaded !== bLoaded) return aLoaded - bLoaded;
          return (aCursor?.lastFetchAt ?? 0) - (bCursor?.lastFetchAt ?? 0);
        })
        .slice(0, HOME_CONCURRENCY);
      if (!live.length) {
        setHasMore(computeHasMore());
        return;
      }

      const results = await Promise.allSettled(
        live.map(async (sub) => {
          const cursor = rememberCursor(sub);
          const page = await fetchChannelVideosPage(sub.channelId, {
            continuation: cursor.firstPageLoaded
              ? cursor.continuation
              : undefined,
            channelTitle: sub.title,
            channelAvatar: sub.avatar,
            timeoutMs: HOME_REQUEST_TIMEOUT_MS,
          });
          if (requestId !== requestRef.current) return null;
          cursor.firstPageLoaded = true;
          cursor.continuation = page.continuation;
          // fetchChannelVideosPage only returns innertube pages here; a
          // failure is caught below and leaves the cursor retryable.
          cursor.exhausted = !page.continuation;
          cursor.lastFetchAt = Date.now();
          return page;
        })
      );
      if (requestId !== requestRef.current) return;

      const fresh = results.flatMap((result) =>
        result.status === 'fulfilled' && result.value
          ? result.value.items.slice(0, CHANNEL_BATCH_SIZE)
          : []
      );
      if (fresh.length) {
        const before = poolRef.current.length;
        const merged = mergeHomePool(
          poolRef.current,
          enrich(fresh),
          HOME_POOL_LIMIT
        );
        if (merged.length > before) {
          setPoolSafe(merged);
          const next = Math.min(
            merged.length,
            visibleRef.current + NEXT_PAGE_SIZE
          );
          visibleRef.current = next;
          setVisibleCount(next);
          const stamp = Date.now();
          updatedAtRef.current = stamp;
          setUpdatedAt(stamp);
          scheduleCacheSave();
          void translateVisibleTitles(merged.slice(0, next), requestId);
        }
      }

      // Keep pagination alive while any channel still has a cursor. A
      // transient failure should be retryable by the next upward scroll.
      setHasMore(computeHasMore());
    } finally {
      moreLock.current = false;
      if (requestId === requestRef.current) {
        setLoadingMore(false);
      }
    }
  }, [
    channelFeed,
    channelFilter,
    hasMore,
    loading,
    refreshing,
    scheduleCacheSave,
  ]);

  const homeRefresh = useCallback(() => load(true), [load]);
  const refreshWithResult = useCallback(async (): Promise<{ added: number }> => {
    if (channelFilter) {
      return (await channelFeed.refresh()) ?? { added: 0 };
    }
    const beforeIds = new Set(poolRef.current.map((item) => item.videoId));
    await homeRefresh();
    let added = 0;
    for (const item of poolRef.current) {
      if (!beforeIds.has(item.videoId)) added += 1;
    }
    return { added };
  }, [channelFeed, channelFilter, homeRefresh]);
  const refresh = useCallback(async () => {
    await refreshWithResult();
  }, [refreshWithResult]);

  const items = useMemo(() => {
    const avatarMap = new Map(
      subscriptions.map((sub) => [sub.channelId, sub.avatar])
    );
    return pool.slice(0, visibleCount).map((item) => ({
      ...item,
      channelAvatar: item.channelAvatar ?? avatarMap.get(item.channelId),
    }));
  }, [pool, visibleCount, subscriptions]);

  useEffect(() => {
    translatedTitles.current = new Set();
    const originals = poolRef.current.map((item) => ({
      ...item,
      translatedTitle: undefined,
    }));
    if (originals.length) setPoolSafe(originals);
    if (
      originals.length &&
      shouldTranslateTitles(useAppStore.getState().settings)
    ) {
      void translateVisibleTitles(
        originals.slice(0, visibleRef.current),
        requestRef.current
      );
    }
    // A settings-scope change invalidates both in-flight and cached titles.
    // translateVisibleTitles is intentionally read from the current render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleTranslationScope]);

  if (channelFilter) {
    return {
      items: channelFeed.items,
      loading: channelFeed.loading,
      refreshing: channelFeed.refreshing,
      loadingMore: channelFeed.loadingMore,
      hasMore: channelFeed.hasMore,
      total: channelFeed.items.length,
      updatedAt: 0,
      refresh,
      refreshWithResult,
      loadMore,
    };
  }

  return {
    items,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    total: pool.length,
    updatedAt,
    refresh,
    refreshWithResult,
    loadMore,
  };
}
