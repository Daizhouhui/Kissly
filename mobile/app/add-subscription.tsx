import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAppStore } from '../src/core/store';
import { Subscription } from '../src/core/types';
import { resolveChannelInput } from '../src/core/youtube/channel';
import { ChannelSearchResult, searchChannels } from '../src/core/youtube/search';
import { GhostButton, NavHeader } from '../src/ui/components';
import { useAppTheme } from '../src/ui/theme';

export default function SearchChannelsScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const initialQuery = String(params.q ?? '');
  const subscriptions = useAppStore((state) => state.subscriptions);
  const addSubscription = useAppStore((state) => state.addSubscription);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ChannelSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [input, setInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [preview, setPreview] = useState<Subscription | null>(null);
  const [pasteError, setPasteError] = useState('');
  const requestRef = useRef(0);
  const subscribedIds = new Set(subscriptions.map((sub) => sub.channelId));

  const runSearch = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setResults([]);
      setMessage('');
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
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (initialQuery.trim()) runSearch(initialQuery);
    return () => {
      requestRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setMessage('');
      return;
    }
    const timer = setTimeout(() => runSearch(query), 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const subscribe = (channel: ChannelSearchResult) => {
    if (subscribedIds.has(channel.channelId)) return;
    addSubscription({
      channelId: channel.channelId,
      title: channel.title,
      handle: channel.handle,
      avatar: channel.avatar,
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
    addSubscription(preview);
    Alert.alert('已添加', `「${preview.title}」已加入订阅。`);
    setPreview(null);
    setInput('');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader title="搜索 YouTube" subtitle="搜索全部频道，直接关注或查看详情" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
              backgroundColor: theme.colors.card,
              borderRadius: 16,
              paddingHorizontal: 14,
              height: 50,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
            }}
          >
            <Ionicons name="search" size={19} color={theme.colors.textTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="搜索频道名，例如 Vlad and Niki"
              placeholderTextColor={theme.colors.textTertiary}
              autoFocus={!initialQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => runSearch(query)}
              style={{ flex: 1, color: theme.colors.text, fontSize: 14, height: '100%' }}
            />
            {loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>

          {message ? (
            <Text
              style={{
                color: theme.colors.textTertiary,
                fontSize: 12,
                lineHeight: 18,
                textAlign: 'center',
                marginTop: 24,
              }}
            >
              {message}
            </Text>
          ) : null}

          {results.map((channel) => {
            const subscribed = subscribedIds.has(channel.channelId);
            return (
              <Pressable
                key={channel.channelId}
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
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 13,
                  opacity: pressed ? 0.75 : 1,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.colors.border,
                })}
              >
                {channel.avatar ? (
                  <Image
                    source={{ uri: channel.avatar }}
                    style={{ width: 54, height: 54, borderRadius: 27 }}
                    contentFit="cover"
                    transition={140}
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
                      {channel.title.slice(0, 1)}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '800' }} numberOfLines={1}>
                    {channel.title}
                  </Text>
                  <Text
                    style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 4 }}
                    numberOfLines={1}
                  >
                    {[channel.subscriberCount, channel.videoCount].filter(Boolean).join(' · ') ||
                      channel.handle ||
                      channel.channelId}
                  </Text>
                </View>
                <Pressable
                  onPress={() => subscribe(channel)}
                  disabled={subscribed}
                  hitSlop={8}
                  style={{
                    height: 32,
                    paddingHorizontal: 12,
                    borderRadius: 16,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 3,
                    backgroundColor: subscribed ? theme.colors.surfaceAlt : theme.colors.primary,
                  }}
                >
                  <Ionicons
                    name={subscribed ? 'checkmark' : 'add'}
                    size={15}
                    color={subscribed ? theme.colors.textTertiary : '#FFFFFF'}
                  />
                  <Text
                    style={{
                      color: subscribed ? theme.colors.textTertiary : '#FFFFFF',
                      fontSize: 11.5,
                      fontWeight: '800',
                    }}
                  >
                    {subscribed ? '已关注' : '关注'}
                  </Text>
                </Pressable>
              </Pressable>
            );
          })}

          <View style={{ marginTop: 28 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>
              也可以粘贴频道链接
            </Text>
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
                borderRadius: 14,
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
                  borderRadius: 12,
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
              <Text style={{ color: theme.colors.danger, fontSize: 11.5, marginTop: 8 }}>{pasteError}</Text>
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
                  borderRadius: 14,
                  padding: 12,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                }}
              >
                {preview.avatar ? (
                  <Image source={{ uri: preview.avatar }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700' }}>{preview.title}</Text>
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}>
                    点击添加这个频道
                  </Text>
                </View>
                <Ionicons name="add-circle" size={24} color={theme.colors.primary} />
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
