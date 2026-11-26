import { Ionicons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../../src/core/store';
import { SubtitleFont, SubtitleMode, SubtitlePosition } from '../../src/core/types';
import { CONTINUOUS_CORNER, CONTROL_HEIGHT, RADIUS } from '../../src/tokens';
import { AppPressable } from '../../src/ui/app-pressable';
import { Card, NavHeader, SectionTitle, SettingSwitch } from '../../src/ui/components';
import {
  ORIGINAL_FONT_OPTIONS,
  TRANSLATION_FONT_OPTIONS,
  type SubtitleFontOption,
} from '../../src/ui/subtitleOptions';
import { fontFamilyFor } from '../../src/ui/subtitleStyle';
import {
  subtitleTextMetrics,
  type SubtitleTextMetrics,
} from '../../src/ui/subtitleTypography';
import { useAppTheme } from '../../src/ui/theme';
import { WeightPicker } from '../../src/ui/weight-picker';

const Pressable = AppPressable;

const MODES: { value: SubtitleMode; label: string; hint: string }[] = [
  { value: 'bilingual', label: '双语', hint: '原文 + 译文' },
  { value: 'original', label: '仅原文', hint: '只看原文' },
  { value: 'translation', label: '仅译文', hint: '只看译文' },
];

const SAMPLE_SOURCE = 'To have another language is to possess a second soul.';
const SAMPLE_TRANSLATION = '掌握另一种语言，就是拥有第二个灵魂。';
const PREVIEW_CARD_HEIGHT = 190;
/** 设置页横屏预览固定缩放，不读取手机横屏尺寸；全屏预览始终使用真实字号与比例。 */
const LANDSCAPE_PREVIEW_SCALE = 2 / 3;

type PreviewMode = 'portrait' | 'landscape';

export default function SubtitleSettingsScreen() {
  const theme = useAppTheme();
  const subtitles = useAppStore((state) => state.settings.subtitle);
  const patchSettings = useAppStore((state) => state.patchSettings);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('portrait');
  const [fullPreview, setFullPreview] = useState(false);
  const insets = useSafeAreaInsets();

  const setSubtitle = (patch: Partial<typeof subtitles>) => {
    patchSettings({ subtitle: patch });
  };

  const setPortraitSize = (value: number) => {
    setPreviewMode('portrait');
    setSubtitle({ fontSize: value });
  };
  const setLandscapeSize = (value: number) => {
    setPreviewMode('landscape');
    setSubtitle({ landscapeFontSize: value });
  };

  const portraitOriginal = subtitleTextMetrics({
    surface: 'portrait',
    line: 'original',
    mode: subtitles.mode,
    baseSize: subtitles.fontSize,
    weight: subtitles.originalWeight,
  });
  const portraitTranslation = subtitleTextMetrics({
    surface: 'portrait',
    line: 'translation',
    mode: subtitles.mode,
    baseSize: subtitles.fontSize,
    weight: subtitles.translationWeight,
  });
  const landscapeOriginal = subtitleTextMetrics({
    surface: 'landscape',
    line: 'original',
    mode: subtitles.mode,
    baseSize: subtitles.landscapeFontSize,
    weight: subtitles.originalWeight,
    scale: LANDSCAPE_PREVIEW_SCALE,
  });
  const landscapeTranslation = subtitleTextMetrics({
    surface: 'landscape',
    line: 'translation',
    mode: subtitles.mode,
    baseSize: subtitles.landscapeFontSize,
    weight: subtitles.translationWeight,
    scale: LANDSCAPE_PREVIEW_SCALE,
  });
  const actualLandscapeOriginal = subtitleTextMetrics({
    surface: 'landscape',
    line: 'original',
    mode: subtitles.mode,
    baseSize: subtitles.landscapeFontSize,
    weight: subtitles.originalWeight,
  });
  const actualLandscapeTranslation = subtitleTextMetrics({
    surface: 'landscape',
    line: 'translation',
    mode: subtitles.mode,
    baseSize: subtitles.landscapeFontSize,
    weight: subtitles.translationWeight,
  });

  const originalFont = fontFamilyFor(subtitles.originalFont, 'source');
  const translationFont = fontFamilyFor(subtitles.translationFont, 'translation');

  const openFullPreview = () => {
    setFullPreview(true);
    void ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE
    ).catch(() => undefined);
  };
  const closeFullPreview = () => {
    setFullPreview(false);
    void ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP
    ).catch(() => undefined);
  };

  useEffect(
    () => () => {
      void ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP
      ).catch(() => undefined);
    },
    []
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader
        title="字幕样式"
        subtitle="竖屏、精听、横屏独立调节；预览与播放同源"
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={['#223129', '#0B0F0C']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.previewCard,
            {
              height: PREVIEW_CARD_HEIGHT,
            },
          ]}
        >
          <View style={styles.previewHeader}>
            <View style={styles.previewLabel}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: RADIUS.pill,
                  backgroundColor: '#9DC3AC',
                }}
              />
              <Text style={styles.previewLabelText}>字幕预览</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {previewMode === 'landscape' ? (
                <AppPressable
                  tone="onColor"
                  onPress={openFullPreview}
                  style={styles.fullPreviewButton}
                >
                  <Ionicons name="expand-outline" size={13} color="rgba(255,255,255,.82)" />
                  <Text style={styles.fullPreviewText}>全屏</Text>
                </AppPressable>
              ) : null}
              <PreviewToggle value={previewMode} onChange={setPreviewMode} />
            </View>
          </View>

          <View
            style={{
              flex: 1,
              justifyContent: subtitles.position === 'top' ? 'flex-start' : 'flex-end',
              paddingTop: previewMode === 'landscape' ? 10 : 4,
            }}
          >
            <SubtitleSample
              mode={subtitles.mode}
              source={SAMPLE_SOURCE}
              target={SAMPLE_TRANSLATION}
              originalMetrics={
                previewMode === 'portrait' ? portraitOriginal : landscapeOriginal
              }
              translationMetrics={
                previewMode === 'portrait' ? portraitTranslation : landscapeTranslation
              }
              originalFont={originalFont}
              translationFont={translationFont}
              backgroundOpacity={subtitles.backgroundOpacity}
              horizontalPadding={
                previewMode === 'landscape' ? 18 : 12
              }
              verticalPadding={10}
              translationGap={previewMode === 'portrait' ? 10 : 2}
              borderRadius={previewMode === 'landscape' ? RADIUS.control : 0}
              maxWidth={previewMode === 'landscape' ? '88%' : '100%'}
            />
          </View>
        </LinearGradient>

        <SectionTitle title="显示模式" />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {MODES.map((mode) => {
            const active = subtitles.mode === mode.value;
            return (
              <Pressable
                key={mode.value}
                onPress={() => setSubtitle({ mode: mode.value })}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: RADIUS.control,
                  backgroundColor: active ? theme.colors.primarySoft : theme.colors.card,
                  borderWidth: active ? 1 : StyleSheet.hairlineWidth,
                  borderColor: active ? theme.colors.primary : theme.colors.border,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    color: active ? theme.colors.primary : theme.colors.text,
                    fontSize: 13.5,
                    fontWeight: '700',
                  }}
                >
                  {mode.label}
                </Text>
                <Text style={{ color: theme.colors.textTertiary, fontSize: 10.5, marginTop: 3 }}>
                  {mode.hint}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <SectionTitle title="滚动与断句" />
        <Card style={{ paddingVertical: 12, paddingHorizontal: 12 }}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, fontWeight: '600', marginBottom: 8 }}>
            字幕滚动
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
            {(
              [
                ['top', '置顶'],
                ['page', '翻页'],
              ] as const
            ).map(([id, label]) => {
              const active = subtitles.scrollMode === id;
              return (
                <Pressable
                  key={id}
                  tone={active ? 'onColor' : 'surface'}
                  onPress={() => setSubtitle({ scrollMode: id })}
                  style={{
                    flex: 1,
                    height: 38,
                    borderRadius: RADIUS.control,
                    backgroundColor: active ? theme.colors.primary : theme.colors.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: active ? '#FFFFFF' : theme.colors.textSecondary, fontSize: 12, fontWeight: '700' }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, fontWeight: '600', marginBottom: 8 }}>
            断句模式
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(
              [
                ['smart', '智能断句'],
                ['whole', '整句'],
              ] as const
            ).map(([id, label]) => {
              const active = subtitles.sentenceMode === id;
              return (
                <Pressable
                  key={id}
                  tone={active ? 'onColor' : 'surface'}
                  onPress={() => setSubtitle({ sentenceMode: id })}
                  style={{
                    flex: 1,
                    height: 38,
                    borderRadius: RADIUS.control,
                    backgroundColor: active ? theme.colors.primary : theme.colors.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: active ? '#FFFFFF' : theme.colors.textSecondary, fontSize: 12, fontWeight: '700' }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <SectionTitle title="字号" />
        <Card style={{ gap: 14 }}>
          <SizeRow
            label="竖屏逐句稿"
            value={subtitles.fontSize}
            min={16}
            max={28}
            onChange={setPortraitSize}
          />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }} />
          <SizeRow
            label="精听"
            value={subtitles.listeningFontSize}
            min={16}
            max={28}
            onChange={(value) => setSubtitle({ listeningFontSize: value })}
          />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }} />
          <SizeRow
            label="横屏 / 全屏字幕"
            value={subtitles.landscapeFontSize}
            min={14}
            max={32}
            onChange={setLandscapeSize}
          />
        </Card>

        <SectionTitle title="字体与粗细" />
        <Card style={{ gap: 14 }}>
          <View>
            <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>原文字体</Text>
            <FontChoiceRow
              options={ORIGINAL_FONT_OPTIONS}
              value={subtitles.originalFont}
              onChange={(value) => setSubtitle({ originalFont: value })}
            />
            <Text style={[styles.fieldHint, { color: theme.colors.textTertiary }]}>
              {ORIGINAL_FONT_OPTIONS.find((option) => option.id === subtitles.originalFont)?.description}
            </Text>
          </View>
          <View>
            <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>原文粗细</Text>
            <WeightPicker
              value={subtitles.originalWeight}
              onChange={(value) => setSubtitle({ originalWeight: value })}
            />
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }} />
          <View>
            <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>翻译字体</Text>
            <FontChoiceRow
              options={TRANSLATION_FONT_OPTIONS}
              value={subtitles.translationFont}
              onChange={(value) => setSubtitle({ translationFont: value })}
            />
            <Text style={[styles.fieldHint, { color: theme.colors.textTertiary }]}>
              {TRANSLATION_FONT_OPTIONS.find((option) => option.id === subtitles.translationFont)?.description}
            </Text>
          </View>
          <View>
            <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>翻译粗细</Text>
            <WeightPicker
              value={subtitles.translationWeight}
              onChange={(value) => setSubtitle({ translationWeight: value })}
            />
          </View>
        </Card>

        <SectionTitle title="位置与背景" />
        <Card style={{ paddingVertical: 4 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 12 }}>
            {(['bottom', 'top'] as SubtitlePosition[]).map((position) => {
              const active = subtitles.position === position;
              return (
                <Pressable
                  key={position}
                  onPress={() => setSubtitle({ position })}
                  style={{
                    flex: 1,
                    height: CONTROL_HEIGHT.sm,
                    borderRadius: RADIUS.control,
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: active ? theme.colors.primary : theme.colors.textSecondary,
                      fontSize: 12,
                      fontWeight: active ? '700' : '500',
                    }}
                  >
                    {position === 'bottom' ? '底部' : '顶部'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View
            style={{
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.border,
              paddingVertical: 14,
            }}
          >
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, fontWeight: '600', marginBottom: 9 }}>
              背景不透明度
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[0, 0.3, 0.55, 0.8].map((opacity) => {
                const active = Math.abs(subtitles.backgroundOpacity - opacity) < 0.01;
                return (
                  <Pressable
                    key={opacity}
                    tone={active ? 'onColor' : 'surface'}
                    onPress={() => setSubtitle({ backgroundOpacity: opacity })}
                    style={{
                      flex: 1,
                      height: CONTROL_HEIGHT.sm,
                      borderRadius: RADIUS.control,
                      backgroundColor: active ? theme.colors.primary : theme.colors.surfaceAlt,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        color: active ? '#fff' : theme.colors.textSecondary,
                        fontSize: 11,
                        fontWeight: active ? '700' : '500',
                      }}
                    >
                      {opacity === 0 ? '无' : `${Math.round(opacity * 100)}%`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Card>

        <SectionTitle title="显示内容" />
        <Card style={{ paddingVertical: 4 }}>
          <SettingRow
            title="在视频画面上显示字幕"
            desc="横屏全屏时叠加双语字幕"
            value={subtitles.showOnVideo}
            onChange={(value) => setSubtitle({ showOnVideo: value })}
          />
          <SettingRow
            title="显示逐句稿"
            desc="竖屏时按句高亮，方便跟读"
            value={subtitles.transcript}
            onChange={(value) => setSubtitle({ transcript: value })}
            last
          />
        </Card>
      </ScrollView>

      <Modal
        visible={fullPreview}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        navigationBarTranslucent
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
        onRequestClose={closeFullPreview}
      >
        <LinearGradient
          colors={['#223129', '#0B0F0C']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.fullScreen,
            {
              paddingTop: insets.top + 16,
              paddingBottom: insets.bottom + 18,
            },
          ]}
        >
          <AppPressable
            tone="onColor"
            onPress={closeFullPreview}
            accessibilityLabel="关闭全屏预览"
            style={[styles.closeButton, { top: insets.top + 12 }]}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </AppPressable>
          <View
            style={{
              flex: 1,
              justifyContent: subtitles.position === 'top' ? 'flex-start' : 'flex-end',
            }}
          >
            <SubtitleSample
              mode={subtitles.mode}
              source={SAMPLE_SOURCE}
              target={SAMPLE_TRANSLATION}
              originalMetrics={actualLandscapeOriginal}
              translationMetrics={actualLandscapeTranslation}
              originalFont={originalFont}
              translationFont={translationFont}
              backgroundOpacity={subtitles.backgroundOpacity}
              horizontalPadding={18}
              verticalPadding={10}
              translationGap={2}
              borderRadius={RADIUS.control}
              maxWidth="88%"
            />
          </View>
          <Text style={styles.fullScreenHint}>1:1 真实横屏字号 · 关闭后恢复竖屏</Text>
        </LinearGradient>
      </Modal>
    </View>
  );
}

function PreviewToggle({
  value,
  onChange,
}: {
  value: PreviewMode;
  onChange: (value: PreviewMode) => void;
}) {
  return (
    <View style={styles.toggleTrack}>
      {(
        [
          ['portrait', '竖屏'],
          ['landscape', '横屏'],
        ] as const
      ).map(([id, label]) => {
        const active = value === id;
        return (
          <AppPressable
            key={id}
            tone={active ? 'onColor' : undefined}
            onPress={() => onChange(id)}
            style={[styles.toggleItem, active && styles.toggleItemActive]}
          >
            <Text style={[styles.toggleText, active && styles.toggleTextActive]}>
              {label}
            </Text>
          </AppPressable>
        );
      })}
    </View>
  );
}

function SubtitleSample({
  mode,
  source,
  target,
  originalMetrics,
  translationMetrics,
  originalFont,
  translationFont,
  backgroundOpacity,
  horizontalPadding,
  verticalPadding,
  translationGap,
  borderRadius,
  maxWidth,
}: {
  mode: SubtitleMode;
  source: string;
  target: string;
  originalMetrics: SubtitleTextMetrics;
  translationMetrics: SubtitleTextMetrics;
  originalFont?: string;
  translationFont?: string;
  backgroundOpacity: number;
  horizontalPadding: number;
  verticalPadding: number;
  translationGap: number;
  borderRadius: number;
  maxWidth: `${number}%`;
}) {
  return (
    <View
      style={{
        alignSelf: 'center',
        maxWidth,
        backgroundColor: `rgba(0,0,0,${backgroundOpacity})`,
        borderRadius,
        paddingHorizontal: horizontalPadding,
        paddingVertical: verticalPadding,
      }}
    >
      {mode !== 'translation' ? (
        <Text
          numberOfLines={3}
          style={{
            color: '#FFFFFF',
            fontSize: originalMetrics.fontSize,
            lineHeight: originalMetrics.lineHeight,
            fontWeight: originalMetrics.fontWeight,
            fontFamily: originalFont,
            textAlign: 'center',
          }}
        >
          {source}
        </Text>
      ) : null}
      {mode !== 'original' ? (
        <Text
          numberOfLines={3}
          style={{
            color: '#FFFFFF',
            fontSize: translationMetrics.fontSize,
            lineHeight: translationMetrics.lineHeight,
            fontWeight: translationMetrics.fontWeight,
            fontFamily: translationFont,
            marginTop: mode === 'bilingual' ? translationGap : 0,
            textAlign: 'center',
          }}
        >
          {target}
        </Text>
      ) : null}
    </View>
  );
}

function FontChoiceRow({
  options,
  value,
  onChange,
}: {
  options: SubtitleFontOption[];
  value: SubtitleFont;
  onChange: (value: SubtitleFont) => void;
}) {
  const theme = useAppTheme();
  return (
    <View style={styles.fontChipRow}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <AppPressable
            key={option.id}
            onPress={() => onChange(option.id)}
            style={[
              styles.fontChip,
              {
                backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                borderColor: active ? theme.colors.primary : 'transparent',
              },
            ]}
          >
            <Text
              style={{
                color: active ? theme.colors.primary : theme.colors.textSecondary,
                fontSize: 12,
                fontWeight: active ? '800' : '600',
              }}
            >
              {option.label}
            </Text>
          </AppPressable>
        );
      })}
    </View>
  );
}

function SizeRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const theme = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 2))}
        style={{
          width: 42,
          height: 42,
          borderRadius: RADIUS.control,
          backgroundColor: theme.colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="remove" size={20} color={theme.colors.text} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '800' }}>{value}px</Text>
        <Text style={{ color: theme.colors.textTertiary, fontSize: 10.5, marginTop: 2 }}>{label}</Text>
      </View>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 2))}
        style={{
          width: 42,
          height: 42,
          borderRadius: RADIUS.control,
          backgroundColor: theme.colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="add" size={20} color={theme.colors.text} />
      </Pressable>
    </View>
  );
}

