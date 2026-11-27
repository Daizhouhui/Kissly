import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadJson, saveJson } from '../src/core/storage';
import { useAppStore } from '../src/core/store';
import { Subscription } from '../src/core/types';
import { resolveChannelInput } from '../src/core/youtube/channel';
import { ChannelSearchResult, searchChannels } from '../src/core/youtube/search';
import { CONTINUOUS_CORNER, RADIUS } from '../src/tokens';
import { toast } from '../src/ui/app-toast';
import { AppPressable } from '../src/ui/app-pressable';
import { GhostButton } from '../src/ui/components';
import { useAppTheme } from '../src/ui/theme';

const Pressable = AppPressable;

type Category = {
  id: string;
  label: string;
  query: string;
};

const CATEGORIES: Category[] = [
  { id: 'all', label: '全部', query: 'English learning' },
  { id: 'vlog', label: 'Vlog', query: 'English vlog' },
  { id: 'animation', label: '动画', query: 'English animation learning' },
  { id: 'music', label: '音乐', query: 'English songs with lyrics' },
  { id: 'film', label: '影视', query: 'English movie scenes' },
  { id: 'food', label: '美食', query: 'English food vlog' },
  { id: 'travel', label: '旅行', query: 'English travel vlog' },
  { id: 'tech', label: '科技', query: 'English tech review' },
  { id: 'ai', label: 'AI', query: 'English AI news' },
  { id: 'science', label: '科学', query: 'English science' },
  { id: 'education', label: '教育', query: 'English learning' },
  { id: 'psychology', label: '心理', query: 'English psychology' },
  { id: 'career', label: '职业', query: 'English career advice' },
  { id: 'art', label: '艺术', query: 'English art' },
  { id: 'history', label: '历史', query: 'English history' },
  { id: 'sports', label: '运动', query: 'English sports' },
  { id: 'health', label: '健康', query: 'English health' },
  { id: 'news', label: '新闻', query: 'English news' },
  { id: 'interview', label: '访谈', query: 'English interview' },
  { id: 'speech', label: '演讲', query: 'English speech' },
  { id: 'entertainment', label: '娱乐', query: 'English entertainment' },
  { id: 'gaming', label: '游戏', query: 'English gaming' },
];

function requestErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|network request failed|load failed/i.test(raw)) {
    return '网络请求失败：请检查本机代理是否可用，或稍后重试。';
  }
  return raw;
}

function ChannelAvatar({
  uri,
  title,
  size = 56,
}: {
  uri?: string;
  title: string;
  size?: number;
}) {
  const theme = useAppTheme();
  const [failed, setFailed] = useState(false);
  const src = uri
    ? uri.startsWith('//')
      ? `https:${uri}`
      : uri.replace(/^http:\/\//i, 'https://')
    : uri;

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: RADIUS.pill,
          backgroundColor: theme.colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: theme.colors.primary, fontSize: size * 0.38, fontWeight: '900' }}>
          {(title || '?').slice(0, 1).toUpperCase()}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: src }}
      style={{ width: size, height: size, borderRadius: RADIUS.pill }}
      contentFit="cover"
      transition={140}
      onError={() => setFailed(true)}
    />
  );
}

