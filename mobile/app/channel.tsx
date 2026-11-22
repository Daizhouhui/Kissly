import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../src/core/store';
import { VideoItem } from '../src/core/types';
import { resumeTarget } from '../src/core/watchProgress';
import { fetchChannelDescription } from '../src/core/youtube/channel';
import {
  ChannelPlaylist,
  fetchChannelPlaylistsPage,
  fetchChannelVideosPage,
} from '../src/core/youtube/channelVideos';
import { fetchChannelFeed, fetchPlaylistFeed } from '../src/core/youtube/rss';
import { CONTINUOUS_CORNER, RADIUS } from '../src/tokens';
import { AppPressable } from '../src/ui/app-pressable';
import { NavHeader } from '../src/ui/components';
import { useAppTheme } from '../src/ui/theme';
import { VideoCard } from '../src/ui/VideoCard';

const PAGE = 10;

function formatCount(value?: number) {
  if (!value) return '';
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return String(value);
}

export default function ChannelScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    channelId?: string;
    title?: string;
    avatar?: string;
    handle?: string;
    subscribers?: string;
    videos?: string;
  }>();
  const channelId = String(params.channelId ?? '');
  const title = String(params.title ?? '频道');
  const avatar = String(params.avatar ?? '');
  const handle = String(params.handle ?? '');
  const subscribers = String(params.subscribers ?? '');
  const videos = String(params.videos ?? '');
  const subscriptions = useAppStore((state) => state.subscriptions);
  const history = useAppStore((state) => state.history);
  const addSubscription = useAppStore((state) => state.addSubscription);
  const removeSubscription = useAppStore((state) => state.removeSubscription);
  const subscribed = subscriptions.some((sub) => sub.channelId === channelId);
  const savedById = useMemo(
    () => new Map(history.map((item) => [item.videoId, item])),
    [history]
  );

  const [items, setItems] = useState<VideoItem[]>([]);
  const [visible, setVisible] = useState(PAGE);
  const [continuation, setContinuation] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [description, setDescription] = useState('');
  const [expandDescription, setExpandDescription] = useState(false);
  const [tab, setTab] = useState<'latest' | 'popular' | 'playlists'>('latest');
  const [playlists, setPlaylists] = useState<ChannelPlaylist[]>([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistError, setPlaylistError] = useState('');
  const [selectedPlaylist, setSelectedPlaylist] = useState<ChannelPlaylist | null>(null);
  const [playlistItems, setPlaylistItems] = useState<VideoItem[]>([]);
  const [playlistVideosLoading, setPlaylistVideosLoading] = useState(false);
  const requestRef = useRef(0);
  const playlistRequestRef = useRef(0);

  useEffect(() => {
    if (!channelId) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    setItems([]);
    setVisible(PAGE);
    setContinuation(undefined);
    const run = async () => {
      try {
        const page = await fetchChannelVideosPage(channelId, {
          channelTitle: title,
          channelAvatar: avatar,
          force: true,
        });
        if (requestId !== requestRef.current) return;
        setItems(page.items);
        setContinuation(page.continuation);
        setVisible(Math.min(PAGE, page.items.length));
      } catch {
        try {
          const feed = await fetchChannelFeed(channelId, true);
          if (requestId !== requestRef.current) return;
          setItems(feed);
          setVisible(Math.min(PAGE, feed.length));
        } catch (reason) {
          if (requestId !== requestRef.current) return;
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    };
    run();
    fetchChannelDescription(channelId).then((text) => {
      if (requestId === requestRef.current) setDescription(text);
    });
    return () => {
      requestRef.current += 1;
    };
  }, [avatar, channelId, title]);

  const loadMore = async () => {
    if (loadingMore || loading) return;
    if (visible < items.length) {
      setVisible((count) => Math.min(items.length, count + PAGE));
      return;
    }
    if (!continuation) return;
    setLoadingMore(true);
    const requestId = requestRef.current;
    try {
      const page = await fetchChannelVideosPage(channelId, {
        continuation,
        channelTitle: title,
        channelAvatar: avatar,
      });
      if (requestId !== requestRef.current) return;
      const seen = new Set(items.map((item) => item.videoId));
      const fresh = page.items.filter((item) => !seen.has(item.videoId));
      const merged = [...items, ...fresh];
      setItems(merged);
      setContinuation(page.continuation);
      setVisible((count) => Math.min(merged.length, count + PAGE));
    } catch {
      // Keep the continuation token so a transient network failure can be
      // retried by tapping "load more" again instead of ending pagination.
    } finally {
      setLoadingMore(false);
    }
  };

  const loadPlaylists = async () => {
    if (!channelId || playlistLoading || playlists.length) return;
    setPlaylistLoading(true);
    setPlaylistError('');
    try {
      const page = await fetchChannelPlaylistsPage(channelId, { force: true });
      setPlaylists(page.items);
    } catch (reason) {
      setPlaylistError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPlaylistLoading(false);
    }
  };

  const openPlaylist = async (playlist: ChannelPlaylist) => {
    const requestId = ++playlistRequestRef.current;
    setSelectedPlaylist(playlist);
    setPlaylistItems([]);
    setPlaylistVideosLoading(true);
    try {
      const videos = await fetchPlaylistFeed(playlist.playlistId);
      if (requestId !== playlistRequestRef.current) return;
      setPlaylistItems(videos);
    } catch {
      if (requestId !== playlistRequestRef.current) return;
      setPlaylistItems([]);
    } finally {
      if (requestId === playlistRequestRef.current) {
        setPlaylistVideosLoading(false);
      }
    }
  };

  const toggleSubscription = () => {
    if (!channelId) return;
    if (subscribed) {
      removeSubscription(channelId);
    } else {
      addSubscription({
        channelId,
        title,
        handle: handle || undefined,
        avatar: avatar || undefined,
        subscriberCount: subscribers || undefined,
        videoCount: videos || undefined,
        addedAt: Date.now(),
      });
    }
  };

  const openVideo = (item: VideoItem) => {
    const saved = savedById.get(item.videoId);
    const startAt = saved ? resumeTarget(saved) : 0;
    router.push({
      pathname: '/player',
      params: {
        videoId: item.videoId,
        title: item.title,
        author: title,
        ...(startAt > 0 ? { startAt: String(startAt) } : {}),
      },
    } as any);
  };

  const latestItems = [...items].sort((a, b) => b.published - a.published);
  const popularItems = [...items].sort(
    (a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0) || b.published - a.published
  );
  const data = tab === 'latest' ? latestItems.slice(0, visible) : tab === 'popular' ? popularItems : [];
  const averageDuration = items.length
    ? Math.round(items.reduce((sum, item) => sum + (item.duration ?? 0), 0) / items.length / 60)
    : 0;

  const header = (
    <View>
      <View style={{ alignItems: 'center', paddingTop: 4 }}>
        {avatar ? (
          <Image
            source={{ uri: avatar }}
            style={{ width: 94, height: 94, borderRadius: RADIUS.pill, ...CONTINUOUS_CORNER } as any}
            contentFit="cover"
            transition={180}
          />
        ) : (
          <View
            style={{
              width: 94,
              height: 94,
              borderRadius: RADIUS.pill,
              backgroundColor: theme.colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.colors.primary, fontSize: 33, fontWeight: '900' }}>
              {title.slice(0, 1)}
            </Text>
          </View>
        )}
        <Text
          style={{
            color: theme.colors.text,
            fontSize: 24,
            fontWeight: '900',
            marginTop: 13,
            textAlign: 'center',
          }}
          numberOfLines={2}
        >
          {title}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 6, textAlign: 'center' }}>
          {[handle, subscribers, videos].filter(Boolean).join('  ·  ') || 'YouTube 频道'}
        </Text>

        {description ? (
          <AppPressable
            onPress={() => setExpandDescription((value) => !value)}
            feedback="opacity"
            style={{ marginTop: 10, paddingHorizontal: 8 }}
          >
            <Text
              style={{ color: theme.colors.textSecondary, fontSize: 11.5, lineHeight: 17, textAlign: 'center' }}
              numberOfLines={expandDescription ? undefined : 2}
            >
              {description}
            </Text>
            <Text style={{ color: theme.colors.primary, fontSize: 11, fontWeight: '700', marginTop: 3 }}>
              {expandDescription ? '收起' : '更多'}
            </Text>
          </AppPressable>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <AppPressable
            onPress={() => {
              const first = latestItems[0];
              if (!first) return;
              openVideo(first);
            }}
            disabled={!latestItems[0]}
            tone="onColor"
            style={{
              height: 48,
              minWidth: 176,
              borderRadius: RADIUS.control,
              ...CONTINUOUS_CORNER,
              backgroundColor: theme.colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              opacity: latestItems[0] ? 1 : 0.45,
            }}
          >
            <Ionicons name="play" size={19} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '800' }}>播放最新</Text>
          </AppPressable>
          <AppPressable
            onPress={toggleSubscription}
            style={{
              width: 48,
              height: 48,
              borderRadius: RADIUS.pill,
              ...CONTINUOUS_CORNER,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: subscribed ? theme.colors.primarySoft : theme.colors.card,
              borderWidth: subscribed ? 1 : StyleSheet.hairlineWidth,
              borderColor: subscribed ? theme.colors.primary : theme.colors.border,
            }}
          >
            <Ionicons
              name={subscribed ? 'checkmark' : 'add'}
              size={24}
              color={subscribed ? theme.colors.primary : theme.colors.text}
            />
          </AppPressable>
        </View>

        {items.length ? (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>{items.length}+</Text>
              <Text style={[styles.statLabel, { color: theme.colors.textTertiary }]}>已读取视频</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {averageDuration || '-'}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.textTertiary }]}>平均分钟</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {items[0] ? new Date(items[0].published).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '-'}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.textTertiary }]}>最近更新</Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={[styles.tabs, { borderBottomColor: theme.colors.border }]}>
        {(
          [
            ['latest', '最新', items.length],
            ['popular', '热门', items.length],
            ['playlists', '播放列表', playlists.length],
          ] as const
        ).map(([id, label, count]) => {
          const active = tab === id;
          return (
            <AppPressable
              key={id}
              onPress={() => {
                setTab(id);
                if (id === 'playlists') loadPlaylists();
              }}
              style={styles.tab}
            >
              <Text
                style={{
                  color: active ? theme.colors.text : theme.colors.textTertiary,
                  fontSize: 14.5,
                  fontWeight: active ? '800' : '600',
                }}
              >
                {label}
                {count ? ` ${count}` : ''}
              </Text>
              <View
                style={{
                  height: 2.5,
                  borderRadius: RADIUS.pill,
                  marginTop: 6,
                  backgroundColor: active ? theme.colors.text : 'transparent',
                  alignSelf: 'stretch',
                }}
              />
            </AppPressable>
          );
        })}
      </View>

      {error ? (
        <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 12, lineHeight: 18 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader title="频道" subtitle={handle || channelId} />
      <FlatList
        data={data}
        keyExtractor={(item) => item.videoId}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <VideoCard
            item={{ ...item, channelAvatar: avatar || item.channelAvatar }}
            onPress={() => openVideo(item)}
          />
        )}
        onEndReached={tab === 'latest' ? loadMore : undefined}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          tab === 'playlists' ? (
            playlistLoading ? (
              <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 26 }} />
            ) : playlistError ? (
              <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 16 }}>
                {playlistError}
              </Text>
            ) : (
              <Text style={{ color: theme.colors.textTertiary, fontSize: 12, marginTop: 16 }}>
                这个频道暂时没有公开播放列表。
              </Text>
            )
          ) : !loading && !error ? (
            <Text style={{ color: theme.colors.textTertiary, fontSize: 12, marginTop: 16 }}>
              这个频道暂时没有可读取的视频。
            </Text>
          ) : undefined
        }
        ListFooterComponent={
          tab === 'latest' && items.length ? (
            <View style={{ paddingVertical: 14, alignItems: 'center', gap: 6 }}>
              {loadingMore ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
              <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
                {visible >= items.length && !continuation
                  ? `已加载全部 ${items.length} 条`
                  : '上滑加载更多'}
              </Text>
            </View>
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
      />

      <Modal
        visible={!!selectedPlaylist}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedPlaylist(null)}
      >
        <View style={styles.modalMask}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.colors.bg,
                paddingBottom: Math.max(16, insets.bottom),
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 19, fontWeight: '900' }} numberOfLines={2}>
                  {selectedPlaylist?.title ?? '播放列表'}
                </Text>
                <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 4 }}>
                  {selectedPlaylist?.videoCount ? `${selectedPlaylist.videoCount} 个视频` : '播放列表'}
                </Text>
              </View>
              <AppPressable
                onPress={() => setSelectedPlaylist(null)}
                style={[styles.closeButton, { backgroundColor: theme.colors.surfaceAlt }]}
              >
                <Ionicons name="close" size={21} color={theme.colors.text} />
              </AppPressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {playlistVideosLoading ? (
                <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 26 }} />
              ) : playlistItems.length ? (
                playlistItems.map((item) => (
                  <VideoCard
                    key={item.videoId}
                    item={{ ...item, channelAvatar: avatar || item.channelAvatar }}
                    onPress={() => {
                      setSelectedPlaylist(null);
                      openVideo(item);
                    }}
                  />
                ))
              ) : (
                <Text style={{ color: theme.colors.textTertiary, fontSize: 12, marginTop: 20 }}>
                  这个播放列表没有可读取的视频。
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 4,
    alignSelf: 'stretch',
    paddingHorizontal: 12,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '800' },
  statLabel: { fontSize: 9.5, marginTop: 3 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 26 },
  tabs: {
    flexDirection: 'row',
    marginTop: 22,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: 8 },
  modalMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)', justifyContent: 'flex-end' },
  modalCard: {
    height: '86%',
    borderTopLeftRadius: RADIUS.modal,
    borderTopRightRadius: RADIUS.modal,
    ...CONTINUOUS_CORNER,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 12 },
  closeButton: { width: 38, height: 38, borderRadius: RADIUS.pill, ...CONTINUOUS_CORNER, alignItems: 'center', justifyContent: 'center' },
});
