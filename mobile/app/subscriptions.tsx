import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../src/core/store';
import { Subscription } from '../src/core/types';
import { parseTakeoutCsv } from '../src/core/youtube/takeout';
import { CONTINUOUS_CORNER, RADIUS } from '../src/tokens';
import { appAlert } from '../src/ui/app-alert';
import { toast } from '../src/ui/app-toast';
import { AppPressable } from '../src/ui/app-pressable';
import { EmptyState, PrimaryButton } from '../src/ui/components';
import { RipplePressable } from '../src/ui/ripple-pressable';
import { useAppTheme } from '../src/ui/theme';

const Pressable = AppPressable;

const ROW_HEIGHT = 74;
const SWIPE_ACTION_WIDTH = 144;
const SWIPE_ACTION_BUTTON_WIDTH = 68;
const AUTO_SCROLL_EDGE = 82;
const CHECKBOX_GAP = 38;
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
const DragStateContext = createContext<{
  from: number | null;
  to: number | null;
}>({ from: null, to: null });

function DragCell({ children, index, style, ...props }: any) {
  const drag = useContext(DragStateContext);
  const isSource = drag.from === index;
  let zIndex = 0;
  let shift = 0;
  if (isSource) {
    zIndex = 100;
  } else if (drag.from !== null && drag.to !== null && drag.from !== drag.to) {
    if (drag.from < drag.to && index > drag.from && index <= drag.to) {
      zIndex = 2;
      shift = -ROW_HEIGHT;
    } else if (drag.from > drag.to && index >= drag.to && index < drag.from) {
      zIndex = 2;
      shift = ROW_HEIGHT;
    }
  }

  return (
    <View
      {...props}
      style={[
        style,
        {
          zIndex,
          elevation: zIndex ? 2 : 0,
          overflow: 'visible',
          ...(shift ? { transform: [{ translateY: shift }] } : null),
        },
      ]}
    >
      {children}
    </View>
  );
}

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
        borderRadius: RADIUS.pill,
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

function subscriptionSubtitle(item: Subscription) {
  return (
    [
      item.subscriberCount ? `${item.subscriberCount} 订阅者` : null,
      item.videoCount ? `${item.videoCount} 视频` : null,
    ]
      .filter(Boolean)
      .join('  ·  ') ||
    item.handle ||
    '已订阅频道'
  );
}

