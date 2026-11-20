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
import { EmptyState, PrimaryButton } from '../src/ui/components';
import { useAppTheme } from '../src/ui/theme';

const ROW_HEIGHT = 74;

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function CheckCircle({ checked }: { checked: boolean }) {
  const theme = useAppTheme();
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: checked ? 0 : 1.5,
        borderColor: theme.colors.borderStrong,
        backgroundColor: checked ? theme.colors.primary : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
    </View>
  );
}

function SortableRow({
  item,
  index,
  count,
  manageMode,
  selected,
  onToggle,
  onMove,
  onOpen,
}: {
  item: Subscription;
  index: number;
  count: number;
  manageMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onMove: (from: number, to: number) => void;
  onOpen: () => void;
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
        onStartShouldSetPanResponder: () => manageMode,
        onMoveShouldSetPanResponder: (_, gesture) =>
          manageMode && Math.abs(gesture.dy) > 4,
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
    [count, manageMode]
  );

  const subtitle =
    [item.subscriberCount, item.videoCount].filter(Boolean).join('  ·  ') ||
    item.handle ||
    '已订阅频道';

  return (
    <View
      style={{
        height: ROW_HEIGHT,
        zIndex: dragging ? 20 : 1,
        transform: [{ translateY: dragY }],
      }}
    >
      <Pressable
        onPress={manageMode ? onToggle : onOpen}
        style={{
          height: ROW_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          backgroundColor: dragging ? theme.colors.bgElevated : theme.colors.card,
          paddingHorizontal: 14,
          borderBottomWidth: index === count - 1 ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          shadowColor: '#000',
          shadowOpacity: dragging ? 0.2 : 0,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: dragging ? 6 : 0,
        }}
      >
        {manageMode ? (
          <View
            {...pan.panHandlers}
            style={{ width: 30, height: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="reorder-three-outline" size={24} color={theme.colors.textTertiary} />
          </View>
        ) : null}

        {item.avatar ? (
          <Image
            source={{ uri: item.avatar }}
            style={{ width: 54, height: 54, borderRadius: 27 }}
            contentFit="cover"
            transition={180}
          />
        ) : (
          <View
            style={{
              width: 54,
              height: 54,
              borderRadius: 27,
              backgroundColor: theme.colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.colors.primary, fontSize: 20, fontWeight: '900' }}>
              {item.title.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ color: theme.colors.text, fontSize: 16, fontWeight: '800' }}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <Text
            style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 4 }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        </View>
        {manageMode ? (
          <CheckCircle checked={selected} />
        ) : (
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: theme.colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="checkmark" size={16} color={theme.colors.primary} />
          </View>
        )}
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
  const removeSubscriptions = useAppStore((state) => state.removeSubscriptions);
  const reorderSubscriptions = useAppStore((state) => state.reorderSubscriptions);
  const [busy, setBusy] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!manageMode) setSelected(new Set());
  }, [manageMode]);

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
          setManageMode(false);
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
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 10,
          backgroundColor: theme.colors.bg,
        }}
      >
        <View style={{ height: 48, flexDirection: 'row', alignItems: 'center' }}>
          <Pressable
            onPress={() => (manageMode ? setManageMode(false) : router.back())}
            hitSlop={10}
            style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="arrow-back" size={23} color={theme.colors.text} />
          </Pressable>
          <Text
            style={{
              flex: 1,
              color: theme.colors.text,
              fontSize: 21,
              fontWeight: '900',
              textAlign: 'center',
              letterSpacing: -0.4,
            }}
          >
            {manageMode ? '批量管理' : '全部频道'}
          </Text>
          <Pressable
            onPress={() => setManageMode((value) => !value)}
            hitSlop={10}
            disabled={!subscriptions.length}
            style={{
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: subscriptions.length ? 1 : 0.35,
            }}
          >
            {manageMode ? (
              <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '800' }}>
                完成
              </Text>
            ) : (
              <Ionicons name="options-outline" size={22} color={theme.colors.text} />
            )}
          </Pressable>
        </View>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 11.5,
            textAlign: 'center',
            marginTop: -2,
          }}
        >
          {manageMode
            ? `已选择 ${selected.size} / ${subscriptions.length}`
            : `${subscriptions.length} 个频道 · 右上角管理`}
        </Text>
        {manageMode ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 12,
            }}
          >
            <Pressable onPress={toggleSelectAll} hitSlop={8}>
              <Text style={{ color: theme.colors.primary, fontSize: 12.5, fontWeight: '700' }}>
                {selected.size === subscriptions.length ? '取消全选' : '全选'}
              </Text>
            </Pressable>
            <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
              拖动左侧手柄排序
            </Text>
          </View>
        ) : null}
      </View>

      <FlatList
        data={subscriptions}
        keyExtractor={(item) => item.channelId}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: manageMode ? 110 : 36,
          flexGrow: 1,
        }}
        ListHeaderComponent={
          subscriptions.length ? (
            <View
              style={{
                borderRadius: 16,
                overflow: 'hidden',
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.card,
              }}
            />
          ) : undefined
        }
        renderItem={({ item, index }) => (
          <View
            style={
              index === 0
                ? {
                    backgroundColor: theme.colors.card,
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                    overflow: 'hidden',
                  }
                : index === subscriptions.length - 1
                  ? {
                      backgroundColor: theme.colors.card,
                      borderBottomLeftRadius: 16,
                      borderBottomRightRadius: 16,
                      overflow: 'hidden',
                    }
                  : { backgroundColor: theme.colors.card }
            }
          >
            <SortableRow
              item={item}
              index={index}
              count={subscriptions.length}
              manageMode={manageMode}
              selected={selected.has(item.channelId)}
              onToggle={() => toggleSelected(item.channelId)}
              onMove={move}
              onOpen={() =>
                router.push({
                  pathname: '/channel',
                  params: {
                    channelId: item.channelId,
                    title: item.title,
                    avatar: item.avatar ?? '',
                    handle: item.handle ?? '',
                    subscribers: item.subscriberCount ?? '',
                    videos: item.videoCount ?? '',
                  },
                } as any)
              }
            />
          </View>
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
        ListFooterComponent={
          subscriptions.length ? (
            <View style={{ alignItems: 'center', paddingTop: 20, gap: 8 }}>
              <Pressable onPress={importCsv} hitSlop={8}>
                <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5 }}>
                  从 CSV 导入
                </Text>
              </Pressable>
              <Pressable onPress={exportCsv} hitSlop={8}>
                <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5 }}>
                  导出 CSV{busy ? '（处理中…）' : ''}
                </Text>
              </Pressable>
            </View>
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
      />

      {manageMode && selected.size ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingBottom: Math.max(12, insets.bottom),
            paddingTop: 12,
            paddingHorizontal: 16,
            backgroundColor: theme.colors.bgElevated,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
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
              paddingHorizontal: 20,
              height: 42,
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
