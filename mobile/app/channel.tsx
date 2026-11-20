import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAppStore } from '../src/core/store';
import { VideoItem } from '../src/core/types';
import { fetchChannelVideosPage } from '../src/core/youtube/channelVideos';
import { fetchChannelFeed } from '../src/core/youtube/rss';
import { NavHeader } from '../src/ui/components';
import { useAppTheme } from '../src/ui/theme';
import { VideoCard } from '../src/ui/VideoCard';

const PAGE = 10;

export default function ChannelScreen() {
  const theme = useAppTheme();
  const router = useRouter();
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
  const addSubscription = useAppStore((state) => state.addSubscription);
  const subscribed = subscriptions.some((sub) => sub.channelId === channelId);
  const [items, setItems] = useState<VideoItem[]>([]);
  const [visible, setVisible] = useState(PAGE);
  const [continuation, setContinuation] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

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
    try {
      const page = await fetchChannelVideosPage(channelId, {
        continuation,
        channelTitle: title,
        channelAvatar: avatar,
      });
      const seen = new Set(items.map((item) => item.videoId));
      const fresh = page.items.filter((item) => !seen.has(item.videoId));
      const merged = [...items, ...fresh];
      setItems(merged);
      setContinuation(page.continuation);
      setVisible((count) => Math.min(merged.length, count + PAGE));
    } catch {
      setContinuation(undefined);
    } finally {
      setLoadingMore(false);
    }
  };

  const header = (
    <View>
      <View style={{ alignItems: 'center', paddingTop: 4 }}>
        {avatar ? (
          <Image
            source={{ uri: avatar }}
            style={{ width: 88, height: 88, borderRadius: 44 }}
            contentFit="cover"
            transition={180}
          />
        ) : (
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: theme.colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.colors.primary, fontSize: 31, fontWeight: '900' }}>
              {title.slice(0, 1)}
            </Text>
          </View>
        )}
        <Text
          style={{
            color: theme.colors.text,
            fontSize: 23,
            fontWeight: '900',
            marginTop: 13,
            textAlign: 'center',
          }}
          numberOfLines={2}
        >
          {title}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 6 }}>
          {[subscribers, videos, handle].filter(Boolean).join('  ·  ') || 'YouTube 频道'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 15 }}>
          <Pressable
            onPress={() => {
              if (subscribed || !channelId) return;
              addSubscription({
                channelId,
                title,
                handle: handle || undefined,
                avatar: avatar || undefined,
                subscriberCount: subscribers || undefined,
                videoCount: videos || undefined,
                addedAt: Date.now(),
              });
            }}
            style={{
              height: 42,
              paddingHorizontal: 22,
              borderRadius: 21,
              backgroundColor: subscribed ? theme.colors.surfaceAlt : theme.colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
            }}
          >
            <Ionicons
              name={subscribed ? 'checkmark' : 'add'}
              size={17}
              color={subscribed ? theme.colors.textSecondary : '#FFFFFF'}
            />
            <Text
              style={{
                color: subscribed ? theme.colors.textSecondary : '#FFFFFF',
                fontSize: 12.5,
                fontWeight: '800',
              }}
            >
              {subscribed ? '已订阅' : '订阅频道'}
            </Text>
          </Pressable>
          {items[0] ? (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/player',
                  params: {
                    videoId: items[0].videoId,
                    title: items[0].title,
                    author: title,
                  },
                } as any)
              }
              style={{
                height: 42,
                paddingHorizontal: 18,
                borderRadius: 21,
                backgroundColor: theme.colors.card,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 6,
              }}
            >
              <Ionicons name="play" size={15} color={theme.colors.text} />
              <Text style={{ color: theme.colors.text, fontSize: 12.5, fontWeight: '700' }}>
                播放最新
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View
        style={{
          marginTop: 24,
          marginBottom: 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '800' }}>最新视频</Text>
        {loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
        {!loading && items.length ? (
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
            {Math.min(visible, items.length)} / {items.length}
          </Text>
        ) : null}
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
      <NavHeader title="频道详情" subtitle={handle || channelId} />
      <FlatList
        data={items.slice(0, visible)}
        keyExtractor={(item) => item.videoId}
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <VideoCard
            item={{ ...item, channelAvatar: avatar || item.channelAvatar }}
            onPress={() =>
              router.push({
                pathname: '/player',
                params: { videoId: item.videoId, title: item.title, author: title },
              } as any)
            }
          />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={{ color: theme.colors.textTertiary, fontSize: 12, marginTop: 16 }}>
              这个频道暂时没有可读取的视频。
            </Text>
          ) : undefined
        }
        ListFooterComponent={
          items.length ? (
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
    </View>
  );
}
