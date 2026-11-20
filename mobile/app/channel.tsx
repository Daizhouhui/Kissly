import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '../src/core/store';
import { VideoItem } from '../src/core/types';
import { fetchChannelFeed } from '../src/core/youtube/rss';
import { NavHeader } from '../src/ui/components';
import { useAppTheme } from '../src/ui/theme';
import { VideoCard } from '../src/ui/VideoCard';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchChannelFeed(channelId)
      .then((feed) => {
        if (!cancelled) setItems(feed);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader title="频道详情" subtitle={handle || channelId} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', paddingTop: 8 }}>
          {avatar ? (
            <Image
              source={{ uri: avatar }}
              style={{ width: 94, height: 94, borderRadius: 47 }}
              contentFit="cover"
              transition={180}
            />
          ) : (
            <View
              style={{
                width: 94,
                height: 94,
                borderRadius: 47,
                backgroundColor: theme.colors.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: theme.colors.primary, fontSize: 32, fontWeight: '900' }}>
                {title.slice(0, 1)}
              </Text>
            </View>
          )}
          <Text style={{ color: theme.colors.text, fontSize: 24, fontWeight: '900', marginTop: 14 }}>
            {title}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 6 }}>
            {[subscribers, videos].filter(Boolean).join(' · ') || 'YouTube 频道'}
          </Text>
          <Pressable
            onPress={() => {
              if (subscribed) return;
              addSubscription({
                channelId,
                title,
                handle: handle || undefined,
                avatar: avatar || undefined,
                addedAt: Date.now(),
              });
            }}
            style={{
              marginTop: 16,
              height: 44,
              paddingHorizontal: 28,
              borderRadius: 22,
              backgroundColor: subscribed ? theme.colors.surfaceAlt : theme.colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 7,
            }}
          >
            <Ionicons
              name={subscribed ? 'checkmark' : 'add'}
              size={18}
              color={subscribed ? theme.colors.textSecondary : '#FFFFFF'}
            />
            <Text
              style={{
                color: subscribed ? theme.colors.textSecondary : '#FFFFFF',
                fontSize: 13,
                fontWeight: '800',
              }}
            >
              {subscribed ? '已订阅' : '订阅频道'}
            </Text>
          </Pressable>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 24,
            marginBottom: 4,
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '800' }}>最新视频</Text>
          {loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
        </View>

        {error ? (
          <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 12, lineHeight: 18 }}>
            {error}
          </Text>
        ) : null}

        {!loading && !error && !items.length ? (
          <Text style={{ color: theme.colors.textTertiary, fontSize: 12, marginTop: 16 }}>
            这个频道暂时没有可读取的视频。
          </Text>
        ) : null}

        {items.map((item) => (
          <VideoCard
            key={item.videoId}
            item={{ ...item, channelAvatar: avatar || item.channelAvatar }}
            onPress={() =>
              router.push({
                pathname: '/player',
                params: { videoId: item.videoId, title: item.title, author: title },
              } as any)
            }
          />
        ))}
      </ScrollView>
    </View>
  );
}
