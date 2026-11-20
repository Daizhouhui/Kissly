import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../../src/core/store';
import { DiscoverLayout } from '../../src/core/types';
import { relativeTime } from '../../src/core/utils';
import { useFeed } from '../../src/hooks/useFeed';
import { PrimaryButton } from '../../src/ui/components';
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
  const { items, loading, refreshing, updatedAt, refresh } = useFeed();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [channelFilter, setChannelFilter] = useState('');
  const watched = useMemo(() => new Set(history.map((item) => item.videoId)), [history]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (channelFilter && item.channelId !== channelFilter) return false;
      if (filter === 'unwatched' && watched.has(item.videoId)) return false;
      if (!needle) return true;
      return (
        item.title.toLowerCase().includes(needle) ||
        item.channelTitle.toLowerCase().includes(needle) ||
        (item.translatedTitle ?? '').toLowerCase().includes(needle)
      );
    });
  }, [channelFilter, filter, items, query, watched]);

  const openSearch = () => {
    router.push({
      pathname: '/add-subscription',
      params: query.trim() ? { q: query.trim() } : {},
    } as any);
  };

  const filterRow = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 10 }}>
      {(['all', 'unwatched'] as Filter[]).map((value) => {
        const active = filter === value;
        return (
          <Pressable
            key={value}
            onPress={() => setFilter(value)}
            style={{
              paddingHorizontal: 14,
              height: 32,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? theme.colors.primary : 'transparent',
              borderWidth: active ? 0 : StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
            }}
          >
            <Text
              style={{
                color: active ? '#FFFFFF' : theme.colors.textSecondary,
                fontSize: 12,
                fontWeight: active ? '700' : '500',
              }}
            >
              {value === 'all' ? '全部' : '未看完'}
            </Text>
          </Pressable>
        );
      })}
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        {LAYOUTS.map((option) => {
          const active = layout === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => patchSettings({ discoverLayout: option.id })}
              hitSlop={6}
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? theme.colors.primarySoft : 'transparent',
              }}
            >
              <Ionicons
                name={option.icon}
                size={19}
                color={active ? theme.colors.primary : theme.colors.textTertiary}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const header = (
    <View>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.9 }}>
            发现
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginTop: 4 }}>
            订阅更新 · 点开就能看双语字幕
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={() => router.push('/subscriptions' as any)}
            style={({ pressed }) => [
              styles.circleButton,
              { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name="albums-outline" size={19} color={theme.colors.primary} />
          </Pressable>
          <Pressable
            onPress={openSearch}
            style={({ pressed }) => [
              styles.circleButton,
              { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Ionicons name="add" size={22} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 9,
          backgroundColor: theme.colors.card,
          borderRadius: 16,
          paddingHorizontal: 14,
          height: 48,
          marginTop: 18,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        }}
      >
        <Pressable onPress={openSearch} hitSlop={8}>
          <Ionicons name="search" size={18} color={theme.colors.textTertiary} />
        </Pressable>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="搜索 YouTube 频道"
          placeholderTextColor={theme.colors.textTertiary}
          style={{ flex: 1, color: theme.colors.text, fontSize: 14, height: '100%' }}
          returnKeyType="search"
          onSubmitEditing={openSearch}
          clearButtonMode="never"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
          </Pressable>
        ) : (
          <Pressable onPress={openSearch} hitSlop={8}>
            <Text style={{ color: theme.colors.primary, fontSize: 11.5, fontWeight: '700' }}>搜索</Text>
          </Pressable>
        )}
      </View>

      {subscriptions.length > 0 ? (
        <View style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '800' }}>我的频道</Text>
            <Pressable onPress={() => router.push('/subscriptions' as any)} hitSlop={8}>
              <Text style={{ color: theme.colors.primary, fontSize: 11.5, fontWeight: '700' }}>
                管理频道
              </Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 14, paddingRight: 4, paddingBottom: 4 }}
          >
            <Pressable onPress={() => setChannelFilter('')} style={{ alignItems: 'center', width: 56 }}>
              <View
                style={[
                  styles.channelAvatar,
                  {
                    backgroundColor: theme.colors.surfaceAlt,
                    borderColor: channelFilter ? 'transparent' : theme.colors.primary,
                  },
                ]}
              >
                <Ionicons
                  name="grid-outline"
                  size={20}
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
                  style={{ alignItems: 'center', width: 56 }}
                >
                  <View
                    style={[
                      styles.channelAvatar,
                      {
                        borderColor: active ? theme.colors.primary : theme.colors.border,
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
          {filterRow}
        </View>
      ) : (
        <View>{filterRow}</View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <LinearGradient
        pointerEvents="none"
        colors={[theme.colors.primarySoft, theme.colors.bg]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 260 }}
      />
      <FlatList
        key={layout}
        data={visible}
        keyExtractor={(item) => item.videoId}
        numColumns={layout === 'grid' ? 2 : 1}
        columnWrapperStyle={layout === 'grid' ? { gap: 12 } : undefined}
        contentContainerStyle={{
          paddingTop: insets.top + 10,
          paddingHorizontal: 18,
          paddingBottom: 110,
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
            <View style={{ paddingTop: 30, alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>正在拉取订阅视频…</Text>
            </View>
          ) : subscriptions.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 46, paddingHorizontal: 24 }}>
              <View
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 42,
                  backgroundColor: theme.colors.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 18,
                }}
              >
                <Ionicons name="logo-youtube" size={36} color={theme.colors.primary} />
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
                  marginBottom: 22,
                }}
              >
                搜索你常看的 YouTube 频道，首页会按更新时间汇总，点开即可看双语字幕。
              </Text>
              <PrimaryButton label="搜索频道" icon="search" onPress={openSearch} style={{ width: 200 }} />
            </View>
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 46 }}>
              <Ionicons name="search-outline" size={32} color={theme.colors.textTertiary} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 12 }}>
                没有找到匹配的视频
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          !loading && visible.length > 0 ? (
            <Text style={{ color: theme.colors.textTertiary, fontSize: 11, textAlign: 'center', paddingTop: 10 }}>
              已加载 {visible.length} 个视频 · 下拉刷新
              {updatedAt ? ` · ${relativeTime(updatedAt)}更新` : ''}
            </Text>
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
    alignItems: 'flex-start',
    paddingTop: 4,
  },
  circleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