export default function SearchChannelsScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const initialQuery = String(params.q ?? '');
  const subscriptions = useAppStore((state) => state.subscriptions);
  const addSubscription = useAppStore((state) => state.addSubscription);
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState('all');
  const [results, setResults] = useState<ChannelSearchResult[]>([]);
  const [recommended, setRecommended] = useState<ChannelSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [input, setInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [preview, setPreview] = useState<Subscription | null>(null);
  const [pasteError, setPasteError] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const historyLoaded = useRef(false);
  const requestRef = useRef(0);
  const subscribedIds = new Set(subscriptions.map((sub) => sub.channelId));

  const loadRecommendations = async (selectedCategory: string) => {
    const config = CATEGORIES.find((item) => item.id === selectedCategory) ?? CATEGORIES[0];
    const requestId = ++requestRef.current;
    setLoading(true);
    setMessage('');
    try {
      const found = await searchChannels(config.query);
      if (requestId !== requestRef.current) return;
      setRecommended(found);
      if (!found.length) setMessage('推荐暂时没有加载出来，可以直接输入频道名搜索。');
    } catch (error) {
      if (requestId !== requestRef.current) return;
      setRecommended([]);
      setMessage(requestErrorMessage(error));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  const runSearch = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setResults([]);
      loadRecommendations(category);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setMessage('');
    try {
      const found = await searchChannels(trimmed);
      if (requestId !== requestRef.current) return;
      setResults(found);
      setMessage(found.length ? '' : '没有找到匹配的频道，换个关键词试试。');
    } catch (error) {
      if (requestId !== requestRef.current) return;
      setResults([]);
      setMessage(requestErrorMessage(error));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  const rememberSearch = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setHistory((current) => {
      const next = [
        trimmed,
        ...current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, 12);
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
  };

  const selectHistoryItem = (value: string) => {
    setQuery(value);
    setHistoryOpen(false);
    rememberSearch(value);
    if (value === query) runSearch(value);
  };

  useEffect(() => {
    let cancelled = false;
    void loadJson<string[]>('search-history', []).then((items) => {
      if (cancelled) return;
      const valid = Array.isArray(items)
        ? items
            .filter((item): item is string => typeof item === 'string' && !!item.trim())
            .map((item) => item.trim())
            .slice(0, 12)
        : [];
      setHistory((current) => {
        const merged = [...current, ...valid].filter(
          (item, index, list) =>
            list.findIndex((entry) => entry.toLowerCase() === item.toLowerCase()) === index
        );
        return merged.slice(0, 12);
      });
      historyLoaded.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (historyLoaded.current) void saveJson('search-history', history);
  }, [history]);

  useEffect(() => {
    if (initialQuery.trim()) {
      rememberSearch(initialQuery);
      runSearch(initialQuery);
    } else loadRecommendations('all');
    return () => {
      requestRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => runSearch(query), 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const chooseCategory = (id: string) => {
    setCategory(id);
    if (!query.trim()) loadRecommendations(id);
  };

  const subscribe = (channel: ChannelSearchResult) => {
    if (subscribedIds.has(channel.channelId)) return;
    addSubscription({
      channelId: channel.channelId,
      title: channel.title,
      handle: channel.handle,
      avatar: channel.avatar,
      subscriberCount: channel.subscriberCount,
      videoCount: channel.videoCount,
      addedAt: Date.now(),
    });
  };

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setInput(text.trim());
      setPreview(null);
      setPasteError('');
    }
  };

  const resolve = async () => {
    if (!input.trim()) {
      setPasteError('请先粘贴频道链接或 @handle');
      return;
    }
    setResolving(true);
    setPasteError('');
    setPreview(null);
    try {
      const channel = await resolveChannelInput(input);
      setPreview(channel);
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : String(error));
    } finally {
      setResolving(false);
    }
  };

  const addPreview = () => {
    if (!preview) return;
    if (subscribedIds.has(preview.channelId)) {
      toast.info(`「${preview.title}」已经订阅过了`);
      setPreview(null);
      setInput('');
      return;
    }
    addSubscription(preview);
    toast.success(`「${preview.title}」已加入订阅`);
    setPreview(null);
    setInput('');
  };

  const list = query.trim() ? results : recommended;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + 10,
            paddingHorizontal: 18,
            paddingBottom: 40,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backButton}>
              <Ionicons name="arrow-back" size={23} color={theme.colors.text} />
            </Pressable>
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 9,
                backgroundColor: theme.colors.surfaceAlt,
                borderRadius: RADIUS.pill,
                paddingHorizontal: 17,
                height: 48,
              }}
            >
              <Ionicons name="search" size={20} color={theme.colors.textSecondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                onFocus={() => setHistoryOpen(false)}
                placeholder="搜索 YouTube"
                placeholderTextColor={theme.colors.textTertiary}
                autoFocus={!initialQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => {
                  rememberSearch(query);
                  runSearch(query);
                }}
                style={{ flex: 1, color: theme.colors.text, fontSize: 14.5, height: '100%' }}
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setHistoryOpen((value) => !value);
              }}
              accessibilityLabel="搜索历史"
              hitSlop={8}
              style={{
                width: 38,
                height: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: RADIUS.control,
                backgroundColor: historyOpen ? theme.colors.primarySoft : 'transparent',
              }}
            >
              <Ionicons
                name={historyOpen ? 'time' : 'time-outline'}
                size={23}
                color={historyOpen ? theme.colors.primary : theme.colors.textSecondary}
              />
            </Pressable>
          </View>

          {historyOpen ? (
            <View
              style={{
                marginTop: 14,
                backgroundColor: theme.colors.card,
                borderRadius: RADIUS.card,
                ...CONTINUOUS_CORNER,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 14,
                  paddingTop: 13,
                  paddingBottom: 10,
                }}
              >
                <Text style={{ color: theme.colors.text, fontSize: 13.5, fontWeight: '800' }}>
                  搜索历史
                </Text>
                {history.length ? (
                  <Pressable onPress={clearHistory} hitSlop={8} feedback="opacity">
                    <Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>清空</Text>
                  </Pressable>
                ) : null}
              </View>
              {history.length ? (
                history.map((item, index) => (
                  <Pressable
                    key={`${item}-${index}`}
                    onPress={() => selectHistoryItem(item)}
                    radius={0}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 9,
                      paddingHorizontal: 14,
                      paddingVertical: 11,
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: theme.colors.border,
                    }}
                  >
                    <Ionicons name="time-outline" size={17} color={theme.colors.textTertiary} />
                    <Text
                      numberOfLines={1}
                      style={{ flex: 1, color: theme.colors.textSecondary, fontSize: 13 }}
                    >
                      {item}
                    </Text>
                  </Pressable>
                ))
              ) : (
                <Text
                  style={{
                    color: theme.colors.textTertiary,
                    fontSize: 12,
                    lineHeight: 18,
                    paddingHorizontal: 14,
                    paddingBottom: 14,
                  }}
                >
                  暂无搜索记录，搜索后会保存在这里。
                </Text>
              )}
            </View>
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 18 }}
            style={{ marginTop: 16 }}
          >
            {CATEGORIES.map((item) => {
              const active = category === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => chooseCategory(item.id)}
                  feedback="opacity"
                  style={{
                    height: 38,
                    paddingHorizontal: 18,
                    borderRadius: RADIUS.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: active ? 0 : StyleSheet.hairlineWidth,
                    borderColor: theme.colors.borderStrong,
                    backgroundColor: active ? theme.colors.primary : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      color: active ? '#FFFFFF' : theme.colors.textSecondary,
                      fontSize: 13,
                      fontWeight: active ? '800' : '600',
                    }}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View
            style={{
              marginTop: 22,
              marginBottom: 9,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '800' }}>
              {query.trim() ? '搜索结果' : '推荐频道'}
            </Text>
            {!query.trim() ? (
              <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>按分类推荐</Text>
            ) : null}
          </View>

          {message ? (
            <Text
              style={{
                color: theme.colors.textTertiary,
                fontSize: 12,
                lineHeight: 18,
                textAlign: 'center',
                marginTop: 20,
                marginBottom: 8,
              }}
            >
              {message}
            </Text>
          ) : null}

          <View
            style={{
              backgroundColor: theme.colors.card,
              borderRadius: RADIUS.card,
              ...CONTINUOUS_CORNER,
              overflow: 'hidden',
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
            }}
          >
            {list.map((channel, index) => {
              const subscribed = subscribedIds.has(channel.channelId);
              return (
                <Pressable
                  key={channel.channelId}
                  radius={0}
                  onPress={() =>
                    router.push({
                      pathname: '/channel',
                      params: {
                        channelId: channel.channelId,
                        title: channel.title,
                        avatar: channel.avatar ?? '',
                        handle: channel.handle ?? '',
                        subscribers: channel.subscriberCount ?? '',
                        videos: channel.videoCount ?? '',
                      },
                    } as any)
                  }
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 13,
                    paddingHorizontal: 13,
                    borderBottomWidth:
                      index === list.length - 1 ? 0 : StyleSheet.hairlineWidth,
                    borderBottomColor: theme.colors.border,
                  }}
                >
                  <ChannelAvatar uri={channel.avatar} title={channel.title} size={56} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{ color: theme.colors.text, fontSize: 16, fontWeight: '800' }}
                      numberOfLines={1}
                    >
                      {channel.title}
                    </Text>
                    <Text
                      style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 }}
                      numberOfLines={1}
                    >
                      {[channel.subscriberCount, channel.videoCount]
                        .filter(Boolean)
                        .join('  ·  ') ||
                        channel.handle ||
                        'YouTube 频道'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={(event) => {
                      event.stopPropagation();
                      subscribe(channel);
                    }}
                    disabled={subscribed}
                    hitSlop={8}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: RADIUS.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: subscribed
                        ? theme.colors.surfaceAlt
                        : theme.colors.primarySoft,
                    }}
                  >
                    <Ionicons
                      name={subscribed ? 'checkmark' : 'add'}
                      size={18}
                      color={subscribed ? theme.colors.textTertiary : theme.colors.primary}
                    />
                  </Pressable>
                </Pressable>
              );
            })}
            {list.length === 0 && loading ? (
              <View style={{ paddingVertical: 34, alignItems: 'center' }}>
                <ActivityIndicator color={theme.colors.primary} />
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={() => setShowImport((value) => !value)}
            feedback="opacity"
            style={{ marginTop: 22, alignSelf: 'center', paddingVertical: 8 }}
          >
            <Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>
              {showImport ? '收起链接导入' : '通过频道链接 / @handle 添加'}
            </Text>
          </Pressable>

          {showImport ? (
            <View style={{ marginTop: 6 }}>
              <TextInput
                value={input}
                onChangeText={(value) => {
                  setInput(value);
                  setPreview(null);
                  setPasteError('');
                }}
                placeholder="https://youtube.com/@handle"
                placeholderTextColor={theme.colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  minHeight: 48,
                  borderRadius: RADIUS.control,
                  backgroundColor: theme.colors.surfaceAlt,
                  paddingHorizontal: 14,
                  color: theme.colors.text,
                  fontSize: 13,
                }}
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <GhostButton label="粘贴" icon="clipboard-outline" onPress={paste} />
                <Pressable
                  onPress={resolve}
                  disabled={resolving}
                  style={{
                    flex: 1,
                    height: 44,
                    borderRadius: RADIUS.control,
                    backgroundColor: theme.colors.primarySoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                    gap: 7,
                  }}
                >
                  {resolving ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
                  <Text style={{ color: theme.colors.primary, fontSize: 12.5, fontWeight: '700' }}>
                    {resolving ? '识别中…' : '识别频道'}
                  </Text>
                </Pressable>
              </View>
              {pasteError ? (
                <Text style={{ color: theme.colors.danger, fontSize: 11.5, marginTop: 8 }}>
                  {pasteError}
                </Text>
              ) : null}
              {preview ? (
                <Pressable
                  onPress={addPreview}
                  style={{
                    marginTop: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    backgroundColor: theme.colors.card,
                    borderRadius: RADIUS.card,
                    ...CONTINUOUS_CORNER,
                    padding: 12,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.colors.border,
                  }}
                >
                  <ChannelAvatar uri={preview.avatar} title={preview.title} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                      {preview.title}
                    </Text>
                    <Text
                      style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}
                    >
                      点击添加这个频道
                    </Text>
                  </View>
                  <Ionicons name="add-circle" size={24} color={theme.colors.primary} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 38,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
