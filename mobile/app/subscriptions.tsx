import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../src/core/store';
import { Subscription } from '../src/core/types';
import { parseTakeoutCsv } from '../src/core/youtube/channel';
import { EmptyState, GhostButton, IconButton, NavHeader, PrimaryButton } from '../src/ui/components';
import { useAppTheme } from '../src/ui/theme';

const ROW_HEIGHT = 78;

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function CheckBox({ checked }: { checked: boolean }) {
  const theme = useAppTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1.5,
        borderColor: checked ? theme.colors.primary : theme.colors.borderStrong,
        backgroundColor: checked ? theme.colors.primary : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
    </View>
  );
}

function SortableRow({
  item,
  index,
  count,
  selectMode,
  selected,
  onToggle,
  onMove,
  onRemove,
}: {
  item: Subscription;
  index: number;
  count: number;
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  const theme = useAppTheme();
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const indexRef = useRef(index);
  indexRef.current = index;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !selectMode,
        onMoveShouldSetPanResponder: (_, gesture) =>
          !selectMode && Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => setDragging(true),
        onPanResponderMove: (_, gesture) => setDragY(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          const target = Math.max(
            0,
            Math.min(count - 1, indexRef.current + Math.round(gesture.dy / ROW_HEIGHT))
          );
          if (target !== indexRef.current) onMoveRef.current(indexRef.current, target);
          setDragY(0);
          setDragging(false);
        },
        onPanResponderTerminate: () => {
          setDragY(0);
          setDragging(false);
        },
      }),
    [count, selectMode]
  );

  return (
    <View
      style={{
        height: ROW_HEIGHT,
        marginBottom: 8,
        zIndex: dragging ? 20 : 1,
        transform: [{ translateY: dragY }],
      }}
    >
      <Pressable
        onPress={selectMode ? onToggle : undefined}
        style={{
          height: ROW_HEIGHT - 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          backgroundColor: dragging ? theme.colors.bgElevated : theme.colors.card,
          borderRadius: 16,
          paddingHorizontal: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: dragging ? theme.colors.primary : theme.colors.border,
          shadowColor: '#000',
          shadowOpacity: dragging ? 0.25 : 0,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
          elevation: dragging ? 6 : 0,
        }}
      >
        {selectMode ? <CheckBox checked={selected} /> : null}
        {item.avatar ? (
          <Image
            source={{ uri: item.avatar }}
            style={{ width: 42, height: 42, borderRadius: 21 }}
            contentFit="cover"
            transition={180}
          />
        ) : (
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: theme.colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.colors.primary, fontSize: 16, fontWeight: '800' }}>
              {item.title.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: theme.colors.text, fontSize: 14.5, fontWeight: '700' }} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 3 }} numberOfLines={1}>
            {item.handle ?? item.channelId}
          </Text>
        </View>
        {!selectMode ? (
          <View {...pan.panHandlers} style={{ width: 38, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="reorder-three-outline" size={25} color={theme.colors.textTertiary} />
          </View>
        ) : null}
        {!selectMode ? (
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 34,
              height: 34,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.surfaceAlt,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="trash-outline" size={17} color={theme.colors.danger} />
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
}

export default function SubscriptionsScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const subscriptions = useAppStore((state) => state.subscriptions);
  const addSubscriptions = useAppStore((state) => state.addSubscriptions);
  const removeSubscription = useAppStore((state) => state.removeSubscription);
  const removeSubscriptions = useAppStore((state) => state.removeSubscriptions);
  const reorderSubscriptions = useAppStore((state) => state.reorderSubscriptions);
  const [busy, setBusy] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selectMode) setSelected(new Set());
  }, [selectMode]);

  const importCsv = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      const content = await FileSystem.readAsStringAsync(asset.uri);
      const parsed = parseTakeoutCsv(content);
      const before = new Set(subscriptions.map((sub) => sub.channelId));
      const fresh = parsed.filter((sub) => !before.has(sub.channelId));
      addSubscriptions(parsed);
      Alert.alert('导入完成', `识别 ${parsed.length} 个频道，其中新增 ${fresh.length} 个。`);
    } catch (error) {
      Alert.alert('导入失败', error instanceof Error ? error.message : String(error));
    }
  };

  const exportCsv = async () => {
    if (!subscriptions.length) {
      Alert.alert('还没有订阅', '先添加频道再导出。');
      return;
    }
    setBusy(true);
    try {
      const header = 'Channel ID,Channel Title,Channel URL';
      const lines = subscriptions.map((sub) => {
        const url = sub.handle
          ? `https://www.youtube.com/${sub.handle}`
          : `https://www.youtube.com/channel/${sub.channelId}`;
        return [sub.channelId, sub.title, url].map(csvEscape).join(',');
      });
      const csv = [header, ...lines].join('\n');
      const path = `${FileSystem.cacheDirectory}kiss-subscriptions.csv`;
      await FileSystem.writeAsStringAsync(path, csv);
      await Sharing.shareAsync(path, {
        mimeType: 'text/csv',
        dialogTitle: '导出 Kissly 订阅',
        UTI: 'public.comma-separated-values-text',
      });
    } catch (error) {
      Alert.alert('导出失败', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = (sub: Subscription) => {
    Alert.alert('取消订阅', `不再在首页显示「${sub.title}」？同步后其他设备也会移除。`, [
      { text: '取消', style: 'cancel' },
      { text: '移除', style: 'destructive', onPress: () => removeSubscription(sub.channelId) },
    ]);
  };

  const toggleSelected = (channelId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((current) =>
      current.size === subscriptions.length
        ? new Set()
        : new Set(subscriptions.map((sub) => sub.channelId))
    );
  };

  const confirmBatchRemove = () => {
    if (!selected.size) return;
    Alert.alert('批量取消订阅', `确定移除选中的 ${selected.size} 个频道？其他设备同步后也会移除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => {
          removeSubscriptions(Array.from(selected));
          setSelectMode(false);
        },
      },
    ]);
  };

  const move = (from: number, to: number) => {
    const items = [...subscriptions];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    reorderSubscriptions(items);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader
        title="订阅管理"
        subtitle={
          selectMode
            ? `已选择 ${selected.size} / ${subscriptions.length} 个频道`
            : `${subscriptions.length} 个频道 · 拖动右侧手柄排序`
        }
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {subscriptions.length ? (
              <Pressable onPress={() => setSelectMode((value) => !value)} hitSlop={8}>
                <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '700' }}>
                  {selectMode ? '完成' : '管理'}
                </Text>
              </Pressable>
            ) : null}
            {!selectMode ? (
              <IconButton
                name="add"
                bg={theme.colors.primary}
                color="#fff"
                onPress={() => router.push('/add-subscription' as any)}
              />
            ) : (
              <Pressable onPress={toggleSelectAll} hitSlop={8}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>
                  {selected.size === subscriptions.length ? '取消全选' : '全选'}
                </Text>
              </Pressable>
            )}
          </View>
        }
      />
      <FlatList
        data={subscriptions}
        keyExtractor={(item) => item.channelId}
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingBottom: selectMode ? 100 : 30,
          flexGrow: 1,
        }}
        ListHeaderComponent={
          selectMode ? (
            <View />
          ) : (
            <View style={{ gap: 12, marginBottom: 16 }}>
              <View
                style={{
                  backgroundColor: theme.colors.card,
                  borderRadius: 18,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                  padding: 16,
                }}
              >
                <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>
                  把订阅带走
                </Text>
                <Text style={{ color: theme.colors.textTertiary, fontSize: 12, lineHeight: 18, marginBottom: 14 }}>
                  CSV 导入/导出；WebDAV 会同步新增、删除和手动排序。
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <GhostButton label="导入 CSV" icon="download-outline" onPress={importCsv} />
                  <GhostButton label="导出 CSV" icon="share-outline" onPress={exportCsv} />
                  {busy ? (
                    <Text style={{ color: theme.colors.textTertiary, fontSize: 11, alignSelf: 'center' }}>
                      处理中…
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <SortableRow
            item={item}
            index={index}
            count={subscriptions.length}
            selectMode={selectMode}
            selected={selected.has(item.channelId)}
            onToggle={() => toggleSelected(item.channelId)}
            onMove={move}
            onRemove={() => confirmRemove(item)}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="albums-outline"
            title="还没有订阅"
            desc="添加频道，或用 YouTube Takeout 的 CSV 一次性导入。"
            action={
              <PrimaryButton
                label="添加第一个频道"
                icon="add"
                onPress={() => router.push('/add-subscription' as any)}
                style={{ width: 210 }}
              />
            }
          />
        }
        showsVerticalScrollIndicator={false}
      />
      {selectMode && selected.size ? (
        <View
          style={{
            position: 'absolute',
            left: 18,
            right: 18,
            bottom: Math.max(18, insets.bottom + 10),
            backgroundColor: theme.colors.bgElevated,
            borderRadius: 18,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            padding: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
          }}
        >
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, flex: 1 }}>
            已选 {selected.size} 个频道
          </Text>
          <Pressable
            onPress={confirmBatchRemove}
            style={{
              backgroundColor: theme.colors.danger,
              borderRadius: 12,
              paddingHorizontal: 18,
              height: 40,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>批量删除</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