function SettingRow({
  title,
  desc,
  value,
  onChange,
  last,
}: {
  title: string;
  desc: string;
  value: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
}) {
  const theme = useAppTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 13,
        gap: 12,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, marginTop: 3 }}>{desc}</Text>
      </View>
      <SettingSwitch value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  previewCard: {
    borderRadius: RADIUS.card,
    ...CONTINUOUS_CORNER,
    padding: 16,
    overflow: 'hidden',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  previewLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewLabelText: {
    color: 'rgba(255,255,255,.55)',
    fontSize: 10,
    fontWeight: '600',
  },
  fullPreviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    paddingHorizontal: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,.08)',
  },
  fullPreviewText: {
    color: 'rgba(255,255,255,.82)',
    fontSize: 10,
    fontWeight: '600',
  },
  toggleTrack: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,.08)',
  },
  toggleItem: {
    height: 24,
    minWidth: 42,
    paddingHorizontal: 8,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleItemActive: {
    backgroundColor: 'rgba(255,255,255,.92)',
  },
  toggleText: {
    color: 'rgba(255,255,255,.62)',
    fontSize: 10,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#15251C',
    fontWeight: '800',
  },
  fieldLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    marginBottom: 9,
  },
  fieldHint: {
    fontSize: 10.5,
    marginTop: 7,
  },
  fontChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  fontChip: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreen: {
    flex: 1,
    paddingHorizontal: 32,
  },
  closeButton: {
    position: 'absolute',
    right: 20,
    zIndex: 5,
    width: 38,
    height: 38,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(255,255,255,.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreenHint: {
    color: 'rgba(255,255,255,.42)',
    fontSize: 10.5,
    textAlign: 'center',
  },
});
