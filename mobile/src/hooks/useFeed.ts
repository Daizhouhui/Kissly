import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { translateTitles } from '../core/translate';
import { useAppStore } from '../core/store';
import { Subscription, VideoItem } from '../core/types';
import { fetchChannelVideosPage } from '../core/youtube/channelVideos';
import { fetchChannelFeed, fetchSubscriptionFeed } from '../core/youtube/rss';

const HOME_PAGE_SIZE = 12;
const NEXT_PAGE_SIZE = 10;

type ChannelCursor = {
  channelId: string;
  title: string;
  avatar?: string;
  continuation?: string;
  exhausted: boolean;
  firstPageLoaded: boolean;
};

function uniqueSorted(items: VideoItem[]): VideoItem[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.videoId)) return false;
      seen.add(item.videoId);
      return true;
    })
    .sort((a, b) => b.published - a.published);
}

export function useFeed(channelFilter = '') {
  const subscriptions = useAppStore((state) => state.subscriptions);
  const translateTitlesEnabled = useAppStore(
    (state) =>
      state.settings.translateTitles &&
      state.settings.titleTranslationMode !== 'none'
  );
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

  const subsKey = subscriptions.map((sub) => sub.channelId).sort().join(',');

  const setPoolSafe = (items: VideoItem[]) => {
    poolRef.current = items;
    setPool(items);
  };

  const rememberCursor = (sub: Subscription) => {
    const old = cursorsRef.current.get(sub.channelId);
    if (old) return old;
    const cursor: ChannelCursor = {
      channelId: sub.channelId,
      title: sub.title,
      avatar: sub.avatar,
      exhausted: false,
      firstPageLoaded: false,
    };
    cursorsRef.current.set(sub.channelId, cursor);
    return cursor;
  };

  const enrich = (items: VideoItem[]): VideoItem[] => {
    const avatarMap = new Map(subscriptions.map((sub) => [sub.channelId, sub.avatar]));
    return items.map((item) => ({
      ...item,
      channelAvatar: item.channelAvatar ?? avatarMap.get(item.channelId),
    }));
  };

  const translateVisibleTitles = async (items: VideoItem[], requestId: number) => {
    if (useAppStore.getState().settings.titleTranslationMode === 'none') return;
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
      if (requestId !== requestRef.current) return;
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

  const load = useCallback(
    async (force = false) => {
      const subs = useAppStore.getState().subscriptions;
      const selected = channelFilter
        ? subs.filter((sub) => sub.channelId === channelFilter)
        : subs;
      const requestId = ++requestRef.current;
      cursorsRef.current = new Map();
      translatedTitles.current = new Set();

      if (!selected.length) {
        setPoolSafe([]);
        setVisibleCount(0);
        visibleRef.current = 0;
        setLoading(false);
        setRefreshing(false);
        setHasMore(false);
        return;
      }

      if (force) setRefreshing(true);
      else setLoading(true);
      setHasMore(true);

      try {
        let initial: VideoItem[] = [];
        if (channelFilter) {
          const sub = selected[0];
          const cursor = rememberCursor(sub);
          try {
            const page = await fetchChannelVideosPage(sub.channelId, {
              channelTitle: sub.title,
              channelAvatar: sub.avatar,
              force,
            });
            initial = page.items;
            cursor.firstPageLoaded = true;
            cursor.continuation = page.continuation;
            cursor.exhausted = !page.continuation && page.items.length < 30;
          } catch {
            initial = await fetchChannelFeed(sub.channelId, force);
            cursor.firstPageLoaded = false;
          }
        } else {
          initial = await fetchSubscriptionFeed(selected, force);
          selected.forEach(rememberCursor);
        }

        if (requestId !== requestRef.current) return;
        const enriched = uniqueSorted(enrich(initial));
        const count = channelFilter ? 10 : HOME_PAGE_SIZE;
        setPoolSafe(enriched);
        visibleRef.current = Math.min(count, enriched.length);
        setVisibleCount(visibleRef.current);
        setHasMore(
          channelFilter
            ? !!cursorsRef.current.get(channelFilter)?.continuation ||
              enriched.length > visibleRef.current
            : selected.some((sub) => !cursorsRef.current.get(sub.channelId)?.exhausted) ||
              enriched.length > visibleRef.current
        );
        setUpdatedAt(Date.now());
        setLoading(false);
        setRefreshing(false);
        void translateVisibleTitles(enriched.slice(0, visibleRef.current), requestId);
      } catch {
        if (requestId !== requestRef.current) return;
        setPoolSafe([]);
        setVisibleCount(0);
        visibleRef.current = 0;
        setLoading(false);
        setRefreshing(false);
        setHasMore(false);
      }
    },
    [channelFilter]
  );

  useEffect(() => {
    load(false);
    return () => {
      requestRef.current += 1;
    };
  }, [subsKey, load]);

  const loadMore = useCallback(async () => {
    if (moreLock.current || loading || refreshing || !hasMore) return;

    // First consume the items already in the local pool, ten at a time.
    if (visibleRef.current < poolRef.current.length) {
      const next = Math.min(poolRef.current.length, visibleRef.current + NEXT_PAGE_SIZE);
      visibleRef.current = next;
      setVisibleCount(next);
      void translateVisibleTitles(poolRef.current.slice(0, next), requestRef.current);
      return;
    }

    moreLock.current = true;
    setLoadingMore(true);
    const requestId = requestRef.current;
    try {
      let grew = false;
      let attempts = 0;
      const selected = channelFilter
        ? subscriptions.filter((sub) => sub.channelId === channelFilter)
        : subscriptions;

      for (const sub of selected) {
        if (attempts >= 3 || grew) break;
        const cursor = rememberCursor(sub);
        if (cursor.exhausted) continue;
        attempts += 1;
        try {
          const page = await fetchChannelVideosPage(sub.channelId, {
            continuation: cursor.firstPageLoaded ? cursor.continuation : undefined,
            channelTitle: sub.title,
            channelAvatar: sub.avatar,
          });
          cursor.firstPageLoaded = true;
          cursor.continuation = page.continuation;
          if (!page.continuation) cursor.exhausted = true;
          const fresh = enrich(page.items);
          const before = poolRef.current.length;
          const merged = uniqueSorted([...poolRef.current, ...fresh]);
          if (merged.length > before) {
            grew = true;
            setPoolSafe(merged);
            const next = Math.min(merged.length, visibleRef.current + NEXT_PAGE_SIZE);
            visibleRef.current = next;
            setVisibleCount(next);
            setUpdatedAt(Date.now());
            void translateVisibleTitles(merged.slice(0, next), requestId);
          }
        } catch {
          // Try the next channel; a single bad RSS/browse response shouldn't
          // freeze the whole feed.
        }
      }

      const anyLive = selected.some((sub) => {
        const cursor = cursorsRef.current.get(sub.channelId);
        return cursor && !cursor.exhausted;
      });
      if (!grew && !anyLive) setHasMore(false);
      if (!anyLive && visibleRef.current >= poolRef.current.length) setHasMore(false);
    } finally {
      moreLock.current = false;
      setLoadingMore(false);
    }
  }, [channelFilter, hasMore, loading, refreshing, subscriptions]);

  const refresh = useCallback(() => load(true), [load]);

  const items = useMemo(() => {
    const avatarMap = new Map(subscriptions.map((sub) => [sub.channelId, sub.avatar]));
    return pool.slice(0, visibleCount).map((item) => ({
      ...item,
      channelAvatar: item.channelAvatar ?? avatarMap.get(item.channelId),
    }));
  }, [pool, visibleCount, subscriptions]);

  useEffect(() => {
    if (!translateTitlesEnabled) {
      translatedTitles.current = new Set();
      setPoolSafe(poolRef.current.map((item) => ({ ...item, translatedTitle: undefined })));
      return;
    }
    if (poolRef.current.length) {
      void translateVisibleTitles(
        poolRef.current.slice(0, visibleRef.current),
        requestRef.current
      );
    }
    // translateVisibleTitles is intentionally read from the current render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translateTitlesEnabled]);

  return {
    items,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    total: pool.length,
    updatedAt,
    refresh,
    loadMore,
  };
}
