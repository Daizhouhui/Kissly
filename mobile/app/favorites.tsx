import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../src/core/store';
import { EmptyState, ManageBar, NavHeader, SelectionCircle } from '../src/ui/components';
import { useAppTheme } from '../src/ui/theme';

function formatTime(value: number) {
  if (!isFinite(value) || value < 0) value = 0;
  const total = Math.floor(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type FavoriteTab = 'video' | 'sentence';

export default function FavoritesScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const favorites = useAppStore((state) => state.favorites);
  const sentenceFavorites = useAppStore((state) => state.sentenceFavorites);
  const removeFavorite = useAppStore((state) => state.removeFavorite);
  const removeFavoriteVideos = useAppStore((state) => state.removeFavorites);
  const removeSentenceFavorite = useAppStore((state) => state.removeSentenceFavorite);
  const removeSentenceFavorites = useAppStore((state) => state.removeSentenceFavorites);
  const [tab, setTab] = useState<FavoriteTab>('video');
  const [manage, setManage] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const tabs: Array<{ id: FavoriteTab; label: string; count: number }> = [
    { id: 'video', label: '视频', count: favorites.length },
    { id: 'sentence', label: '句子', count: sentenceFavorites.length },
  ];

  const currentIds =
    tab === 'video'
      ? favorites.map((item) => item.videoId)
      : sentenceFavorites.map((item) => item.id);
  const manageAvailable = currentIds.length > 0;
  const allSelected = currentIds.length > 0 && selectedIds.size === currentIds.length;

  const exitManage = () => {
    setManage(false);
    setSelectedIds(new Set());
  };

  const toggleManage = () => {
    if (manage) {
      exitManage();
      return;
    }
    setSelectedIds(new Set());
    setManage(true);
  };

  const changeTab = (next: FavoriteTab) => {
    if (next === tab) return;
    setTab(next);
    exitManage();
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(currentIds));
  };

  const confirmDelete = () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const kind = tab;
    Alert.alert(
      kind === 'video' ? '删除收藏视频' : '删除收藏句子',
      `确定删除选中的 ${ids.length} 项吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            if (kind === 'video') removeFavoriteVideos(ids);
            else removeSentenceFavorites(ids);
            exitManage();
          },
        },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader
        title="我的收藏"
        subtitle={
          manage
            ? `已选 ${selectedIds.size} 项`
            : `${favorites.length} 个视频 · ${sentenceFavorites.length} 个句子`
        }
        right={
          manageAvailable ? (
            <Pressable
              hitSlop={8}
              onPress={toggleManage}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text
                style={{
                  color: manage ? theme.colors.primary : theme.colors.textSecondary,
                  fontSize: 13,
                  fontWeight: '700',
                }}
              >
                {manage ? '完成' : '管理'}
              </Text>
            </Pressable>
          ) : null
        }
      />

      <View style={styles.tabRow}>
        {tabs.map((item) => {
          const active = tab === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => changeTab(item.id)}
              style={[
                styles.tab,
                {
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: active ? theme.colors.primary : theme.colors.textSecondary,
                    fontWeight: active ? '800' : '600',
                  },
                ]}
              >
                {item.label} {item.count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'video' ? (
        <FlatList
          style={{ flex: 1 }}
          data={favorites}
          keyExtractor={(item) => item.videoId}
          contentContainerStyle={[
            styles.listContent,
            manage && { paddingBottom: 100 + insets.bottom },
          ]}
          renderItem={({ item }) => {
            const selected = selectedIds.has(item.videoId);
            return (
              <Pressable
                accessibilityState={manage ? { selected } : undefined}
                onPress={() => {
                  if (manage) {
                    toggleSelection(item.videoId);
                    return;
                  }
                  router.push({
                    pathname: '/player',
                    params: { videoId: item.videoId, title: item.title, author: item.author },
                  } as any);
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
              >
                <View
                  style={[
                    styles.videoCard,
                    {
                      backgroundColor: theme.colors.card,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.thumb,
                      { backgroundColor: theme.colors.surfaceAlt },
                    ]}
                  >
                    {item.thumbnail ? (
                      <Image
                        source={{ uri: item.thumbnail }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={180}
                      />
                    ) : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={[styles.videoTitle, { color: theme.colors.text }]}
                      numberOfLines={2}
                    >
                      {item.title}
                    </Text>
                    <Text
                      style={[styles.videoMeta, { color: theme.colors.textTertiary }]}
                      numberOfLines={1}
                    >
                      {item.author}
                    </Text>
                  </View>
                  {manage ? (
                    <SelectionCircle selected={selected} />
                  ) : (
                    <Pressable
                      onPress={() => removeFavorite(item.videoId)}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.removeButton,
                        {
                          backgroundColor: theme.colors.primarySoft,
                          opacity: pressed ? 0.6 : 1,
                        },
                      ]}
                    >
                      <Ionicons name="bookmark" size={17} color={theme.colors.primary} />
                    </Pressable>
                  )}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="bookmark-outline"
              title="还没有收藏视频"
              desc="播放器底部点书签，喜欢的视频会留在这里。"
            />
          }
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={sentenceFavorites}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            manage && { paddingBottom: 100 + insets.bottom },
          ]}
          renderItem={({ item }) => {
            const selected = selectedIds.has(item.id);
            return (
              <Pressable
                accessibilityState={manage ? { selected } : undefined}
                onPress={() => {
                  if (manage) {
                    toggleSelection(item.id);
                    return;
                  }
                  router.push({
                    pathname: '/player',
                    params: {
                      videoId: item.videoId,
                      title: item.videoTitle,
                      author: item.videoAuthor,
                    },
                  } as any);
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
              >
                <View
                  style={[
                    styles.sentenceCard,
                    {
                      backgroundColor: theme.colors.card,
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <View
                    style={[styles.sentenceIcon, { backgroundColor: theme.colors.primarySoft }]}
                  >
                    <Ionicons name="heart" size={18} color={theme.colors.primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={[styles.sentenceText, { color: theme.colors.text }]}
                      numberOfLines={2}
                    >
                      {item.text}
                    </Text>
                    {item.translation ? (
                      <Text
                        style={[styles.sentenceTranslation, { color: theme.colors.textSecondary }]}
                        numberOfLines={2}
                      >
                        {item.translation}
                      </Text>
                    ) : null}
                    <Text
                      style={[styles.sentenceMeta, { color: theme.colors.textTertiary }]}
                      numberOfLines={1}
                    >
                      {item.videoTitle} · {formatTime(item.start)}
                    </Text>
                  </View>
                  {manage ? (
                    <SelectionCircle selected={selected} />
                  ) : (
                    <Pressable
                      onPress={() => removeSentenceFavorite(item.id)}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.removeButton,
                        {
                          backgroundColor: theme.colors.primarySoft,
                          opacity: pressed ? 0.6 : 1,
                        },
                      ]}
                    >
                      <Ionicons name="heart-dislike-outline" size={17} color={theme.colors.primary} />
                    </Pressable>
                  )}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="chatbubble-ellipses-outline"
              title="还没有收藏句子"
              desc="字幕稿里当前播放的句子会出现爱心，点一下就收藏。"
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {manage ? (
        <ManageBar
          selectedCount={selectedIds.size}
          allSelected={allSelected}
          onToggleAll={toggleAll}
          onDelete={confirmDelete}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
  },
  tab: {
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: { fontSize: 12.5 },
  listContent: { paddingHorizontal: 18, paddingBottom: 30, flexGrow: 1 },
  videoCard: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 16,
    padding: 10,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  thumb: { width: 112, aspectRatio: 16 / 9, borderRadius: 10, overflow: 'hidden' },
  videoTitle: { fontSize: 13.5, fontWeight: '700', lineHeight: 19 },
  videoMeta: { fontSize: 11, marginTop: 4 },
  sentenceCard: {
    flexDirection: 'row',
    gap: 11,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sentenceIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  sentenceText: { fontSize: 13.5, fontWeight: '700', lineHeight: 19 },
  sentenceTranslation: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  sentenceMeta: { fontSize: 10.5, marginTop: 7 },
  removeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
