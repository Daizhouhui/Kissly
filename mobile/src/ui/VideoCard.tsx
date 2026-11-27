import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { VideoItem } from '../core/types';
import { formatTime, relativeTime } from '../core/utils';
import { useAppStore } from '../core/store';
import { CONTINUOUS_CORNER, RADIUS } from '../tokens';
import { AppPressable } from './app-pressable';
import { useAppTheme } from './theme';

export type VideoCardVariant = 'list' | 'grid' | 'large';

// Covers are deliberately flatter than the app's generic control radius.
const VIDEO_THUMBNAIL_RADIUS = 8;

export function VideoCard({
  item,
  onPress,
  variant = 'list',
}: {
  item: VideoItem;
  onPress: () => void;
  variant?: VideoCardVariant;
}) {
  const theme = useAppTheme();
  const titleMode = useAppStore((state) => state.settings.titleTranslationMode);
  const { width } = useWindowDimensions();
  const thumbWidth = Math.min(152, Math.max(124, width * 0.37));
  const translatedColor = theme.colors.textSecondary;
  const translationOnly = titleMode === 'translation' && !!item.translatedTitle;
  const primaryTitle = translationOnly ? item.translatedTitle! : item.title;
  const secondaryTitle =
    titleMode === 'bilingual' && item.translatedTitle ? item.translatedTitle : undefined;

  const meta = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 }}>
      {item.channelAvatar ? (
        <Image
          source={{ uri: item.channelAvatar }}
          style={{ width: 17, height: 17, borderRadius: RADIUS.pill }}
          contentFit="cover"
          transition={120}
        />
      ) : null}
      <Text
        style={{ color: theme.colors.textSecondary, fontSize: 10.5, flexShrink: 1 }}
        numberOfLines={1}
      >
        {item.channelTitle}
      </Text>
      {item.viewCount ? (
        <>
          <Text style={{ color: theme.colors.textTertiary, fontSize: 10 }}>·</Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: 10 }}>
            {item.viewCount >= 10000
              ? `${(item.viewCount / 10000).toFixed(1)}万次观看`
              : `${item.viewCount} 次观看`}
          </Text>
        </>
      ) : null}
      <Text style={{ color: theme.colors.textTertiary, fontSize: 10 }}>·</Text>
      <Text style={{ color: theme.colors.textTertiary, fontSize: 10 }}>
        {relativeTime(item.published)}
      </Text>
    </View>
  );

  if (variant !== 'list') {
    const large = variant === 'large';
    return (
      <AppPressable
        onPress={onPress}
        feedback="ripple"
        radius={large ? RADIUS.card : RADIUS.control}
        accessibilityLabel={primaryTitle}
        style={{
          paddingVertical: large ? 10 : 6,
          width: '100%',
        }}
      >
        <View
          style={{
            width: '100%',
            aspectRatio: 16 / 9,
            borderRadius: VIDEO_THUMBNAIL_RADIUS,
            ...CONTINUOUS_CORNER,
            overflow: 'hidden',
            backgroundColor: theme.colors.surfaceAlt,
          }}
        >
          {item.thumbnail ? (
            <Image
              source={{ uri: item.thumbnail }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={180}
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="play-circle-outline" size={34} color={theme.colors.textTertiary} />
            </View>
          )}
          {item.duration ? (
            <View style={styles.duration}>
              <Text style={styles.durationText}>{formatTime(item.duration)}</Text>
            </View>
          ) : null}
        </View>
        <Text
          style={{
            color: theme.colors.text,
            fontSize: large ? 18 : 14.5,
            fontWeight: '800',
            lineHeight: large ? 24 : 19.5,
            letterSpacing: -0.2,
            marginTop: 9,
          }}
          numberOfLines={2}
        >
          {primaryTitle}
        </Text>
        {secondaryTitle ? (
          <Text
            style={{
              color: translatedColor,
              opacity: 0.62,
              fontSize: large ? 14 : 12,
              lineHeight: large ? 20 : 17,
              marginTop: 3,
              fontWeight: '500',
            }}
            numberOfLines={2}
          >
            {secondaryTitle}
          </Text>
        ) : null}
        {meta}
      </AppPressable>
    );
  }

  return (
    <AppPressable
      onPress={onPress}
      feedback="ripple"
      radius={RADIUS.control}
      accessibilityLabel={primaryTitle}
      style={{
        flexDirection: 'row',
        gap: 12,
        paddingVertical: 9,
      }}
    >
      <View
        style={{
          width: thumbWidth,
          aspectRatio: 16 / 9,
          borderRadius: VIDEO_THUMBNAIL_RADIUS,
          ...CONTINUOUS_CORNER,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceAlt,
        }}
      >
        {item.thumbnail ? (
          <Image
            source={{ uri: item.thumbnail }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={180}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="play-circle-outline" size={30} color={theme.colors.textTertiary} />
          </View>
        )}
        {item.duration ? (
          <View style={styles.duration}>
            <Text style={styles.durationText}>{formatTime(item.duration)}</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
        <Text
          style={{
            color: theme.colors.text,
            fontSize: 15.5,
            fontWeight: '700',
            lineHeight: 21,
            letterSpacing: -0.1,
          }}
          numberOfLines={2}
        >
          {primaryTitle}
        </Text>
        {secondaryTitle ? (
          <Text
            style={{
              color: translatedColor,
              opacity: 0.62,
              fontSize: 12,
              lineHeight: 17,
              marginTop: 3,
              fontWeight: '500',
            }}
            numberOfLines={2}
          >
            {secondaryTitle}
          </Text>
        ) : null}
        {meta}
      </View>
    </AppPressable>
  );
}

const styles = StyleSheet.create({
  duration: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    backgroundColor: 'rgba(0,0,0,0.74)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: RADIUS.badge,
    ...CONTINUOUS_CORNER,
  },
  durationText: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '700' },
});
