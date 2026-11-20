import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Link, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../../src/core/store';
import { DiscoverLayout, VideoItem } from '../../src/core/types';
import { relativeTime } from '../../src/core/utils';
import { useFeed } from '../../src/hooks/useFeed';
import { useAppTheme } from '../../src/ui/theme';
import { VideoCard } from '../../src/ui/VideoCard';

type Filter = 'all' | 'watching';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'watching', label: '观看中' },
];

const LAYOUTS: Array<{ id: DiscoverLayout; label: string }> = [
  { id: 'list', label: '列表' },
  { id: 'grid', label: '网格' },
  { id: 'large', label: '大图' },
];

function LayoutGlyph({
  id,
  size = 20,
  color,
}: {
  id: DiscoverLayout;
  size?: number;
  color: string;
}) {
  if (id === 'grid') {
    return <Ionicons name="grid-outline" size={size} color={color} />;
  }
  if (id === 'list') {
    return <Ionicons name="list-outline" size={size + 2} color={color} />;
  }
  const barHeight = Math.max(4, Math.round(size * 0.32));
  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: 'center',
        gap: Math.max(3, Math.round(size * 0.18)),
      }}
    >
      {[0, 1].map((bar) => (
        <View
          key={bar}
          style={{
            height: barHeight,
            borderRadius: barHeight / 2,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}

export default function HomeScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const subscriptions = useAppStore((state) => state.subscriptions);
  const history = useAppStore((state) => state.history);
  const layout = useAppStore((state) => state.settings.discoverLayout);
  const patchSettings = useAppStore((state) => state.patchSettings);
  const [filter, setFilter] = useState<Filter>('all');
  const [channelFilter, setChannelFilter] = useState('');
  const [layoutMenu, setLayoutMenu] = useState(false);
  const [layoutAnchor, setLayoutAnchor] = useState({ top: 0, right: 16 });
  const layoutButtonRef = useRef<any>(null);
  const { items, loading, refreshing, loadingMore, hasMore, total, updatedAt, refresh, loadMore } =
    useFeed(channelFilter);

  const progressMap = useMemo(
    () => new Map(history.map((item) => [item.videoId, item.progress ?? 0])),
    [history]
  );

  const watching = useMemo(
    () => history.filter((item) => (item.progress ?? 0) > 0.02 && (item.progress ?? 0) < 0.92),
    [history]
  );

  const continueItem = watching[0];

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (filter === 'watching') {
        const p = progressMap.get(item.videoId) ?? 0;
        return p > 0.02 && p < 0.92;
      }
      return true;
    });
  }, [filter, items, progressMap]);

  const openSearch = () => router.push('/add-subscription' as any);

  const openLayoutMenu = () => {
    const button = layoutButtonRef.current;
    if (!button) {
      setLayoutMenu(true);
      return;
    }
    button.measureInWindow((x: number, y: number, width: number, height: number) => {
      const screenWidth = Dimensions.get('window').width;
      setLayoutAnchor({
        top: y + height + 8,
        right: Math.max(12, screenWidth - x - width),
      });
      setLayoutMenu(true);
    });
  };

  const header = (
    <View>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontSize: 34, fontWeight: '300', letterSpacing: -1.1 }}>
            YouTube
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/subscriptions' as any)}
          hitSlop={8}
          style={({ pressed }) => [
            styles.allChannelsButton,
            {
              backgroundColor: theme.colors.surfaceAlt,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.65 : 1,
            },
          ]}
        >
          <Ionicons name="albums-outline" size={24} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      <Pressable
        onPress={openSearch}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 9,
          backgroundColor: theme.colors.surfaceAlt,
          borderRadius: 25,
          paddingHorizontal: 16,
          height: 50,
          marginTop: 16,
        }}
      >
        <Ionicons name="search" size={20} color={theme.colors.textTertiary} />
        <Text style={{ flex: 1, color: theme.colors.textTertiary, fontSize: 14.5 }}>
          搜索 YouTube
        </Text>
      </Pressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 14, paddingRight: 8, paddingTop: 18, paddingBottom: 8 }}
      >
        <Pressable onPress={() => setChannelFilter('')} style={{ alignItems: 'center', width: 58 }}>
          <View
            style={[
              styles.channelAvatar,
              {
                backgroundColor: channelFilter ? theme.colors.surfaceAlt : theme.colors.primarySoft,
                borderColor: channelFilter ? 'transparent' : theme.colors.borderStrong,
              },
            ]}
          >
            <Ionicons
              name="apps-outline"
              size={22}
              color={channelFilter ? theme.colors.textTertiary : theme.colors.primary}
            />
          </View>
          <Text
            style={{
              color: channelFilter ? theme.colors.textSecondary : theme.colors.primary,
              fontSize: 10,
              marginTop: 5,
            }}
            numberOfLines={1}
          >
            全部
          </Text>
        </Pressable>
        {subscriptions.map((sub) => {
          const active = channelFilter === sub.channelId;
          return (
            <Pressable
              key={sub.channelId}
              onPress={() => setChannelFilter(active ? '' : sub.channelId)}
              style={{ alignItems: 'center', width: 58 }}
            >
              <View
                style={[
                  styles.channelAvatar,
                  {
                    borderColor: active ? theme.colors.primary : 'transparent',
                    backgroundColor: theme.colors.surfaceAlt,
                  },
                ]}
              >
                {sub.avatar ? (
                  <Image
                    source={{ uri: sub.avatar }}
                    style={{ width: 54, height: 54, borderRadius: 27 }}
                    contentFit="cover"
                    transition={140}
                  />
                ) : (
                  <Text style={{ color: theme.colors.primary, fontSize: 17, fontWeight: '900' }}>
                    {(sub.title || '?').slice(0, 1).toUpperCase()}
                  </Text>
                )}
              </View>
              <Text
                style={{
                  color: active ? theme.colors.primary : theme.colors.textSecondary,
                  fontSize: 9.5,
                  marginTop: 5,
                }}
                numberOfLines={1}
              >
                {sub.title}
              </Text>
            </Pressable>
          );
        })}
        <Link href="/add-subscription" asChild>
          <Pressable style={{ alignItems: 'center', width: 58 }}>
            <View
              style={[
                styles.channelAvatar,
                {
                  borderColor: theme.colors.borderStrong,
                  borderStyle: 'dashed',
                  backgroundColor: 'transparent',
                },
              ]}
            >
              <Ionicons name="add" size={24} color={theme.colors.primary} />
            </View>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: 9.5,
                marginTop: 5,
              }}
              numberOfLines={1}
            >
              添加
            </Text>
          </Pressable>
        </Link>
      </ScrollView>

      {continueItem ? (
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/player',
              params: { videoId: continueItem.videoId, title: continueItem.title, author: continueItem.author },
            } as any)
          }
          style={({ pressed }) => [
            styles.continueCard,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.88 : 1,
            },
          ]}
        >
          <Image
            source={{ uri: continueItem.thumbnail || `https://i.ytimg.com/vi/${continueItem.videoId}/hqdefault.jpg` }}
            style={styles.continueThumb}
            contentFit="cover"
            transition={140}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: theme.colors.text, fontSize: 13.5, fontWeight: '800', lineHeight: 18 }} numberOfLines={2}>
              {continueItem.title}
            </Text>
            <View
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: theme.colors.surfaceAlt,
                borderRadius: 999,
                height: 27,
                paddingHorizontal: 9,
                marginTop: 8,
              }}
            >
              <Ionicons name="play" size={11} color={theme.colors.textSecondary} />
              <View style={{ width: 48, height: 3, borderRadius: 2, backgroundColor: theme.colors.borderStrong }}>
                <View
                  style={{
                    width: `${Math.max(6, Math.round((continueItem.progress ?? 0) * 100))}%` as any,
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: theme.colors.primary,
                  }}
                />
              </View>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 9.5 }}>
                剩 {Math.max(1, Math.round(((1 - (continueItem.progress ?? 0)) * (continueItem.duration ?? 0)) / 60))} 分钟
              </Text>
            </View>
          </View>
        </Pressable>
      ) : null}

      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {FILTERS.map((item) => {
            const active = filter === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setFilter(item.id)}
                style={{
                  paddingHorizontal: 18,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? theme.colors.primary : 'transparent',
                  borderWidth: active ? 0 : StyleSheet.hairlineWidth,
                  borderColor: theme.colors.borderStrong,
                }}
              >
                <Text
                  style={{
                    color: active ? '#FFFFFF' : theme.colors.textSecondary,
                    fontSize: 12.5,
                    fontWeight: active ? '800' : '600',
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View ref={layoutButtonRef} collapsable={false}>
          <Pressable
            onPress={openLayoutMenu}
            hitSlop={6}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: theme.colors.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LayoutGlyph id={layout} size={18} color={theme.colors.textSecondary} />
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <FlatList
        key={layout}
        data={visible}
        keyExtractor={(item) => item.videoId}
        numColumns={layout === 'grid' ? 2 : 1}
        columnWrapperStyle={layout === 'grid' ? { gap: 12 } : undefined}
        contentContainerStyle={{
          paddingTop: insets.top + 14,
          paddingHorizontal: 18,
          paddingBottom: 96,
          flexGrow: 1,
        }}
        ListHeaderComponent={header}
        renderItem={({ item }: { item: VideoItem }) => (
          <View style={{ flex: layout === 'grid' ? 1 : undefined, marginBottom: 2 }}>
            <VideoCard
              item={{ ...item, channelAvatar: item.channelAvatar }}
              variant={layout === 'grid' ? 'grid' : layout === 'large' ? 'large' : 'list'}
              onPress={() =>
                router.push({
                  pathname: '/player',
                  params: {
                    videoId: item.videoId,
                    title: item.title,
                    author: item.channelTitle,
                  },
                } as any)
              }
            />
          </View>
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.45}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingTop: 34, alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>正在拉取订阅视频…</Text>
            </View>
          ) : subscriptions.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 52, paddingHorizontal: 26 }}>
              <View
                style={{
                  width: 76,
                  height: 76,
                  borderRadius: 38,
                  backgroundColor: theme.colors.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                }}
              >
                <Ionicons name="logo-youtube" size={32} color={theme.colors.primary} />
              </View>
              <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '800', marginBottom: 7 }}>
                从第一个频道开始
              </Text>
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: 13,
                  lineHeight: 20,
                  textAlign: 'center',
                  marginBottom: 20,
                }}
              >
                搜索常看的 YouTube 频道，首页会按更新时间汇总。
              </Text>
              <Pressable
                onPress={openSearch}
                style={{
                  height: 44,
                  paddingHorizontal: 26,
                  borderRadius: 22,
                  backgroundColor: theme.colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' }}>搜索频道</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 46 }}>
              <Ionicons name="search-outline" size={32} color={theme.colors.textTertiary} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 12 }}>
                {filter === 'watching'
                  ? '已加载的视频里还没有看到一半的内容'
                  : '没有找到匹配的视频'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          visible.length > 0 ? (
            <View style={{ paddingTop: 14, paddingBottom: 8, alignItems: 'center', gap: 6 }}>
              {loadingMore ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
              <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
                {hasMore
                  ? `已加载 ${visible.length} / ${Math.max(total, visible.length)} 条 · 上滑加载更多`
                  : `已加载全部 ${visible.length} 条`}
                {updatedAt ? ` · ${relativeTime(updatedAt)}更新` : ''}
              </Text>
            </View>
          ) : (
            <View />
          )
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />

      <Modal visible={layoutMenu} transparent animationType="fade" onRequestClose={() => setLayoutMenu(false)}>
        <View style={{ flex: 1 }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setLayoutMenu(false)} />
          <View
            style={[
              styles.layoutPopover,
              {
                top: layoutAnchor.top,
                right: layoutAnchor.right,
                backgroundColor: theme.colors.card,
                borderColor: theme.colors.border,
              },
            ]}
          >
            {LAYOUTS.map((option) => {
              const active = layout === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    patchSettings({ discoverLayout: option.id });
                    setLayoutMenu(false);
                  }}
                  style={{
                    height: 42,
                    borderRadius: 12,
                    paddingHorizontal: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    backgroundColor: active ? theme.colors.primarySoft : 'transparent',
                  }}
                >
                  <LayoutGlyph
                    id={option.id}
                    size={18}
                    color={active ? theme.colors.primary : theme.colors.textSecondary}
                  />
                  <Text
                    style={{
                      flex: 1,
                      color: active ? theme.colors.primary : theme.colors.text,
                      fontSize: 13.5,
                      fontWeight: active ? '800' : '600',
                    }}
                  >
                    {option.label}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark" size={18} color={theme.colors.primary} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 2,
    gap: 9,
  },
  allChannelsButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  continueCard: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    marginTop: 10,
  },
  continueThumb: {
    width: 112,
    aspectRatio: 16 / 9,
    borderRadius: 12,
    backgroundColor: '#1B1B19',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    marginBottom: 8,
  },
  layoutPopover: {
    position: 'absolute',
    width: 152,
    borderRadius: 16,
    padding: 8,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
});
