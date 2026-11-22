import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../src/core/store';
import { relativeTime } from '../src/core/utils';
import { CONTINUOUS_CORNER, RADIUS } from '../src/tokens';
import { appAlert as Alert } from '../src/ui/app-alert';
import { AppPressable } from '../src/ui/app-pressable';
import { ManageBar, NavHeader, SelectionCircle } from '../src/ui/components';
import { useAppTheme } from '../src/ui/theme';

const Pressable = AppPressable;

export default function HistoryScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const history = useAppStore((state) => state.history);
  const removeHistory = useAppStore((state) => state.removeHistory);
  const [manage, setManage] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

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

  const toggleSelection = (videoId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  };

  const allSelected = history.length > 0 && selectedIds.size === history.length;

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(history.map((item) => item.videoId)));
  };

  const confirmDelete = () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    Alert.alert('删除历史记录', `确定删除选中的 ${ids.length} 条观看记录吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          removeHistory(ids);
          exitManage();
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader
        title="历史记录"
        subtitle={
          manage
            ? `已选 ${selectedIds.size} 项`
            : `${history.length} 个最近打开的视频`
        }
        right={
          history.length ? (
            <Pressable
              hitSlop={8}
              onPress={toggleManage}
              feedback="opacity"
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
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: manage ? 100 + insets.bottom : 40,
        }}
      >
        {history.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={40} color={theme.colors.textTertiary} />
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '800', marginTop: 12 }}>
              还没有观看记录
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 6, textAlign: 'center' }}>
              打开过的视频会自动出现在这里，方便继续学习。
            </Text>
          </View>
        ) : (
          history.map((item) => {
            const selected = selectedIds.has(item.videoId);
            return (
              <Pressable
                key={item.videoId}
                accessibilityState={manage ? { selected } : undefined}
                feedback={manage ? 'opacity' : 'ripple'}
                radius={0}
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
                style={styles.row}
              >
                <Image
                  source={{ uri: item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg` }}
                  style={styles.thumb as any}
                  contentFit="cover"
                  transition={160}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700', lineHeight: 19 }} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 5 }} numberOfLines={1}>
                    {item.author || 'YouTube'}
                  </Text>
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 10.5, marginTop: 4 }}>
                    最近观看 {relativeTime(item.lastWatchedAt ?? item.savedAt)}
                  </Text>
                </View>
                {manage ? (
                  <SelectionCircle selected={selected} />
                ) : (
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={theme.colors.textTertiary}
                    style={{ alignSelf: 'center' }}
                  />
                )}
              </Pressable>
            );
          })
        )}
      </ScrollView>

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
  thumb: { width: 132, aspectRatio: 16 / 9, borderRadius: RADIUS.control, ...CONTINUOUS_CORNER, backgroundColor: '#241C33' },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 10 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 30 },
});
