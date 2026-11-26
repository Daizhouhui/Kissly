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
import {
  ensureUpdateCacheDirectory,
  safeUpdateFileName,
} from '../../src/core/updateCache';
import { Card, NavHeader, Row, SectionTitle } from '../../src/ui/components';
import { appAlert as Alert } from '../../src/ui/app-alert';
import { toast } from '../../src/ui/app-toast';
import { useAppTheme } from '../../src/ui/theme';

type AppRelease = {
  version: string;
  downloadUrl: string;
  size: number;
  fileName?: string;
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

const RELEASES_LATEST_PAGE = 'https://github.com/Daizhouhui/Kissly/releases/latest';

function releaseFromAsset(
  platform: 'android' | 'ios',
  version: string,
  assetPath: string,
  size = 0
): AppRelease | null {
  const extension = platform === 'ios' ? '.ipa' : '.apk';
  if (!assetPath.toLowerCase().endsWith(extension)) return null;
  const fileName = assetPath.split('/').pop() || '';
  return {
    version,
    downloadUrl: assetPath.startsWith('http')
      ? assetPath
      : `https://github.com${assetPath}`,
    size,
    fileName: decodeURIComponent(fileName),
  };
}

async function fetchLatestReleaseFromApi(
  platform: 'android' | 'ios'
): Promise<AppRelease | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Kissly-Update',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub 返回 ${response.status}`);
    }
    const release = (await response.json()) as {
      tag_name?: string;
      html_url?: string;
      assets?: Array<{
        name?: string;
        browser_download_url?: string;
        size?: number;
      }>;
    };
    if (!release.tag_name) return null;
    const extension = platform === 'ios' ? '.ipa' : '.apk';
    const asset = release.assets?.find((item) =>
      item.name?.toLowerCase().endsWith(extension)
    );
    if (!asset?.browser_download_url) {
      if (platform === 'ios') {
        return {
          version: cleanVersion(release.tag_name),
          downloadUrl: release.html_url || RELEASES_PAGE,
          size: 0,
        };
      }
      return null;
    }
    return {
      version: cleanVersion(release.tag_name),
      downloadUrl: asset.browser_download_url,
      size: asset.size ?? 0,
      fileName: asset.name,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The unauthenticated GitHub API is rate limited aggressively (403). Fall back
 * to the public release page and its expanded-assets fragment, which are not
 * subject to that quota.
 */
async function fetchLatestReleaseFromHtml(
  platform: 'android' | 'ios'
): Promise<AppRelease | null> {
  const page = await fetch(RELEASES_LATEST_PAGE, {
    headers: { 'User-Agent': 'Kissly-Update' },
  });
  if (!page.ok) throw new Error(`GitHub 返回 ${page.status}`);
  const finalUrl = page.url || RELEASES_LATEST_PAGE;
  const html = await page.text();
  const tag =
    finalUrl.match(/\/releases\/tag\/([^/?#]+)/i)?.[1] ||
    html.match(/\/releases\/tag\/([^"?#]+)/)?.[1];
  if (!tag) throw new Error('无法解析最新版本号');

  const assets = await fetch(
    `https://github.com/Daizhouhui/Kissly/releases/expanded_assets/${encodeURIComponent(tag)}`,
    { headers: { 'User-Agent': 'Kissly-Update' } }
  );
  if (!assets.ok) throw new Error(`GitHub 返回 ${assets.status}`);
  const assetsHtml = await assets.text();
  const links: string[] = [];
  const pattern = /href="(\/Daizhouhui\/Kissly\/releases\/download\/[^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(assetsHtml))) links.push(match[1]);

  const version = cleanVersion(tag);
  const extension = platform === 'ios' ? '.ipa' : '.apk';
  const assetPath = links.find((item) =>
    item.toLowerCase().endsWith(extension)
  );
  if (!assetPath) {
    if (platform === 'ios') {
      return {
        version,
        downloadUrl: finalUrl,
        size: 0,
      };
    }
    return null;
  }
  return releaseFromAsset(platform, version, assetPath);
}

async function fetchLatestRelease(
  platform: 'android' | 'ios'
): Promise<AppRelease | null> {
  try {
    return await fetchLatestReleaseFromApi(platform);
  } catch (apiError) {
    try {
      return await fetchLatestReleaseFromHtml(platform);
    } catch {
      throw apiError;
    }
  }
}

export default function MoreSettingsScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const currentVersion = cleanVersion(
    Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? '1.2.11'
  );
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

  const downloadAndInstall = async (release: AppRelease) => {
    const updateDirectory = await ensureUpdateCacheDirectory();
    if (!updateDirectory) {
      toast.error('更新失败：没有可用的缓存目录');
      return;
    }

    const target = `${updateDirectory}${safeUpdateFileName(
      release.fileName || '',
      release.version
    )}`;
    setUpdatePhase('downloading');
    setDownloadProgress(0);
    try {
      await FileSystem.deleteAsync(target, { idempotent: true });
      const task = FileSystem.createDownloadResumable(
        release.downloadUrl,
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
      const release = await fetchLatestRelease('android');
      if (!release) {
        toast.info('最新版本没有提供安卓安装包');
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
      toast.error(`检查更新失败：无法读取远程版本信息（${message}）`);
    } finally {
      setUpdatePhase('idle');
    }
  };

  const checkForIosUpdate = async () => {
    if (updatePhase !== 'idle') return;
    setUpdatePhase('checking');
    try {
      const release = await fetchLatestRelease('ios');
      if (!release) {
        toast.info('最新版本没有提供 iOS 安装包');
        return;
      }
      if (!isNewerVersion(release.version, currentVersion)) {
        toast.info(`已是最新版本 v${currentVersion}`);
        return;
      }
      await Linking.openURL(release.downloadUrl);
    } catch (error) {
      toast.error(
        `打开下载链接失败：${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setUpdatePhase('idle');
    }
  };

  const checkForUpdate = () => {
    if (Platform.OS === 'ios') {
      void checkForIosUpdate();
      return;
    }
    if (Platform.OS !== 'android') {
      toast.info('当前平台暂不支持应用内更新');
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
      toast.success(`缓存已清除：已清理 ${removed} 项临时缓存`);
    } catch (error) {
      toast.error(
        `清除缓存失败：${error instanceof Error ? error.message : String(error)}`
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
            toast.success('已恢复默认设置，WebDAV 连接和账号数据已保留');
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
            subtitle={
              Platform.OS === 'ios'
                ? '检测到新版本会打开浏览器下载 IPA，需自行签名安装'
                : undefined
            }
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