function DragGhost({
  item,
  selected,
  translateY,
}: {
  item: Subscription;
  selected: boolean;
  translateY: Animated.Value;
}) {
  const theme = useAppTheme();
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 16,
        right: 16,
        height: ROW_HEIGHT,
        zIndex: 1000,
        elevation: 30,
        transform: [{ translateY }],
      }}
    >
      <View
        style={{
          height: ROW_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 14,
          borderRadius: RADIUS.card,
          ...CONTINUOUS_CORNER,
          backgroundColor: theme.colors.bgElevated,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          shadowColor: '#000',
          shadowOpacity: 0.26,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
          elevation: 30,
        }}
      >
        <View style={{ marginLeft: CHECKBOX_GAP }}>
          {item.avatar ? (
            <Image
              source={{ uri: item.avatar }}
              style={{ width: 54, height: 54, borderRadius: RADIUS.pill } as any}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: theme.colors.primarySoft }]}>
              <Text style={{ color: theme.colors.primary, fontSize: 20, fontWeight: '900' }}>
                {item.title.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <View pointerEvents="none" style={styles.manageCheckbox}>
          <CheckCircle checked={selected} />
        </View>
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
            {subscriptionSubtitle(item)}
          </Text>
        </View>
        <View
          style={{ width: 30, height: 48, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="reorder-three-outline" size={24} color={theme.colors.textTertiary} />
        </View>
      </View>
    </Animated.View>
  );
}

function SortableRow({
  item,
  index,
  count,
  manageMode,
  selected,
  openSwipe,
  canDrag,
  hidden,
  onToggle,
  onSwipeOpen,
  onSwipeClose,
  onPin,
  onDelete,
  onOpen,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: {
  item: Subscription;
  index: number;
  count: number;
  manageMode: boolean;
  selected: boolean;
  openSwipe: boolean;
  canDrag: boolean;
  hidden: boolean;
  onToggle: () => void;
  onSwipeOpen: () => void;
  onSwipeClose: () => void;
  onPin: () => void;
  onDelete: () => void;
  onOpen: () => void;
  onDragStart: (index: number, moveY: number) => void;
  onDragMove: (moveY: number) => void;
  onDragEnd: (from: number, dragY: number) => void;
  onDragCancel: () => void;
}) {
  const theme = useAppTheme();
  const dragYRef = useRef(0);
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const onDragCancelRef = useRef(onDragCancel);
  onDragCancelRef.current = onDragCancel;
  const indexRef = useRef(index);
  indexRef.current = index;
  const openSwipeRef = useRef(openSwipe);
  openSwipeRef.current = openSwipe;

  const swipeReveal = useRef(new Animated.Value(0)).current;
  const swipeProgressRef = useRef(0);
  const swipeDraggingRef = useRef(false);

  useEffect(() => {
    if (swipeDraggingRef.current) return;
    const target = openSwipe ? 1 : 0;
    swipeProgressRef.current = target;
    Animated.spring(swipeReveal, {
      toValue: target,
      useNativeDriver: true,
      speed: 24,
      bounciness: 0,
    }).start();
  }, [openSwipe, swipeReveal]);

  const swipePan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          !manageMode &&
          Math.abs(gesture.dx) > 6 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 0.8,
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          !manageMode &&
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 0.8,
        onPanResponderGrant: () => {
          swipeDraggingRef.current = true;
          swipeReveal.stopAnimation();
          swipeProgressRef.current = openSwipeRef.current ? 1 : 0;
        },
        onPanResponderMove: (_, gesture) => {
          const base = openSwipeRef.current ? 1 : 0;
          const next = Math.max(
            0,
            Math.min(1, base + -gesture.dx / SWIPE_ACTION_WIDTH)
          );
          swipeProgressRef.current = next;
          swipeReveal.setValue(next);
        },
        onPanResponderRelease: (_, gesture) => {
          const progress = swipeProgressRef.current;
          const shouldOpen = progress > 0.35 || gesture.vx < -0.4;
          swipeDraggingRef.current = false;
          const target = shouldOpen ? 1 : 0;
          swipeProgressRef.current = target;
          Animated.spring(swipeReveal, {
            toValue: target,
            useNativeDriver: true,
            speed: 24,
            bounciness: 0,
          }).start();
          if (shouldOpen) onSwipeOpen();
          else onSwipeClose();
        },
        onPanResponderTerminate: () => {
          swipeDraggingRef.current = false;
          const target = openSwipeRef.current ? 1 : 0;
          Animated.spring(swipeReveal, {
            toValue: target,
            useNativeDriver: true,
            speed: 24,
            bounciness: 0,
          }).start();
        },
      }),
    [manageMode, onSwipeClose, onSwipeOpen, swipeReveal]
  );

  const dragPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canDrag,
        onStartShouldSetPanResponderCapture: () => canDrag,
        onMoveShouldSetPanResponder: (_, gesture) =>
          canDrag && Math.abs(gesture.dy) > 4,
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          canDrag && Math.abs(gesture.dy) > 4,
        // iOS 的 ScrollView 会在纵向移动时请求接管手势；默认允许会让拖动
        // 中途被滚动抢走，行也会回弹。拖动期间必须拒绝这次接管。
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (_, gesture) => {
          onDragStartRef.current(indexRef.current, gesture.y0 || gesture.moveY);
        },
        onPanResponderMove: (_, gesture) => {
          dragYRef.current = gesture.dy;
          onDragMoveRef.current(gesture.moveY);
        },
        onPanResponderRelease: () => {
          onDragEndRef.current(indexRef.current, dragYRef.current);
          dragYRef.current = 0;
        },
        onPanResponderTerminate: () => {
          dragYRef.current = 0;
          onDragCancelRef.current();
        },
      }),
    [canDrag]
  );

  return (
    <Animated.View
      style={{
        height: ROW_HEIGHT,
        position: 'relative',
        opacity: hidden ? 0 : 1,
      }}
    >
      {!manageMode ? (
        <Animated.View
          key="swipe-actions"
          pointerEvents={openSwipe ? 'auto' : 'none'}
          style={[
            styles.swipeActions,
            {
              opacity: swipeReveal,
              transform: [
                {
                  translateX: swipeReveal.interpolate({
                    inputRange: [0, 1],
                    outputRange: [24, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Pressable
            onPress={() => {
              onSwipeClose();
              onPin();
            }}
            disabled={index === 0}
            accessibilityLabel="置顶频道"
            style={[
              styles.swipeAction,
              {
                backgroundColor: theme.colors.primarySoft,
                opacity: index === 0 ? 0.38 : 1,
              },
            ]}
          >
            <Ionicons name="arrow-up" size={19} color={theme.colors.primary} />
            <Text style={[styles.swipeActionLabel, { color: theme.colors.primary }]}>
              置顶
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              onSwipeClose();
              onDelete();
            }}
            accessibilityLabel="取消订阅"
            tone="onColor"
            style={[
              styles.swipeAction,
              {
                backgroundColor: theme.colors.danger,
              },
            ]}
          >
            <Ionicons name="trash-outline" size={19} color="#FFFFFF" />
            <Text style={[styles.swipeActionLabel, { color: '#FFFFFF' }]}>删除</Text>
          </Pressable>
        </Animated.View>
      ) : null}

      <Animated.View
        key="subscription-row"
        {...swipePan.panHandlers}
        style={{
          height: ROW_HEIGHT,
          zIndex: 2,
        }}
      >
        <Pressable
          feedback="opacity"
          onPress={() => {
            if (openSwipe) {
              onSwipeClose();
              return;
            }
            if (manageMode) onToggle();
            else onOpen();
          }}
          accessibilityLabel={
            manageMode
              ? `${item.title}，${selected ? '已选择' : '未选择'}`
              : item.title
          }
          style={{
            height: ROW_HEIGHT,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: theme.colors.card,
            paddingHorizontal: 14,
            borderTopLeftRadius: index === 0 ? RADIUS.card : 0,
            borderTopRightRadius: index === 0 ? RADIUS.card : 0,
            borderBottomLeftRadius: index === count - 1 ? RADIUS.card : 0,
            borderBottomRightRadius: index === count - 1 ? RADIUS.card : 0,
            ...CONTINUOUS_CORNER,
            borderBottomWidth: index === count - 1 ? 0 : StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
          }}
        >
          {/* 头像始终是第一个子节点，只移动外层容器；如果直接把勾选框插到
              头像前面，React 会重建 Image，进入管理态时头像会闪一下。 */}
          <View style={manageMode ? { marginLeft: CHECKBOX_GAP } : null}>
            {item.avatar ? (
              <Image
                source={{ uri: item.avatar }}
                style={{ width: 54, height: 54, borderRadius: RADIUS.pill } as any}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: theme.colors.primarySoft }]}>
                <Text style={{ color: theme.colors.primary, fontSize: 20, fontWeight: '900' }}>
                  {item.title.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          {manageMode ? (
            <View pointerEvents="none" style={styles.manageCheckbox}>
              <CheckCircle checked={selected} />
            </View>
          ) : null}
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
              {subscriptionSubtitle(item)}
            </Text>
          </View>

          {manageMode ? (
            <View
              {...dragPan.panHandlers}
              accessibilityLabel="拖动排序手柄"
              style={{ width: 30, height: 48, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons
                name="reorder-three-outline"
                size={24}
                color={canDrag ? theme.colors.textTertiary : theme.colors.borderStrong}
              />
            </View>
          ) : (
            <View style={[styles.subscribedMark, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="checkmark" size={16} color={theme.colors.primary} />
            </View>
          )}
        </Pressable>
      </Animated.View>
    </Animated.View>
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
  const [manageMode, setManageMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);
  // The stack slide is native; mounting 10 heavy swipe/drag rows on the JS
  // thread at the same time drops its frames. Let the slide finish first.
  const [listReady, setListReady] = useState(false);

  useEffect(() => {
    // Let the native stack slide finish before mounting heavy rows.
    const timer = setTimeout(() => setListReady(true), 360);
    return () => clearTimeout(timer);
  }, []);

  const listRef = useRef<FlatList<Subscription>>(null);
  const listMetricsRef = useRef({ top: 0, height: 0, contentHeight: 0 });
  const scrollOffsetRef = useRef(0);
  const dragRef = useRef<{
    index: number;
    pointerY: number;
    startPointerY: number;
    startScroll: number;
    count: number;
    grabOffset: number;
  } | null>(null);
  const dragTargetRef = useRef<number | null>(null);
  const dragGhostY = useRef(new Animated.Value(0)).current;
  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchInputRef = useRef<any>(null);
  const searchAnim = useRef(new Animated.Value(0)).current;

  const searchActive = query.trim().length > 0;
  const filteredSubscriptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return subscriptions;
    return subscriptions.filter((item) =>
      [item.title, item.handle, item.channelId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [query, subscriptions]);

  const dragState = useMemo(
    () => ({ from: dragIndex, to: dragTargetIndex }),
    [dragIndex, dragTargetIndex]
  );
  const selectedKey = useMemo(() => Array.from(selected).join('|'), [selected]);
  // 刻意不把 dragTargetIndex 放进 extraData：让位动画由 DragCell 通过
  // DragStateContext 单独驱动，避免每跨过一行就重渲染全部 118 行。
  const listExtraData = `${dragIndex ?? -1}|${swipeOpenId ?? ''}|${
    manageMode ? 1 : 0
  }|${searchActive ? 1 : 0}|${selectedKey}|${listReady ? 1 : 0}`;

  const stopAutoScroll = () => {
    if (autoScrollRef.current) {
      clearInterval(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  };

  const updateDragTarget = (pointerY?: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const y = pointerY && pointerY > 0 ? pointerY : drag.pointerY;
    // 用拖动起点做相对计算，而不是 pointerY 的绝对屏幕坐标。
    // FlatList 在数据重排/重新挂载时可能把内容偏移悄悄归零，而 onScroll
    // 不一定补发事件，绝对算法会沿用旧的 scrollOffset，导致目标行算错。
    const delta =
      y - drag.startPointerY + (scrollOffsetRef.current - drag.startScroll);
    const target = clamp(
      drag.index + Math.round(delta / ROW_HEIGHT),
      0,
      drag.count - 1
    );
    if (target === dragTargetRef.current) return;
    dragTargetRef.current = target;
    setDragTargetIndex(target);
  };

  const tickAutoScroll = () => {
    const drag = dragRef.current;
    if (!drag) return;
    const { top, height, contentHeight } = listMetricsRef.current;
    if (!height || contentHeight <= height) return;

    const edge = Math.min(AUTO_SCROLL_EDGE, height / 3);
    let step = 0;
    if (drag.pointerY < top + edge) {
      const intensity = Math.min(1, (top + edge - drag.pointerY) / edge);
      step = -Math.round(4 + intensity * 10);
    } else if (drag.pointerY > top + height - edge) {
      const intensity = Math.min(
        1,
        (drag.pointerY - (top + height - edge)) / edge
      );
      step = Math.round(4 + intensity * 10);
    }
    if (!step) return;

    const maxOffset = Math.max(0, contentHeight - height);
    const next = Math.max(0, Math.min(maxOffset, scrollOffsetRef.current + step));
    if (next === scrollOffsetRef.current) return;
    scrollOffsetRef.current = next;
    listRef.current?.scrollToOffset({ offset: next, animated: false });
    updateDragTarget();
  };

  const startAutoScroll = (index: number, pointerY: number) => {
    stopAutoScroll();
    const fallbackY =
      listMetricsRef.current.top + listMetricsRef.current.height / 2;
    // 手柄在行内垂直居中，固定抓取半个行高，避免依赖可能过期的
    // scrollOffset 去反推行顶位置。
    const grabOffset = ROW_HEIGHT / 2;
    const startY = pointerY || fallbackY;
    dragRef.current = {
      index,
      pointerY: startY,
      startPointerY: startY,
      startScroll: scrollOffsetRef.current,
      count: filteredSubscriptions.length,
      grabOffset,
    };
    dragTargetRef.current = index;
    dragGhostY.setValue(
      clamp(
        startY - grabOffset,
        listMetricsRef.current.top,
        listMetricsRef.current.top +
          Math.max(0, listMetricsRef.current.height - ROW_HEIGHT)
      )
    );
    setDragIndex(index);
    setDragTargetIndex(index);
    setSwipeOpenId(null);
    autoScrollRef.current = setInterval(tickAutoScroll, 16);
  };

  const moveDragPointer = (pointerY: number) => {
    if (!dragRef.current || pointerY <= 0) return;
    dragRef.current.pointerY = pointerY;
    const metrics = listMetricsRef.current;
    dragGhostY.setValue(
      clamp(
        pointerY - dragRef.current.grabOffset,
        metrics.top,
        metrics.top + Math.max(0, metrics.height - ROW_HEIGHT)
      )
    );
    updateDragTarget(pointerY);
  };

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const items = [...subscriptions];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    reorderSubscriptions(items);
  };

  const cancelDrag = () => {
    stopAutoScroll();
    dragRef.current = null;
    dragTargetRef.current = null;
    setDragIndex(null);
    setDragTargetIndex(null);
  };

  const endDrag = (from: number, dragY: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    updateDragTarget(drag.pointerY);
    const fallback = clamp(
      drag.index +
        Math.round(
          (drag.pointerY -
            drag.startPointerY +
            (scrollOffsetRef.current - drag.startScroll)) /
            ROW_HEIGHT
        ),
      0,
      drag.count - 1
    );
    const target = dragTargetRef.current ?? fallback;
    cancelDrag();
    if (target !== from) move(from, target);
  };

  useEffect(() => () => stopAutoScroll(), []);

  useEffect(() => {
    setSwipeOpenId(null);
    if (!manageMode) {
      setSelected(new Set());
      cancelDrag();
    }
  }, [manageMode]);

  useEffect(() => {
    setSelected(new Set());
    setSwipeOpenId(null);
  }, [query]);

  useEffect(() => {
    const animation = Animated.timing(searchAnim, {
      toValue: searchOpen ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    });
    animation.start();
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    if (searchOpen) {
      focusTimer = setTimeout(() => searchInputRef.current?.focus(), 230);
    }
    return () => {
      animation.stop();
      if (focusTimer) clearTimeout(focusTimer);
    };
  }, [searchAnim, searchOpen]);

  const toggleSearch = () => {
    if (searchOpen) {
      setQuery('');
      setSearchOpen(false);
      setSelected(new Set());
    } else {
      setSearchOpen(true);
    }
  };

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
      toast.success(`导入完成：识别 ${parsed.length} 个频道，新增 ${fresh.length} 个`);
    } catch (error) {
      toast.error(
        `导入失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const exportCsv = async () => {
    if (!subscriptions.length) {
      toast.info('还没有订阅，先添加频道再导出');
      return;
    }
    setBusy(true);
    try {
      const header = 'Channel ID,Channel Title,Channel URL,Group';
      const lines = subscriptions.map((sub) => {
        const url = sub.handle
          ? `https://www.youtube.com/${sub.handle}`
          : `https://www.youtube.com/channel/${sub.channelId}`;
        return [sub.channelId, sub.title, url, sub.group ?? '']
          .map(csvEscape)
          .join(',');
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
      toast.error(
        `导出失败：${error instanceof Error ? error.message : String(error)}`
      );
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
      current.size === filteredSubscriptions.length
        ? new Set()
        : new Set(filteredSubscriptions.map((sub) => sub.channelId))
    );
  };

  const confirmBatchRemove = () => {
    if (!selected.size) return;
    appAlert.alert(
      '批量取消订阅',
      `确定移除选中的 ${selected.size} 个频道？其他设备同步后也会移除。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '移除',
          style: 'destructive',
          onPress: () => {
            removeSubscriptions(Array.from(selected));
            setManageMode(false);
          },
        },
      ]
    );
  };

  const confirmRemoveOne = (item: Subscription) => {
    appAlert.alert(
      '取消订阅',
      `确定移除「${item.title}」？其他设备同步后也会移除。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '移除',
          style: 'destructive',
          onPress: () => removeSubscription(item.channelId),
        },
      ]
    );
  };

  const pinToTop = (channelId: string) => {
    const from = subscriptions.findIndex((sub) => sub.channelId === channelId);
    if (from > 0) move(from, 0);
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
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable
              onPress={toggleSearch}
              hitSlop={8}
              accessibilityLabel={searchOpen ? '收起搜索' : '搜索频道'}
              style={{
                width: 38,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name={searchOpen ? 'chevron-up' : 'search-outline'}
                size={21}
                color={searchOpen ? theme.colors.primary : theme.colors.text}
              />
            </Pressable>
            <Pressable
              onPress={() => setManageMode((value) => !value)}
              hitSlop={10}
              accessibilityLabel={manageMode ? '退出批量管理' : '批量管理'}
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
            ? `已选择 ${selected.size} / ${filteredSubscriptions.length}`
            : searchActive
              ? `找到 ${filteredSubscriptions.length} / ${subscriptions.length} 个频道`
              : `${subscriptions.length} 个频道 · 右上角管理`}
        </Text>

        <Animated.View
          pointerEvents={searchOpen ? 'auto' : 'none'}
          style={{
            height: searchAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 48] }),
            opacity: searchAnim,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: 42,
              marginTop: 6,
              borderRadius: RADIUS.control,
              backgroundColor: theme.colors.surfaceAlt,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 12,
              gap: 8,
            }}
          >
            <Ionicons name="search" size={17} color={theme.colors.textTertiary} />
            <TextInput
              ref={searchInputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="搜索频道名称、Handle 或 ID"
              placeholderTextColor={theme.colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={[
                {
                  flex: 1,
                  color: theme.colors.text,
                  fontSize: 13.5,
                  paddingVertical: 0,
                },
                Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null,
              ]}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8} feedback="opacity">
                <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>
        </Animated.View>

        {manageMode ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 12,
            }}
          >
            <Pressable onPress={toggleSelectAll} hitSlop={8} feedback="opacity">
              <Text style={{ color: theme.colors.primary, fontSize: 12.5, fontWeight: '700' }}>
                {selected.size === filteredSubscriptions.length ? '取消全选' : '全选'}
              </Text>
            </Pressable>
            <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
              {searchActive ? '搜索时暂停拖动排序' : '拖动右侧手柄排序 · 边缘自动滚动'}
            </Text>
          </View>
        ) : null}
      </View>

      <DragStateContext.Provider value={dragState}>
        <FlatList
          ref={listRef}
          data={listReady ? filteredSubscriptions : []}
          keyExtractor={(item) => item.channelId}
          // 拖动时关闭列表自身滚动，边缘自动滚动改用 scrollToOffset 驱动。
          // 否则 iOS 的 ScrollView 会和拖动手势抢 responder，表现为整页滑动、
          // 拖动断触、被拖行回弹。
          scrollEnabled={dragIndex === null}
          // iOS 在列表顶/底被拖到边缘时会产生回弹偏移，和拖拽补偿叠加就会
          // 造成被拖行上下弹跳。拖动期间关掉回弹，松手后再恢复。
          bounces={dragIndex === null}
          alwaysBounceVertical={dragIndex === null}
          overScrollMode={
            Platform.OS === 'android' ? (dragIndex === null ? 'always' : 'never') : undefined
          }
          extraData={listExtraData}
          CellRendererComponent={DragCell}
          // 被拖行已经移到列表外的 DragGhost 浮层，不再依赖 FlatList 的
          // cell 裁剪/层级，因此可以正常启用虚拟化。固定行高让 scrollToOffset
          // 和边缘自动滚动不必反复测量布局。
          removeClippedSubviews={false}
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          windowSize={dragIndex !== null ? 41 : 11}
          maxToRenderPerBatch={dragIndex !== null ? 40 : 10}
          updateCellsBatchingPeriod={dragIndex !== null ? 16 : 50}
          onLayout={(event) => {
            listMetricsRef.current.top = event.nativeEvent.layout.y;
            listMetricsRef.current.height = event.nativeEvent.layout.height;
          }}
          onScroll={(event) => {
            const offset = event.nativeEvent.contentOffset.y;
            scrollOffsetRef.current = offset;
            if (dragRef.current) updateDragTarget();
          }}
          onScrollBeginDrag={() => setSwipeOpenId(null)}
          onContentSizeChange={(_, height) => {
            listMetricsRef.current.contentHeight = height;
          }}
          scrollEventThrottle={16}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: manageMode ? 110 : 36,
            flexGrow: 1,
          }}
          renderItem={({ item, index }) => (
            <SortableRow
              item={item}
              index={index}
              count={filteredSubscriptions.length}
              manageMode={manageMode}
              selected={selected.has(item.channelId)}
              openSwipe={swipeOpenId === item.channelId}
              canDrag={manageMode && !searchActive}
              hidden={dragIndex === index}
              onToggle={() => toggleSelected(item.channelId)}
              onSwipeOpen={() => setSwipeOpenId(item.channelId)}
              onSwipeClose={() => setSwipeOpenId(null)}
              onPin={() => pinToTop(item.channelId)}
              onDelete={() => confirmRemoveOne(item)}
              onDragStart={startAutoScroll}
              onDragMove={moveDragPointer}
              onDragEnd={endDrag}
              onDragCancel={cancelDrag}
              onOpen={() => {
                if (swipeOpenId) {
                  setSwipeOpenId(null);
                  return;
                }
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
                } as any);
              }}
            />
          )}
          ListEmptyComponent={
            !listReady ? undefined : subscriptions.length ? (
              <EmptyState
                icon="search-outline"
                title="没有找到频道"
                desc={`没有匹配「${query.trim()}」的频道。`}
                action={
                  <PrimaryButton
                    label="清空搜索"
                    icon="close"
                    onPress={() => setQuery('')}
                    style={{ width: 180 }}
                  />
                }
              />
            ) : (
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
            )
          }
          ListFooterComponent={
            subscriptions.length && !searchActive ? (
              <View style={{ alignItems: 'center', paddingTop: 20, gap: 8 }}>
                <Pressable onPress={importCsv} hitSlop={8} feedback="opacity">
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5 }}>
                    从 CSV 导入
                  </Text>
                </Pressable>
                <Pressable onPress={exportCsv} hitSlop={8} feedback="opacity">
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5 }}>
                    导出 CSV{busy ? '（处理中…）' : ''}
                  </Text>
                </Pressable>
              </View>
            ) : undefined
          }
          showsVerticalScrollIndicator={false}
        />
        {dragIndex !== null && filteredSubscriptions[dragIndex] ? (
          <DragGhost
            item={filteredSubscriptions[dragIndex]}
            selected={selected.has(filteredSubscriptions[dragIndex].channelId)}
            translateY={dragGhostY}
          />
        ) : null}
      </DragStateContext.Provider>

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
          <RipplePressable
            haptic="medium"
            onPress={confirmBatchRemove}
            accessibilityLabel="批量删除"
            style={{
              backgroundColor: theme.colors.danger,
              borderRadius: RADIUS.control,
              ...CONTINUOUS_CORNER,
              paddingHorizontal: 20,
              height: 42,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>批量删除</Text>
          </RipplePressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  swipeActions: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    width: 144,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 3,
  },
  swipeAction: {
    width: SWIPE_ACTION_BUTTON_WIDTH,
    height: 56,
    borderRadius: RADIUS.control,
    ...CONTINUOUS_CORNER,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeActionLabel: { fontSize: 11.5, fontWeight: '800' },
  avatarFallback: {
    width: 54,
    height: 54,
    borderRadius: RADIUS.pill,
    ...CONTINUOUS_CORNER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageCheckbox: {
    position: 'absolute',
    left: 14,
    top: 24,
    zIndex: 3,
  },
  subscribedMark: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.pill,
    ...CONTINUOUS_CORNER,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
