import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';

import { clearGlobalCaches } from '../../src/core/appCache';
import { useAppStore } from '../../src/core/store';
import { Card, NavHeader, Row, SectionTitle } from '../../src/ui/components';
import { appAlert as Alert } from '../../src/ui/app-alert';
import { useAppTheme } from '../../src/ui/theme';

type AndroidRelease = {
  version: string;
  apkUrl: string;
  size: number;
};

type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'installing';

const RELEASES_API =
  'https://api.github.com/repos/Daizhouhui/Kissly/releases/latest';
const RELEASES_PAGE = 'https://github.com/Daizhouhui/Kissly/releases';
const APK_MIME = 'application/vnd.android.package-archive';
const INSTALL_FLAG_GRANT_READ_URI_PERMISSION = 1;

function cleanVersion(value: string) {
  return value.replace(/^v/i, '').trim();
}

function versionParts(value: string) {
  return cleanVersion(value)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number(part));
}

function isNewerVersion(latest: string, current: string) {
  const next = versionParts(latest);
  const now = versionParts(current);
  const length = Math.max(next.length, now.length);
  for (let index = 0; index < length; index += 1) {
    const a = next[index] ?? 0;
    const b = now[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

async function fetchLatestAndroidRelease(): Promise<AndroidRelease | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Kissly-Android-Update',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub 返回 ${response.status}`);
    }
    const release = (await response.json()) as {
      tag_name?: string;
      assets?: Array<{
        name?: string;
        browser_download_url?: string;
        size?: number;
      }>;
    };
    const apk = release.assets?.find((asset) =>
      asset.name?.toLowerCase().endsWith('.apk')
    );
    if (!release.tag_name || !apk?.browser_download_url) return null;
    return {
      version: cleanVersion(release.tag_name),
      apkUrl: apk.browser_download_url,
      size: apk.size ?? 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default function MoreSettingsScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const currentVersion = cleanVersion(Constants.expoConfig?.version ?? '1.2.11');
  const resetSettings = useAppStore((state) => state.resetSettings);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [maintenance, setMaintenance] = useState<'cache' | 'reset' | null>(null);

  const openInstallSettings = () => {
    IntentLauncher.startActivityAsync(
      'android.settings.MANAGE_UNKNOWN_APP_SOURCES',
      {
        data: `package:${
          Constants.expoConfig?.android?.package ?? 'com.knny.kisssubtitle'
        }`,
      }
    ).catch(() => {
      Linking.openSettings();
    });
  };

  const downloadAndInstall = async (release: AndroidRelease) => {
    const cacheDirectory = FileSystem.cacheDirectory;
    if (!cacheDirectory) {
      Alert.alert('更新失败', '没有可用的缓存目录，无法下载安装包。');
      return;
    }

    const target = `${cacheDirectory}kissly-${release.version}.apk`;
    setUpdatePhase('downloading');
    setDownloadProgress(0);
    try {
      await FileSystem.deleteAsync(target, { idempotent: true });
      const task = FileSystem.createDownloadResumable(
        release.apkUrl,
        target,
        { headers: { Accept: 'application/octet-stream' } },
        (event) => {
          const total = event.totalBytesExpectedToWrite;
          if (total <= 0) return;
          const percent = Math.min(
            99,
            Math.round((event.totalBytesWritten / total) * 100)
          );
          setDownloadProgress((value) => (value === percent ? value : percent));
        }
      );
      const result = await task.downloadAsync();
      if (!result?.uri) throw new Error('下载没有完成，请重试。');

      setUpdatePhase('installing');
      setDownloadProgress(100);
      const contentUri = await FileSystem.getContentUriAsync(result.uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: APK_MIME,
        flags: INSTALL_FLAG_GRANT_READ_URI_PERMISSION,
      });
      setUpdatePhase('idle');
    } catch (error) {
      setUpdatePhase('idle');
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert(
        '更新失败',
        `${message}\n\n如果系统阻止安装，请允许 Kissly 安装未知应用。`,
        [
          { text: '知道了', style: 'cancel' },
          { text: '去设置', onPress: openInstallSettings },
        ]
      );
    }
  };

  const checkForAndroidUpdate = async () => {
    if (Platform.OS !== 'android' || updatePhase !== 'idle') return;
    setUpdatePhase('checking');
    try {
      const release = await fetchLatestAndroidRelease();
      if (!release) {
        Alert.alert('检查更新', '最新版本没有提供安卓安装包。');
        return;
      }
      if (!isNewerVersion(release.version, currentVersion)) {
        Alert.alert(
          '已是最新版本',
          `当前 v${currentVersion} 已经是远程最新版本。\n\n需要重新下载并覆盖安装吗？`,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '重新安装',
              onPress: () => {
                void downloadAndInstall(release);
              },
            },
          ]
        );
        return;
      }
      Alert.alert(
        '发现新版本',
        `v${release.version}（当前 v${currentVersion}）\n\n是否下载并安装？`,
        [
          { text: '稍后', style: 'cancel' },
          {
            text: '下载并安装',
            onPress: () => {
              void downloadAndInstall(release);
            },
          },
        ]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('检查更新失败', `无法读取远程版本信息：${message}`);
    } finally {
      setUpdatePhase('idle');
    }
  };

  const checkForUpdate = () => {
    if (Platform.OS !== 'android') {
      Alert.alert(
        '检查更新',
        `当前版本 v${currentVersion}。\niOS 版需要在电脑上重新安装 IPA，应用内暂不支持自动更新。`,
        [
          { text: '取消', style: 'cancel' },
          { text: '查看发布页', onPress: () => Linking.openURL(RELEASES_PAGE) },
        ]
      );
      return;
    }
    void checkForAndroidUpdate();
  };

  const updateLabel =
    updatePhase === 'checking'
      ? '正在检查更新…'
      : updatePhase === 'downloading'
        ? `正在下载 ${downloadProgress}%`
        : updatePhase === 'installing'
          ? '正在打开安装器…'
          : undefined;

  const runClearCache = async () => {
    if (maintenance) return;
    setMaintenance('cache');
    try {
      const removed = await clearGlobalCaches();
      Alert.alert(
        '缓存已清除',
        `已清理 ${removed} 项字幕、翻译、订阅流和视频信息缓存。\n\n历史、收藏、订阅、设置和账号数据都没有改动。`
      );
    } catch (error) {
      Alert.alert(
        '清除缓存失败',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setMaintenance(null);
    }
  };

  const confirmClearCache = () => {
    if (maintenance) return;
    Alert.alert(
      '清除缓存？',
      '会删除字幕、翻译、订阅流、标题和视频信息的临时缓存，下次打开视频会重新加载。\n\n不会删除历史、收藏、订阅、设置或账号数据。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清除缓存',
          style: 'destructive',
          onPress: () => {
            void runClearCache();
          },
        },
      ]
    );
  };

  const confirmResetSettings = () => {
    if (maintenance) return;
    Alert.alert(
      '恢复默认设置？',
      '会重置语言、翻译引擎、字幕、外观和默认打开页等偏好。\n\n不会删除历史、收藏、订阅、WebDAV 连接配置或已保存的 API Key。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '恢复默认',
          style: 'destructive',
          onPress: () => {
            setMaintenance('reset');
            resetSettings();
            setMaintenance(null);
            Alert.alert(
              '已恢复默认设置',
              '偏好设置已重置为初始值，WebDAV 连接和账号数据已保留。'
            );
          },
        },
      ]
    );
  };

  const shareApp = () => {
    Share.share({
      message: 'Kissly：在 YouTube 里读懂每一句话。https://github.com/Daizhouhui/Kissly',
    }).catch(() => {});
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader title="更多设置" subtitle="缓存、重置与更新" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionTitle title="存储与维护" />
        <Card style={{ paddingVertical: 2, paddingHorizontal: 16 }}>
          <Row
            icon="trash-outline"
            title="清理缓存"
            subtitle="字幕、翻译、订阅流、视频信息临时文件"
            value={maintenance === 'cache' ? '清理中…' : undefined}
            onPress={confirmClearCache}
          />
          <Row
            icon="download-outline"
            title="导出"
            subtitle="历史、收藏、订阅与设置"
            onPress={() => router.push('/settings/export' as any)}
          />
          <Row
            icon="refresh-outline"
            title="恢复默认设置"
            subtitle="只重置偏好，不删历史、收藏、订阅"
            danger
            onPress={confirmResetSettings}
            last
          />
        </Card>

        <SectionTitle title="支持与关于" />
        <Card style={{ paddingVertical: 2, paddingHorizontal: 16 }}>
          <Row
            icon="share-social-outline"
            title="分享 Kissly"
            subtitle="把双语学习工具分享给朋友"
            onPress={shareApp}
          />
          <Row
            icon="chatbubble-ellipses-outline"
            title="反馈问题"
            subtitle="到 GitHub Issues 提交问题"
            onPress={() =>
              Linking.openURL('https://github.com/Daizhouhui/Kissly/issues').catch(() => {})
            }
          />
          <Row
            icon="information-circle-outline"
            title="关于"
            value={`v${currentVersion}`}
            onPress={() => router.push('/settings/about' as any)}
          />
          <Row
            icon={updatePhase !== 'idle' ? 'sync-outline' : 'cloud-download-outline'}
            title="检查更新"
            value={updateLabel}
            onPress={checkForUpdate}
            last
          />
        </Card>

        <View
          style={{
            marginTop: 26,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textTertiary} />
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11 }}>
            API Key 与 WebDAV 密码保存在系统安全存储
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
