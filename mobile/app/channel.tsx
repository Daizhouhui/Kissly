import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
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
  fetchPlaylistVideosPage,
  parseCountLabel,
} from '../src/core/youtube/channelVideos';
import { fetchPlaylistFeed } from '../src/core/youtube/rss';
import { useChannelFeed } from '../src/hooks/useChannelFeed';
import { CONTINUOUS_CORNER, RADIUS } from '../src/tokens';
import { AppPressable } from '../src/ui/app-pressable';
import { NavHeader } from '../src/ui/components';
import { PRESS_SCALE } from '../src/ui/motion';
import { useAppTheme } from '../src/ui/theme';
import { VideoCard } from '../src/ui/VideoCard';

function formatCount(value?: number) {
  if (value === undefined || value === null) return '';
  if (value >= 100000000) {
    return `${(value / 100000000).toFixed(1).replace(/\.0$/, '')}亿`;
  }
  if (value >= 10000) {
    return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  }
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

  const {
    items,
    loading,
    loadingMore,
    channelInfo,
    hasMore,
    error,
    loadMore,
  } = useChannelFeed(channelId, {
    channelTitle: title,
    channelAvatar: avatar || undefined,
    enabled: Boolean(channelId),
  });

  const [description, setDescription] = useState('');
  const [expandDescription, setExpandDescription] = useState(false);
  const [tab, setTab] = useState<'latest' | 'popular' | 'playlists'>('latest');
  const [playlists, setPlaylists] = useState<ChannelPlaylist[]>([]);
  const [playlistsContinuation, setPlaylistsContinuation] = useState<string | undefined>();
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistLoadingMore, setPlaylistLoadingMore] = useState(false);
  const [playlistError, setPlaylistError] = useState('');
  const [selectedPlaylist, setSelectedPlaylist] = useState<ChannelPlaylist | null>(null);
  const [playlistItems, setPlaylistItems] = useState<VideoItem[]>([]);
  const [playlistVideosContinuation, setPlaylistVideosContinuation] = useState<string | undefined>();
  const [playlistVideosLoading, setPlaylistVideosLoading] = useState(false);
  const [playlistVideosLoadingMore, setPlaylistVideosLoadingMore] = useState(false);
  const descriptionRequestRef = useRef(0);
  const playlistsRequestRef = useRef(0);
  const playlistVideosRequestRef = useRef(0);

  useEffect(() => {
    if (!channelId) return;
    setDescription('');
    const requestId = ++descriptionRequestRef.current;
    fetchChannelDescription(channelId)
      .then((text) => {
        if (requestId === descriptionRequestRef.current) setDescription(text);
      })
      .catch(() => {});
    return () => {
      descriptionRequestRef.current += 1;
    };
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return;
    playlistsRequestRef.current += 1;
    playlistVideosRequestRef.current += 1;
    setPlaylists([]);
    setPlaylistsContinuation(undefined);
    setPlaylistError('');
    setPlaylistLoading(false);
    setPlaylistLoadingMore(false);
    setSelectedPlaylist(null);
    setPlaylistItems([]);
    setPlaylistVideosContinuation(undefined);
    setPlaylistVideosLoading(false);
    setPlaylistVideosLoadingMore(false);
    setTab('latest');
  }, [channelId]);

  const loadPlaylists = async (force = false) => {
    if (!channelId || playlistLoading) return;
    if (!force && (playlists.length || playlistsContinuation)) return;
    const requestId = ++playlistsRequestRef.current;
    setPlaylistLoading(true);
    setPlaylistError('');
    try {
      const page = await fetchChannelPlaylistsPage(channelId, { force: true });
      if (requestId !== playlistsRequestRef.current) return;
      setPlaylists(page.items);
      setPlaylistsContinuation(page.continuation);
    } catch (reason) {
      if (requestId !== playlistsRequestRef.current) return;
      setPlaylistError(reason instanceof Error ? reason.message : String(reason));
      setPlaylistsContinuation(undefined);
    } finally {
      if (requestId === playlistsRequestRef.current) {
        setPlaylistLoading(false);
      }
    }
  };

  const loadMorePlaylists = async () => {
    if (!channelId || !playlistsContinuation || playlistLoading || playlistLoadingMore) {
      return;
    }
    const requestId = playlistsRequestRef.current;
    setPlaylistLoadingMore(true);
    try {
      const page = await fetchChannelPlaylistsPage(channelId, {
        continuation: playlistsContinuation,
      });
      if (requestId !== playlistsRequestRef.current) return;
      setPlaylists((current) => {
        const seen = new Set(current.map((item) => item.playlistId));
        return [
          ...current,
          ...page.items.filter((item) => !seen.has(item.playlistId)),
        ];
      });
      setPlaylistsContinuation(page.continuation);
    } catch {
      // Keep the token so the next upward scroll retries it.
    } finally {
      if (requestId === playlistsRequestRef.current) {
        setPlaylistLoadingMore(false);
      }
    }
  };

  const openPlaylist = async (playlist: ChannelPlaylist) => {
    const requestId = ++playlistVideosRequestRef.current;
    setSelectedPlaylist(playlist);
    setPlaylistItems([]);
    setPlaylistVideosContinuation(undefined);
    setPlaylistVideosLoading(true);
    try {
      const page = await fetchPlaylistVideosPage(playlist.playlistId, {
        channelId,
        channelTitle: title,
        channelAvatar: avatar || undefined,
      });
      if (requestId !== playlistVideosRequestRef.current) return;
      setPlaylistItems(page.items);
      setPlaylistVideosContinuation(page.continuation);
    } catch {
      try {
        const videos = await fetchPlaylistFeed(playlist.playlistId);
        if (requestId !== playlistVideosRequestRef.current) return;
        setPlaylistItems(videos);
        setPlaylistVideosContinuation(undefined);
      } catch {
        if (requestId !== playlistVideosRequestRef.current) return;
        setPlaylistItems([]);
      }
    } finally {
      if (requestId === playlistVideosRequestRef.current) {
        setPlaylistVideosLoading(false);
      }
    }
  };

  const loadMorePlaylist = async () => {
    if (
      !selectedPlaylist ||
      !playlistVideosContinuation ||
      playlistVideosLoadingMore ||
      playlistVideosLoading
    ) {
      return;
    }
    const requestId = playlistVideosRequestRef.current;
    setPlaylistVideosLoadingMore(true);
    try {
      const page = await fetchPlaylistVideosPage(selectedPlaylist.playlistId, {
        continuation: playlistVideosContinuation,
        channelId,
        channelTitle: title,
        channelAvatar: avatar || undefined,
      });
      if (requestId !== playlistVideosRequestRef.current) return;
      setPlaylistItems((current) => {
        const seen = new Set(current.map((item) => item.videoId));
        return [...current, ...page.items.filter((item) => !seen.has(item.videoId))];
      });
      setPlaylistVideosContinuation(page.continuation);
    } catch {
      // Keep the token so the user can retry after a transient failure.
    } finally {
      if (requestId === playlistVideosRequestRef.current) {
        setPlaylistVideosLoadingMore(false);
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
        subscriberCount:
          formatCount(subscriberTotal) || subscribers || undefined,
        videoCount: formatCount(videoTotal) || videos || undefined,
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
  const videoTotal =
    channelInfo?.videoCount ?? parseCountLabel(videos);
  const subscriberTotal =
    channelInfo?.subscriberCount ?? parseCountLabel(subscribers);
  const handleText = channelInfo?.handle ?? handle;
  const descriptionText = description || channelInfo?.description || '';
  const videoData = tab === 'latest' ? latestItems : tab === 'popular' ? popularItems : [];
  const listData: (VideoItem | ChannelPlaylist)[] =
    tab === 'playlists' ? playlists : videoData;

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
          {handleText || 'YouTube 频道'}
        </Text>

        {descriptionText ? (
          <AppPressable
            onPress={() => setExpandDescription((value) => !value)}
            feedback="opacity"
            style={{ marginTop: 10, paddingHorizontal: 8 }}
          >
            <Text
              style={{ color: theme.colors.textSecondary, fontSize: 11.5, lineHeight: 17, textAlign: 'center' }}
              numberOfLines={expandDescription ? undefined : 2}
            >
              {descriptionText}
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

        {videoTotal !== undefined || subscriberTotal !== undefined || items.length ? (
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {videoTotal !== undefined ? formatCount(videoTotal) : '-'}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.textTertiary }]}>发布视频</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {subscriberTotal !== undefined ? formatCount(subscriberTotal) : '-'}
              </Text>
              <Text style={[styles.statLabel, { color: theme.colors.textTertiary }]}>订阅者</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.colors.text }]}>
                {latestItems[0]
                  ? new Date(latestItems[0].published).toLocaleDateString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                    })
                  : '-'}
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

  const renderPlaylistRow = (playlist: ChannelPlaylist) => (
    <AppPressable
      onPress={() => void openPlaylist(playlist)}
      feedback="opacity"
      accessibilityRole="button"
      accessibilityLabel={`打开播放列表 ${playlist.title}`}
      style={[styles.playlistRow, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
    >
      {playlist.thumbnail ? (
        <Image
          source={{ uri: playlist.thumbnail }}
          style={styles.playlistThumb as any}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View style={[styles.playlistThumb, styles.playlistThumbFallback, { backgroundColor: theme.colors.primarySoft }] as any}>
          <Ionicons name="albums-outline" size={26} color={theme.colors.primary} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{ color: theme.colors.text, fontSize: 14.5, fontWeight: '800', lineHeight: 19 }}
          numberOfLines={2}
        >
          {playlist.title}
        </Text>
        <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 5 }}>
          {playlist.videoCount ? `${playlist.videoCount} 个视频` : '播放列表'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} />
    </AppPressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader title="频道" subtitle={handleText || channelId} />
      <FlatList
        data={listData}
        keyExtractor={(item) =>
          tab === 'playlists'
            ? `playlist:${(item as ChannelPlaylist).playlistId}`
            : (item as VideoItem).videoId
        }
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}
        ListHeaderComponent={header}
        renderItem={({ item }) => {
          if (tab === 'playlists') {
            return renderPlaylistRow(item as ChannelPlaylist);
          }
          const video = item as VideoItem;
          return (
            <VideoCard
              item={{ ...video, channelAvatar: avatar || video.channelAvatar }}
              onPress={() => openVideo(video)}
            />
          );
        }}
        onEndReached={tab === 'playlists' ? loadMorePlaylists : loadMore}
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
          ) : loading ? (
            <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 26 }} />
          ) : !error ? (
            <Text style={{ color: theme.colors.textTertiary, fontSize: 12, marginTop: 16 }}>
              这个频道暂时没有可读取的视频。
            </Text>
          ) : undefined
        }
        ListFooterComponent={
          tab === 'playlists' ? (
            playlists.length ? (
              <View style={{ paddingVertical: 14, alignItems: 'center', gap: 6 }}>
                {playlistLoadingMore ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : null}
                <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
                  {playlistsContinuation
                    ? '上滑自动加载更多'
                    : `共 ${playlists.length} 个播放列表`}
                </Text>
              </View>
            ) : undefined
          ) : items.length ? (
            <View style={{ paddingVertical: 14, alignItems: 'center', gap: 6 }}>
              {loadingMore ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : null}
              <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
                {hasMore ? '上滑自动加载更多' : `已加载全部 ${items.length} 条`}
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
            {playlistVideosLoading && !playlistItems.length ? (
              <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 26 }} />
            ) : (
              <FlatList
                data={playlistItems}
                keyExtractor={(item) => item.videoId}
                onEndReached={loadMorePlaylist}
                onEndReachedThreshold={0.5}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                  <VideoCard
                    item={{ ...item, channelAvatar: avatar || item.channelAvatar }}
                    onPress={() => {
                      setSelectedPlaylist(null);
                      openVideo(item);
                    }}
                  />
                )}
                ListEmptyComponent={
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 12, marginTop: 20 }}>
                    这个播放列表没有可读取的视频。
                  </Text>
                }
                ListFooterComponent={
                  playlistVideosLoadingMore ? (
                    <ActivityIndicator
                      color={theme.colors.primary}
                      style={{ marginVertical: 16 }}
                    />
                  ) : playlistVideosContinuation ? (
                    <Text
                      style={{
                        color: theme.colors.textTertiary,
                        fontSize: 11,
                        textAlign: 'center',
                        marginVertical: 12,
                      }}
                    >
                      上滑自动加载更多
                    </Text>
                  ) : playlistItems.length ? (
                    <Text
                      style={{
                        color: theme.colors.textTertiary,
                        fontSize: 11,
                        textAlign: 'center',
                        marginVertical: 12,
                      }}
                    >
                      共 {playlistItems.length} 个视频
                    </Text>
                  ) : undefined
                }
              />
            )}
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
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.card,
    ...CONTINUOUS_CORNER,
  },
  playlistThumb: {
    width: 126,
    height: 71,
    borderRadius: RADIUS.control,
    ...CONTINUOUS_CORNER,
  },
  playlistThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
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
