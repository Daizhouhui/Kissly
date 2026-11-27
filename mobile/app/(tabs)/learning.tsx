import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../../src/core/store';
import { relativeTime } from '../../src/core/utils';
import { resumeTarget } from '../../src/core/watchProgress';
import { CONTINUOUS_CORNER, RADIUS } from '../../src/tokens';
import { AppPressable } from '../../src/ui/app-pressable';
import { useAppTheme } from '../../src/ui/theme';

const Pressable = AppPressable;

export default function LearningScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const favorites = useAppStore((state) => state.favorites);
  const removeFavorite = useAppStore((state) => state.removeFavorite);
  const history = useAppStore((state) => state.history);

  const weekCount = favorites.filter((item) => Date.now() - item.savedAt < 7 * 86400000).length;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <LinearGradient
        pointerEvents="none"
        colors={[theme.colors.primarySoft, theme.colors.bg]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 260 }}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 18,
          paddingBottom: 110,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.8 }}>学习</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, marginTop: 4 }}>
              把收藏的视频集中到这里，随时接着看
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/favorites' as any)}
            style={{
              width: 42,
              height: 42,
              borderRadius: RADIUS.pill,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.card,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            hitSlop={8}
          >
            <Ionicons name="heart-outline" size={21} color={theme.colors.primary} />
          </Pressable>
        </View>

        <View
          style={[
            styles.statsCard,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <Pressable
            onPress={() => router.push('/favorites' as any)}
            accessibilityLabel="查看全部收藏视频"
            radius={0}
            style={styles.statsHalf}
          >
            <View style={styles.statsCopy}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '600' }}>收藏视频</Text>
              <Text style={{ color: theme.colors.text, fontSize: 26, fontWeight: '900', marginTop: 2 }}>{favorites.length}</Text>
              <Text
                style={{ color: theme.colors.textTertiary, fontSize: 10.5, marginTop: 2 }}
                numberOfLines={1}
              >
                本周新增 {weekCount} 个
              </Text>
            </View>
            <View style={[styles.statsAction, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="bookmark" size={20} color={theme.colors.primary} />
            </View>
          </Pressable>
          <View style={[styles.statsDivider, { backgroundColor: theme.colors.border }]} />
          <Pressable
            onPress={() => router.push('/history' as any)}
            accessibilityLabel="查看全部观看记录"
            radius={0}
            style={styles.statsHalf}
          >
            <View style={styles.statsCopy}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '600' }}>最近观看</Text>
              <Text style={{ color: theme.colors.text, fontSize: 26, fontWeight: '900', marginTop: 2 }}>{history.length}</Text>
              <Text
                style={{ color: theme.colors.textTertiary, fontSize: 10.5, marginTop: 2 }}
                numberOfLines={1}
              >
                按打开时间排序
              </Text>
            </View>
            <View style={[styles.statsAction, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="play-circle" size={21} color={theme.colors.primary} />
            </View>
          </Pressable>
        </View>

        <View style={styles.sectionRow}>
          <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '800' }}>我的收藏</Text>
          {favorites.length > 0 ? (
            <Pressable
              onPress={() => router.push('/favorites' as any)}
              hitSlop={8}
              feedback="opacity"
              accessibilityLabel="查看全部收藏视频"
            >
              <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '700' }}>全部</Text>
            </Pressable>
          ) : null}
        </View>

        {favorites.length === 0 ? (
          <View
            style={{
              alignItems: 'center',
              backgroundColor: theme.colors.card,
              borderRadius: RADIUS.card,
              ...CONTINUOUS_CORNER,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              padding: 28,
              paddingHorizontal: 22,
            }}
          >
            <View
              style={{
                width: 70,
                height: 70,
                borderRadius: RADIUS.control,
                backgroundColor: theme.colors.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 14,
              }}
            >
              <Ionicons name="bookmark-outline" size={34} color={theme.colors.primary} />
            </View>
            <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '800' }}>还没有收藏</Text>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: 12.5,
                lineHeight: 19,
                textAlign: 'center',
                marginTop: 6,
                marginBottom: 18,
              }}
            >
              在播放器里点“收藏”，视频会出现在这里；不用再翻订阅流去找。
            </Text>
            <Pressable
              tone="onColor"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                height: 44,
                paddingHorizontal: 18,
                borderRadius: RADIUS.control,
                backgroundColor: theme.colors.primary,
              }}
              onPress={() => router.push('/' as any)}
            >
              <Ionicons name="play" size={16} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>去发现视频</Text>
            </Pressable>
          </View>
        ) : (
          favorites.slice(0, 2).map((item) => {
            const startAt = resumeTarget({
              progress: item.progress ?? 0,
              resumeAt: undefined,
              duration: item.duration,
            });
            return (
            <Pressable
              key={item.videoId}
              onPress={() =>
                router.push({
                  pathname: '/player',
                  params: {
                    videoId: item.videoId,
                    title: item.title,
                    author: item.author,
                    ...(startAt > 0 ? { startAt: String(startAt) } : {}),
                  },
                } as any)
              }
              radius={RADIUS.card}
              style={[
                styles.card,
                {
                  backgroundColor: theme.colors.card,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <View style={[styles.thumbWrap, { backgroundColor: theme.colors.surfaceAlt }]}>
                <Image
                  source={{ uri: item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg` }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={200}
                />
                <View style={styles.playBadge}>
                  <Ionicons name="play" size={15} color="#FFFFFF" />
                </View>
              </View>
              <View style={styles.cardBody}>
                <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700', lineHeight: 19 }} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 4 }} numberOfLines={1}>
                  {item.author || 'YouTube'}
                </Text>
                <Text style={{ color: theme.colors.textTertiary, fontSize: 10, marginTop: 4 }}>
                  收藏于 {relativeTime(item.savedAt)}
                </Text>
              </View>
              <Pressable hitSlop={10} onPress={() => removeFavorite(item.videoId)} style={styles.removeButton}>
                <Ionicons name="heart" size={19} color={theme.colors.primary} />
              </Pressable>
            </Pressable>
            );
          })
        )}

        {history.length > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '800' }}>最近观看</Text>
              <Pressable onPress={() => router.push('/history' as any)} feedback="opacity">
                <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '700' }}>全部</Text>
              </Pressable>
            </View>
            {history.slice(0, 10).map((item) => {
              const startAt = resumeTarget(item);
              return (
              <Pressable
                key={`history-${item.videoId}`}
                radius={0}
                onPress={() =>
                  router.push({
                    pathname: '/player',
                    params: {
                      videoId: item.videoId,
                      title: item.title,
                      author: item.author,
                      ...(startAt > 0 ? { startAt: String(startAt) } : {}),
                    },
                  } as any)
                }
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 11,
                  paddingVertical: 8,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.colors.border,
                }}
              >
                <Image
                  source={{ uri: item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg` }}
                  style={[styles.historyThumb as any, { backgroundColor: theme.colors.surfaceAlt }]}
                  contentFit="cover"
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600', lineHeight: 18 }} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={{ color: theme.colors.textTertiary, fontSize: 10.5, marginTop: 4 }} numberOfLines={1}>
                    {item.author} · {relativeTime(item.lastWatchedAt ?? item.savedAt)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} />
              </Pressable>
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  statsCard: {
    marginTop: 20,
    borderRadius: RADIUS.card,
    ...CONTINUOUS_CORNER,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  statsHalf: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  statsCopy: { flex: 1, minWidth: 0 },
  statsAction: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsDivider: {
    width: StyleSheet.hairlineWidth,
    marginVertical: 16,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 9,
    paddingRight: 12,
    borderRadius: RADIUS.card,
    ...CONTINUOUS_CORNER,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  thumbWrap: { width: 132, aspectRatio: 16 / 9, borderRadius: RADIUS.control, ...CONTINUOUS_CORNER, overflow: 'hidden' },
  playBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    width: 26,
    height: 26,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(0,0,0,0.66)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, minWidth: 0 },
  removeButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  historyThumb: { width: 100, aspectRatio: 16 / 9, borderRadius: RADIUS.control, ...CONTINUOUS_CORNER },
});
