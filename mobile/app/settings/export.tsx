import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '../../src/core/store';
import { CONTINUOUS_CORNER, RADIUS } from '../../src/tokens';
import { toast } from '../../src/ui/app-toast';
import { AppPressable } from '../../src/ui/app-pressable';
import { NavHeader } from '../../src/ui/components';
import { useAppTheme } from '../../src/ui/theme';

const Pressable = AppPressable;

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

async function shareText(filename: string, content: string, mimeType: string) {
  if (!(await Sharing.isAvailableAsync())) {
    toast.info('当前设备没有可用的系统分享面板');
    return;
  }
  const path = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(path, content);
  await Sharing.shareAsync(path, {
    mimeType,
    dialogTitle: '导出 Kissly 数据',
    UTI: mimeType === 'text/csv' ? 'public.comma-separated-values-text' : 'public.json',
  });
}

function reportExportError(error: unknown) {
  toast.error(
    `导出失败：${error instanceof Error ? error.message : String(error)}`
  );
}

function ExportRow({
  icon,
  title,
  subtitle,
  count,
  onPress,
}: {
  icon: any;
  title: string;
  subtitle: string;
  count: string;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.row,
        { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: theme.colors.primarySoft }]}>
        <Ionicons name={icon} size={21} color={theme.colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}>
          {subtitle}
        </Text>
      </View>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginRight: 7 }}>{count}</Text>
      <Ionicons name="share-outline" size={18} color={theme.colors.textTertiary} />
    </Pressable>
  );
}

export default function ExportScreen() {
  const theme = useAppTheme();
  const settings = useAppStore((state) => state.settings);
  const subscriptions = useAppStore((state) => state.subscriptions);
  const favorites = useAppStore((state) => state.favorites);
  const history = useAppStore((state) => state.history);

  const exportHistory = async () => {
    const rows = [
      [
        'videoId',
        'title',
        'author',
        'progress',
        'duration',
        'savedAt',
        'lastWatchedAt',
      ],
      ...history.map((item) => [
        item.videoId,
        item.title,
        item.author,
        item.progress ?? 0,
        item.duration ?? 0,
        new Date(item.savedAt).toISOString(),
        new Date(item.lastWatchedAt ?? item.savedAt).toISOString(),
      ]),
    ];
    await shareText(
      'kissly-history.csv',
      '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n'),
      'text/csv'
    );
  };

  const exportFavorites = async () => {
    const rows = [
      ['videoId', 'title', 'author', 'savedAt'],
      ...favorites.map((item) => [
        item.videoId,
        item.title,
        item.author,
        new Date(item.savedAt).toISOString(),
      ]),
    ];
    await shareText(
      'kissly-favorites.csv',
      '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n'),
      'text/csv'
    );
  };

  const exportSubscriptions = async () => {
    const rows = [
      ['channelId', 'title', 'handle', 'url', 'group'],
      ...subscriptions.map((item) => [
        item.channelId,
        item.title,
        item.handle ?? '',
        item.handle
          ? `https://www.youtube.com/@${item.handle.replace(/^@/, '')}`
          : `https://www.youtube.com/channel/${item.channelId}`,
        item.group ?? '',
      ]),
    ];
    await shareText(
      'kissly-subscriptions.csv',
      '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n'),
      'text/csv'
    );
  };

  const exportSettings = async () => {
    const safe = JSON.parse(JSON.stringify(settings));
    if (safe.webdav) {
      delete safe.webdav.password;
    }
    await shareText(
      'kissly-settings.json',
      JSON.stringify(
        {
          app: 'Kissly',
          exportedAt: new Date().toISOString(),
          settings: safe,
        },
        null,
        2
      ),
      'application/json'
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader title="导出" subtitle="导出为 CSV / JSON，再通过系统分享保存" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: 10 }}>
          <ExportRow
            icon="time-outline"
            title="历史记录"
            subtitle="视频、频道、进度与时间"
            count={`${history.length} 条`}
            onPress={() => exportHistory().catch(reportExportError)}
          />
          <ExportRow
            icon="heart-outline"
            title="收藏"
            subtitle="收藏的视频与保存时间"
            count={`${favorites.length} 个`}
            onPress={() => exportFavorites().catch(reportExportError)}
          />
          <ExportRow
            icon="albums-outline"
            title="订阅"
            subtitle="频道 ID、名称与主页地址"
            count={`${subscriptions.length} 个`}
            onPress={() => exportSubscriptions().catch(reportExportError)}
          />
          <ExportRow
            icon="options-outline"
            title="应用设置"
            subtitle="不含 WebDAV 密码"
            count="JSON"
            onPress={() => exportSettings().catch(reportExportError)}
          />
        </View>
        <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, lineHeight: 18, marginTop: 18 }}>
          CSV 使用 UTF-8 BOM 编码，可直接用 Excel 打开。订阅导入仍可在“订阅管理”里选择 CSV 文件。
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 68,
    borderRadius: RADIUS.card,
    ...CONTINUOUS_CORNER,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
});
