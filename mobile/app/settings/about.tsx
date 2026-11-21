import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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

export default function AboutScreen() {
  const theme = useAppTheme();
  const currentVersion = cleanVersion(Constants.expoConfig?.version ?? '1.2.6');
  const currentBuild =
    Platform.OS === 'android'
      ? Constants.expoConfig?.android?.versionCode
      : Constants.expoConfig?.ios?.buildNumber;
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);

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

  const updateLabel =
    updatePhase === 'checking'
      ? '正在检查更新…'
      : updatePhase === 'downloading'
        ? `正在下载 ${downloadProgress}%`
        : updatePhase === 'installing'
          ? '正在打开安装器…'
          : '检查更新';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader title="关于" subtitle="Kissly" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 36 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', marginTop: 14, marginBottom: 26 }}>
          <LinearGradient
            colors={['#8B72FF', '#6C4DF6', '#5336D9']}
            style={{
              width: 92,
              height: 92,
              borderRadius: 28,
              alignItems: 'center',
              justifyContent: 'center',
              ...theme.shadow.floating,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 40, fontWeight: '900' }}>K</Text>
          </LinearGradient>
          <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '800', marginTop: 16, letterSpacing: -0.4 }}>
            Kissly
          </Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: 12, marginTop: 5 }}>
            v{currentVersion}
            {currentBuild ? ` · ${currentBuild}` : ''}
          </Text>
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: 12.5,
              lineHeight: 19,
              textAlign: 'center',
              marginTop: 14,
              maxWidth: 300,
            }}
          >
            把 YouTube 的双语字幕做成一个安静的阅读器：竖屏逐句跟读，横屏沉浸观看，订阅与设置随 WebDAV 走。
          </Text>
        </View>

        <SectionTitle title="链接" />
        <Card style={{ paddingVertical: 2, paddingHorizontal: 16 }}>
          <Row
            icon="logo-github"
            title="GitHub 仓库"
            subtitle="源码、构建脚本与问题反馈"
            onPress={() => Linking.openURL('https://github.com/Daizhouhui/Kissly')}
          />
          <Row
            icon="git-branch-outline"
            title="Kiss Translator 上游"
            subtitle="桌面扩展与网页版的原始项目"
            onPress={() => Linking.openURL('https://github.com/fishjar/kiss-translator')}
          />
          <Row
            icon="document-text-outline"
            title="GPL-3.0 许可证"
            onPress={() => Linking.openURL('https://www.gnu.org/licenses/gpl-3.0.html')}
            last
          />
        </Card>

        <SectionTitle title="说明" />
        <Card>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12.5, lineHeight: 20 }}>
            本应用是 Kiss Translator 的移动端独立实现，不是浏览器套壳。视频播放通过应用内加载
            YouTube 观看页完成，字幕由本应用抓取、翻译并绘制。字幕与翻译内容仅供个人学习使用，请尊重原视频版权。
          </Text>
          <View style={{ height: 12 }} />
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, lineHeight: 18 }}>
            没有广告、没有账号体系、不上传观看记录。API Key 与 WebDAV 密码保存在系统安全存储中。
          </Text>
        </Card>

        <Pressable
          onPress={() => Linking.openURL('https://github.com/Daizhouhui/Kissly/releases')}
          style={({ pressed }) => ({
            marginTop: 22,
            height: 48,
            borderRadius: 14,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.card,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 7,
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <Ionicons name="cloud-download-outline" size={17} color={theme.colors.text} />
          <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>查看最新构建</Text>
        </Pressable>

        {Platform.OS === 'android' ? (
          <Pressable
            onPress={() => {
              void checkForAndroidUpdate();
            }}
            disabled={updatePhase !== 'idle'}
            style={({ pressed }) => ({
              marginTop: 10,
              height: 48,
              borderRadius: 14,
              backgroundColor: theme.colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 7,
              opacity:
                updatePhase !== 'idle' ? 0.72 : pressed ? 0.82 : 1,
            })}
          >
            {updatePhase !== 'idle' ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Ionicons name="refresh-outline" size={18} color="#FFFFFF" />
            )}
            <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>
              {updateLabel}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
