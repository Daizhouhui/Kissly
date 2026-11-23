import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '../../src/core/store';
import { ThemePreference } from '../../src/core/types';
import { CONTINUOUS_CORNER, RADIUS } from '../../src/tokens';
import { AppPressable } from '../../src/ui/app-pressable';
import { NavHeader, SectionTitle } from '../../src/ui/components';
import { useAppTheme } from '../../src/ui/theme';
import { getTheme, THEME_ACCENTS } from '../../src/theme';

const Pressable = AppPressable;

const MODES: Array<{ id: ThemePreference; label: string; icon: any }> = [
  { id: 'system', label: '跟随系统', icon: 'phone-portrait-outline' },
  { id: 'light', label: '浅色', icon: 'sunny-outline' },
  { id: 'dark', label: '深色', icon: 'moon-outline' },
];

function ModeChip({
  active,
  label,
  icon,
  onPress,
}: {
  active: boolean;
  label: string;
  icon: any;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      tone={active ? 'onColor' : 'surface'}
      style={[
        styles.modeChip,
        {
          backgroundColor: active ? theme.colors.primary : theme.colors.surface,
          borderColor: active ? theme.colors.primary : theme.colors.border,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={active ? '#FFFFFF' : theme.colors.textSecondary}
      />
      <Text
        style={{
          color: active ? '#FFFFFF' : theme.colors.text,
          fontSize: 12,
          fontWeight: active ? '800' : '600',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function AppearanceSettingsScreen() {
  const theme = useAppTheme();
  const settings = useAppStore((state) => state.settings);
  const patchSettings = useAppStore((state) => state.patchSettings);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader title="外观与主题" subtitle="浅色、深色与主题色" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionTitle title="显示模式" />
        <View style={styles.modeRow}>
          {MODES.map((mode) => (
            <ModeChip
              key={mode.id}
              active={settings.theme === mode.id}
              label={mode.label}
              icon={mode.icon}
              onPress={() => patchSettings({ theme: mode.id })}
            />
          ))}
        </View>
        <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, lineHeight: 18, marginTop: 8 }}>
          跟随系统会随手机的浅色/深色设置自动切换；主题设置只保存在本机，不通过 WebDAV 同步。
        </Text>

        <SectionTitle title="主题色" />
        <View style={styles.accentGrid}>
          {THEME_ACCENTS.map((accent) => {
            const active = settings.themeAccent === accent.id;
            const preview = getTheme(theme.mode, accent.id);
            return (
              <Pressable
                key={accent.id}
                radius={RADIUS.card}
                onPress={() => patchSettings({ themeAccent: accent.id })}
                style={[
                  styles.accentCard,
                  {
                    backgroundColor: theme.colors.card,
                    borderColor: active ? preview.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.accentDot,
                    { backgroundColor: preview.colors.primary },
                  ]}
                >
                  {active ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
                </View>
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }}>
                  {accent.label}
                </Text>
                <Text style={{ color: theme.colors.textTertiary, fontSize: 10.5, marginTop: 2 }}>
                  {accent.id === 'blue' ? '默认' : '主题色'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <SectionTitle title="预览" />
        <View
          style={[
            styles.previewCard,
            { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={[styles.previewIcon, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="play" size={18} color={theme.colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '800' }}>
                双语字幕预览
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, marginTop: 3 }}>
                标题翻译会使用稍暗的同色系文字
              </Text>
            </View>
          </View>
          <View style={[styles.previewButton, { backgroundColor: theme.colors.primary }]}>
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>主按钮</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: 'row', gap: 8 },
  modeChip: {
    flex: 1,
    height: 44,
    borderRadius: RADIUS.control,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  accentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  accentCard: {
    width: '31%',
    minWidth: 92,
    borderRadius: RADIUS.card,
    ...CONTINUOUS_CORNER,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 5,
  },
  accentDot: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCard: {
    borderRadius: RADIUS.card,
    ...CONTINUOUS_CORNER,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 14,
  },
  previewIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewButton: {
    alignSelf: 'flex-start',
    borderRadius: RADIUS.control,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
});
