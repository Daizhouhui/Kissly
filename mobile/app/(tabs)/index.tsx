import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../../src/core/store';
import { DiscoverLayout } from '../../src/core/types';
import { relativeTime } from '../../src/core/utils';
import { useFeed } from '../../src/hooks/useFeed';
import { useAppTheme } from '../../src/ui/theme';
import { VideoCard } from '../../src/ui/VideoCard';

type Filter = 'all' | 'unwatched';

const LAYOUTS: Array<{ id: DiscoverLayout; icon: any; label: string }> = [
  { id: 'list', icon: 'list-outline', label: '列表' },
  { id: 'grid', icon: 'grid-outline', label: '网格' },
  { id: 'large', icon: 'image-outline', label: '大图' },
];

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
  const { items, loading, refreshing, loadingMore, hasMore, total, updatedAt, refresh, loadMore } =
    useFeed(channelFilter);

  const watched = useMemo(
    () =>
      new Set(
        history
          .filter((item) => (item.progress ?? 1) >= 0.92)
          .map((item) => item.videoId)
      ),
    [history]
  );

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (filter === 'unwatched' && watched.has(item.videoId)) return false;
      return true;
    });
  }, [filter, items, watched]);

  const openSearch = () => router.push('/add-subscription' as any);

  const chips = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingRight: 18 }}
      style={{ marginTop: 12, marginBottom: 4 }}
    >
      {(['all', 'unwatched'] as Filter[]).map((value) => {
        const active = filter === value;
        return (
          <Pressable
            key={value}
            onPress={() => setFilter(value)}
            style={{
              paddingHorizontal: 16,
              height: 34,
              borderRadius: 17,
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
              {value === 'all' ? '全部' : '未看完'}
            </Text>
          </Pressable>
        );
      })}
      {LAYOUTS.map((option) => {
        const active = layout === option.id;
        return (
          <Pressable
            key={option.id}
            onPress={() => patchSettings({ discoverLayout: option.id })}
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? theme.colors.primarySoft : 'transparent',
              borderWidth: active ? 0 : StyleSheet.hairlineWidth,
              borderColor: theme.colors.borderStrong,
            }}
          >
            <Ionicons
              name={option.icon}
              size={17}
              color={active ? theme.colors.primary : theme.colors.textTertiary}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const header = (
    <View>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontSize: 25, fontWeight: '900', letterSpacing: -0.7 }}>
            发现
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 3 }}>
            订阅更新 · 点开就能看双语字幕
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/subscriptions' as any)}
          hitSlop={8}
          style={({ pressed }) => [styles.headerIcon, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="albums-outline" size={21} color={theme.colors.text} />
        </Pressable>
        <Pressable onPress={openSearch} hitSlop={8} style={({ pressed }) => [styles.headerIcon, pressed && { opacity: 0.6 }]}>
          <Ionicons name="add" size={24} color={theme.colors.text} />
        </Pressable>
      </View>

      <Pressable
        onPress={openSearch}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 9,
          backgroundColor: theme.colors.card,
          borderRadius: 24,
          paddingHorizontal: 16,
          height: 46,
          marginTop: 16,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        }}
      >
        <Ionicons name="search" size={19} color={theme.colors.textTertiary} />
        <Text style={{ flex: 1, color: theme.colors.textTertiary, fontSize: 14 }}>
          搜索 YouTube 频道
        </Text>
      </Pressable>

      {subscriptions.length > 0 ? (
        <View style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
            <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '800' }}>我的频道</Text>
            <Pressable onPress={() => router.push('/subscriptions' as any)} hitSlop={8}>
              <Text style={{ color: theme.colors.primary, fontSize: 11.5, fontWeight: '700' }}>
                全部频道
              </Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 13, paddingRight: 4, paddingBottom: 4 }}
          >
            <Pressable onPress={() => setChannelFilter('')} style={{ alignItems: 'center', width: 54 }}>
              <View
                style={[
                  styles.channelAvatar,
                  {
                    backgroundColor: channelFilter ? theme.colors.surfaceAlt : theme.colors.primarySoft,
                    borderColor: channelFilter ? 'transparent' : theme.colors.primary,
                  },
                ]}
              >
                <Ionicons
                  name="grid-outline"
                  size={19}
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
                  style={{ alignItems: 'center', width: 54 }}
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
                        style={{ width: 50, height: 50, borderRadius: 25 }}
                        contentFit="cover"
                        transition={160}
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
                      fontSize: 10,
                      marginTop: 5,
                    }}
                    numberOfLines={1}
                  >
                    {sub.title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {chips}
        </View>
      ) : (
        <View>{chips}</View>
      )}
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
        renderItem={({ item }) => (
          <View style={{ flex: layout === 'grid' ? 1 : undefined, marginBottom: 2 }}>
            <VideoCard
              item={item}
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
                {filter === 'unwatched' ? '上滑继续加载，找没看完的视频' : '没有找到匹配的视频'}
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
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 2,
    gap: 2,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
