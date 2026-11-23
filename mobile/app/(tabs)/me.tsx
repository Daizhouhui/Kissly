import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PROVIDER_LABELS, targetLabel } from '../../src/core/defaults';
import { useAppStore } from '../../src/core/store';
import { syncNow } from '../../src/core/sync';
import { relativeTime } from '../../src/core/utils';
import { CONTINUOUS_CORNER, RADIUS } from '../../src/tokens';
import { appAlert as Alert } from '../../src/ui/app-alert';
import { AppPressable } from '../../src/ui/app-pressable';
import { useAppTheme } from '../../src/ui/theme';

const Pressable = AppPressable;

function MeRow({
  icon,
  title,
  subtitle,
  value,
  valueColor,
  onPress,
  last,
  disabled,
  roomy,
}: {
  icon: any;
  title: string;
  subtitle?: string;
  value?: string;
  valueColor?: string;
  onPress?: () => void;
  last?: boolean;
  disabled?: boolean;
  roomy?: boolean;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress || disabled}
      radius={0}
      style={[
        styles.row,
        roomy && styles.rowRoomy,
        !last && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Ionicons name={icon} size={21} color={theme.colors.textSecondary} style={styles.rowIcon} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          style={{
            color: valueColor ?? theme.colors.textTertiary,
            fontSize: 12.5,
            marginLeft: 8,
            maxWidth: 150,
          }}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {onPress && !disabled ? (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={theme.colors.textTertiary}
          style={{ marginLeft: 8 }}
        />
      ) : null}
    </Pressable>
  );
}

function Group({ children, first }: { children: ReactNode; first?: boolean }) {
  const theme = useAppTheme();
  return (
    <View
      style={{
        marginTop: first ? 24 : 14,
        backgroundColor: theme.colors.card,
        borderRadius: RADIUS.card,
        ...CONTINUOUS_CORNER,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] ?? provider;
}

const TITLE_OPTIONS = [
  { id: 'none' as const, label: '不翻译', desc: '标题只显示原文' },
  { id: 'bilingual' as const, label: '双语对照', desc: '原文在上，译文在下' },
  { id: 'translation' as const, label: '仅显示译文', desc: '优先展示翻译后的标题' },
];

const TAB_OPTIONS = [
  { id: 'video' as const, label: '视频', desc: '打开应用进入视频流' },
  { id: 'podcast' as const, label: '播客', desc: '打开应用进入长节目' },
  { id: 'learning' as const, label: '学习', desc: '打开应用进入学习页' },
  { id: 'me' as const, label: '我的', desc: '打开应用进入设置' },
];

export default function MeScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const settings = useAppStore((state) => state.settings);
  const historyCount = useAppStore((state) => state.history.length);
  const lastSyncAt = useAppStore((state) => state.lastSyncAt);
  const syncState = useAppStore((state) => state.syncState);
  const youtubeLoginStatus = useAppStore((state) => state.youtubeLoginStatus);
  const patchSettings = useAppStore((state) => state.patchSettings);
  const [syncing, setSyncing] = useState(false);
  const [dialog, setDialog] = useState<'title' | 'tab' | null>(null);
  const version = Constants.expoConfig?.version ?? '1.2.11';

  const runSync = async () => {
    if (!settings.webdav.enabled) {
      router.push('/settings/webdav' as any);
      return;
    }
    setSyncing(true);
    try {
      const message = await syncNow();
      Alert.alert('同步完成', message);
    } catch (error) {
      Alert.alert('同步失败', error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  };

  const titleValue =
    TITLE_OPTIONS.find((option) => option.id === settings.titleTranslationMode)?.label ?? '双语对照';
  const tabValue =
    TAB_OPTIONS.find((option) => option.id === settings.defaultTab)?.label ?? '视频';
  const speechLabel = `系统语音 · ${settings.speechRate.toFixed(2)}x`;
  const loginValue =
    youtubeLoginStatus === 'loggedIn'
      ? '已登录'
      : youtubeLoginStatus === 'loggedOut'
        ? '未登录'
        : '检测中…';
  const loginValueColor =
    youtubeLoginStatus === 'loggedIn' ? '#2FB980' : theme.colors.textTertiary;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 26,
          paddingHorizontal: 16,
          paddingBottom: 110,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={{
            color: theme.colors.text,
            fontSize: 28,
            fontWeight: '800',
            marginTop: 0,
            marginBottom: 12,
          }}
        >
          我的
        </Text>

        <Group first>
          <MeRow
            icon="person-circle-outline"
            title="账号"
            subtitle="YouTube 登录、头像与订阅同步"
            value={loginValue}
            valueColor={loginValueColor}
            onPress={() => router.push('/youtube-account' as any)}
            roomy
          />
          <MeRow
            icon="time-outline"
            title="历史记录"
            value={`${historyCount} 条`}
            onPress={() => router.push('/history' as any)}
          />
          <MeRow
            icon="language-outline"
            title="翻译引擎"
            value={providerLabel(settings.provider)}
            onPress={() => router.push('/settings/translation' as any)}
          />
          <MeRow
            icon="volume-high-outline"
            title="发音与朗读"
            value={speechLabel}
            onPress={() => router.push('/settings/voice' as any)}
          />
          <MeRow
            icon="download-outline"
            title="导出"
            subtitle="历史、收藏、订阅与设置"
            onPress={() => router.push('/settings/export' as any)}
            last
          />
        </Group>

        <Group>
          <MeRow
            icon="globe-outline"
            title="语言设置"
            value={`${targetLabel(settings.learningLang)} · ${targetLabel(settings.targetLang)}`}
            onPress={() => router.push('/settings/language' as any)}
          />
          <MeRow
            icon="color-palette-outline"
            title="外观"
            value={
              settings.theme === 'system' ? '跟随系统' : settings.theme === 'light' ? '浅色' : '深色'
            }
            onPress={() => router.push('/settings/appearance' as any)}
          />
          <MeRow
            icon="text-outline"
            title="标题翻译"
            value={titleValue}
            onPress={() => setDialog('title')}
          />
          <MeRow
            icon="document-text-outline"
            title="字幕样式"
            subtitle="字号、显示方式与位置"
            value={`${settings.subtitle.fontSize}px`}
            onPress={() => router.push('/settings/subtitle' as any)}
          />
          <MeRow
            icon="phone-portrait-outline"
            title="默认打开页"
            value={tabValue}
            onPress={() => setDialog('tab')}
            last
          />
        </Group>

        <Group>
          <MeRow
            icon="cloud-outline"
            title="WebDAV 同步"
            subtitle={lastSyncAt ? `上次同步 ${relativeTime(lastSyncAt)}` : '与网盘同步订阅和设置'}
            value={settings.webdav.enabled ? (syncState === 'error' ? '异常' : '已开启') : '未配置'}
            onPress={() => router.push('/settings/webdav' as any)}
          />
          <MeRow
            icon="share-social-outline"
            title="分享 Kissly"
            onPress={() =>
              Share.share({
                message: 'Kissly：在 YouTube 里读懂每一句话。https://github.com/Daizhouhui/Kissly',
              }).catch(() => {})
            }
          />
          <MeRow
            icon="chatbubble-ellipses-outline"
            title="反馈问题"
            onPress={() =>
              Linking.openURL('https://github.com/Daizhouhui/Kissly/issues').catch(() => {})
            }
          />
          <MeRow
            icon="information-circle-outline"
            title="关于"
            value={version}
            onPress={() => router.push('/settings/about' as any)}
            last
          />
        </Group>

        {settings.webdav.enabled ? (
          <Pressable
            onPress={runSync}
            disabled={syncing}
            style={styles.syncButton}
          >
            {syncing || syncState === 'syncing' ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Ionicons name="sync-outline" size={17} color={theme.colors.primary} />
            )}
            <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '700' }}>
              {syncing ? '正在同步…' : '立即同步'}
            </Text>
          </Pressable>
        ) : null}

        <Text
          style={{
            color: theme.colors.textTertiary,
            fontSize: 10.5,
            textAlign: 'center',
            marginTop: 24,
          }}
        >
          Kissly {version} · 把 YouTube 变成你的双语课堂
        </Text>
      </ScrollView>

      <Modal visible={dialog !== null} transparent animationType="fade">
        <Pressable feedback="none" style={styles.dialogMask} onPress={() => setDialog(null)}>
          <Pressable
            feedback="none"
            style={[styles.dialogCard, { backgroundColor: theme.colors.card }]}
            onPress={() => {}}
          >
            <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: '800', marginBottom: 18 }}>
              {dialog === 'title' ? '标题翻译' : '默认打开页'}
            </Text>
            {(dialog === 'title' ? TITLE_OPTIONS : TAB_OPTIONS).map((option) => {
              const current =
                dialog === 'title'
                  ? settings.titleTranslationMode === option.id
                  : settings.defaultTab === option.id;
              return (
                <Pressable
                  key={option.id}
                  feedback="opacity"
                  onPress={() => {
                    if (dialog === 'title') {
                      patchSettings({
                        titleTranslationMode: option.id as typeof settings.titleTranslationMode,
                      });
                    } else {
                      patchSettings({ defaultTab: option.id as typeof settings.defaultTab });
                    }
                    setDialog(null);
                  }}
                  style={styles.dialogRow}
                >
                  <View
                    style={[
                      styles.radio,
                      { borderColor: current ? theme.colors.primary : theme.colors.borderStrong },
                      current && { backgroundColor: theme.colors.primary },
                    ]}
                  >
                    {current ? <View style={styles.radioInner} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600' }}>
                      {option.label}
                    </Text>
                    <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}>
                      {option.desc}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            <Pressable onPress={() => setDialog(null)} feedback="opacity" style={styles.dialogCancel}>
              <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '700' }}>
                取消
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  rowRoomy: {
    minHeight: 66,
    paddingVertical: 12,
  },
  rowIcon: { width: 28, marginRight: 9 },
  syncButton: {
    marginTop: 14,
    height: 44,
    borderRadius: RADIUS.control,
    ...CONTINUOUS_CORNER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dialogMask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  dialogCard: { width: '100%', maxWidth: 390, borderRadius: RADIUS.modal, ...CONTINUOUS_CORNER, padding: 22, paddingBottom: 12 },
  dialogRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: { width: 8, height: 8, borderRadius: RADIUS.pill, backgroundColor: '#FFFFFF' },
  dialogCancel: { alignSelf: 'flex-end', paddingVertical: 12, paddingHorizontal: 4 },
});
