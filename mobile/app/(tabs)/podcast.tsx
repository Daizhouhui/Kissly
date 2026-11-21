import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../../src/core/store';
import { formatTime, relativeTime } from '../../src/core/utils';
import { useFeed } from '../../src/hooks/useFeed';
import { CONTINUOUS_CORNER, RADIUS } from '../../src/tokens';
import { AppPressable } from '../../src/ui/app-pressable';
import { useAppTheme } from '../../src/ui/theme';

const Pressable = AppPressable;

export default function PodcastScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const history = useAppStore((state) => state.history);
  const { items, loading, refreshing, loadingMore, hasMore, refresh, loadMore } = useFeed();

  const episodes = useMemo(() => {
    const progress = new Map(history.map((item) => [item.videoId, item.progress ?? 0]));
    return items
      .filter((item) => !item.isShort && (item.duration ?? 0) >= 12 * 60)
      .map((item) => ({ ...item, progress: progress.get(item.videoId) ?? 0 }));
  }, [history, items]);

  useEffect(() => {
    if (loading || loadingMore || !hasMore) return;
    if (episodes.length >= 8) return;
    const timer = setTimeout(() => {
      void loadMore();
    }, 120);
    return () => clearTimeout(timer);
  }, [episodes.length, hasMore, loadMore, loading, loadingMore]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <FlatList
        data={episodes}
        keyExtractor={(item) => item.videoId}
        contentContainerStyle={{
          paddingTop: insets.top + 18,
          paddingHorizontal: 18,
          paddingBottom: 110,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={theme.colors.primary}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.8 }}>
                  播客
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginTop: 4 }}>
                  订阅频道里的长视频、访谈和音频节目
                </Text>
              </View>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: RADIUS.pill,
                  backgroundColor: theme.colors.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="radio" size={21} color={theme.colors.primary} />
              </View>
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                backgroundColor: theme.colors.card,
                borderRadius: RADIUS.card,
                ...CONTINUOUS_CORNER,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                padding: 13,
                marginTop: 18,
              }}
            >
              <Ionicons name="information-circle-outline" size={17} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, lineHeight: 17, flex: 1 }}>
                这里汇总 12 分钟以上的节目；点开仍然是完整视频播放器，字幕、精听和句子收藏都可直接用。
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 4 }}>
              <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '800' }}>待听节目</Text>
              <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
                {loading ? '正在整理…' : `${episodes.length} 个`}
              </Text>
            </View>
            {loading && !episodes.length ? (
              <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 28 }} />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/player',
                params: { videoId: item.videoId, title: item.title, author: item.channelTitle },
              } as any)
            }
            radius={RADIUS.card}
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.card,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <View style={{ width: 94, aspectRatio: 1, borderRadius: RADIUS.control, ...CONTINUOUS_CORNER, overflow: 'hidden', backgroundColor: theme.colors.surfaceAlt }}>
              <Image
                source={{ uri: item.thumbnail }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={160}
              />
              <View style={styles.playBadge}>
                <Ionicons name="play" size={14} color="#FFFFFF" />
              </View>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '800', lineHeight: 19 }} numberOfLines={2}>
                {item.title}
              </Text>
              {item.translatedTitle ? (
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 3 }} numberOfLines={1}>
                  {item.translatedTitle}
                </Text>
              ) : null}
              <Text style={{ color: theme.colors.textTertiary, fontSize: 10.5, marginTop: 5 }} numberOfLines={1}>
                {item.channelTitle} · {formatTime(item.duration ?? 0)} · {relativeTime(item.published)}
              </Text>
              {item.progress > 0.02 && item.progress < 0.92 ? (
                <View style={{ marginTop: 8 }}>
                  <View style={{ height: 3, borderRadius: RADIUS.pill, backgroundColor: theme.colors.surfaceAlt }}>
                    <View
                      style={{
                        width: `${Math.round(item.progress * 100)}%` as any,
                        height: 3,
                        borderRadius: RADIUS.pill,
                        backgroundColor: theme.colors.primary,
                      }}
                    />
                  </View>
                  <Text style={{ color: theme.colors.primary, fontSize: 9.5, marginTop: 4, fontWeight: '700' }}>
                    已听 {Math.round(item.progress * 100)}%
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={{ alignItems: 'center', paddingTop: 54, paddingHorizontal: 28 }}>
              <View
                style={{
                  width: 76,
                  height: 76,
                  borderRadius: RADIUS.control,
                  ...CONTINUOUS_CORNER,
                  backgroundColor: theme.colors.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="mic-outline" size={34} color={theme.colors.primary} />
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '800', marginTop: 16 }}>
                暂时没有长节目
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, lineHeight: 19, marginTop: 7, textAlign: 'center' }}>
                订阅更多访谈、播客或课程频道，12 分钟以上的内容会自动出现在这里。
              </Text>
              <Pressable
                tone="onColor"
                onPress={() => router.push('/add-subscription' as any)}
                style={{
                  marginTop: 18,
                  height: 42,
                  paddingHorizontal: 18,
                  borderRadius: RADIUS.control,
                  ...CONTINUOUS_CORNER,
                  backgroundColor: theme.colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 7,
                }}
              >
                <Ionicons name="search" size={16} color="#FFFFFF" />
                <Text style={{ color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' }}>去搜索频道</Text>
              </Pressable>
            </View>
          ) : undefined
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.45}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator color={theme.colors.primary} style={{ marginVertical: 18 }} /> : undefined
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: RADIUS.card,
    ...CONTINUOUS_CORNER,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
    marginTop: 10,
  },
  playBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(0,0,0,0.66)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
