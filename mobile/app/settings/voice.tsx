import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppStore } from '../../src/core/store';
import { CONTINUOUS_CORNER, RADIUS } from '../../src/tokens';
import { appAlert as Alert } from '../../src/ui/app-alert';
import { AppPressable } from '../../src/ui/app-pressable';
import { NavHeader } from '../../src/ui/components';
import { useAppTheme } from '../../src/ui/theme';

const Pressable = AppPressable;

function Stepper({
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const theme = useAppTheme();
  const rounded = (next: number) => Math.round(next * 100) / 100;
  return (
    <View style={[styles.stepper, { backgroundColor: theme.colors.surfaceAlt }]}>
      <Pressable
        style={styles.stepButton}
        onPress={() => onChange(rounded(Math.max(min, value - step)))}
      >
        <Ionicons name="remove" size={18} color={theme.colors.text} />
      </Pressable>
      <Text style={[styles.stepValue, { color: theme.colors.text }]}>
        {value.toFixed(2)}
        {suffix ?? ''}
      </Text>
      <Pressable
        style={styles.stepButton}
        onPress={() => onChange(rounded(Math.min(max, value + step)))}
      >
        <Ionicons name="add" size={18} color={theme.colors.text} />
      </Pressable>
    </View>
  );
}

export default function VoiceSettingsScreen() {
  const theme = useAppTheme();
  const settings = useAppStore((state) => state.settings);
  const patchSettings = useAppStore((state) => state.patchSettings);

  const preview = async () => {
    try {
      await Speech.stop();
      Speech.speak('Hello, this is Kissly. Let us learn English together.', {
        language: 'en-US',
        rate: settings.speechRate,
        pitch: settings.speechPitch,
      });
    } catch (error) {
      Alert.alert('无法朗读', error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader title="发音与朗读" subtitle="系统语音的音速与音高" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.card,
            { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
          ]}
        >
          <View style={styles.row}>
            <View style={[styles.iconBox, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="volume-medium-outline" size={20} color={theme.colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                语速
              </Text>
              <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}>
                0.50x – 1.50x，默认 0.90x
              </Text>
            </View>
            <Stepper
              value={settings.speechRate}
              min={0.5}
              max={1.5}
              step={0.05}
              suffix="x"
              onChange={(value) => patchSettings({ speechRate: value })}
            />
          </View>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={[styles.iconBox, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="options-outline" size={20} color={theme.colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                音高
              </Text>
              <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}>
                0.80 – 1.30，默认 1.00
              </Text>
            </View>
            <Stepper
              value={settings.speechPitch}
              min={0.8}
              max={1.3}
              step={0.05}
              onChange={(value) => patchSettings({ speechPitch: value })}
            />
          </View>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: theme.colors.card, borderColor: theme.colors.border, marginTop: 14 },
          ]}
        >
          <View style={styles.row}>
            <View style={[styles.iconBox, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="person-outline" size={20} color={theme.colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                发音人
              </Text>
              <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}>
                使用手机系统自带的英文语音
              </Text>
            </View>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>系统默认</Text>
          </View>
        </View>

        <Pressable
          tone="onColor"
          onPress={preview}
          style={[
            styles.previewButton,
            { backgroundColor: theme.colors.primary },
          ]}
        >
          <Ionicons name="play" size={17} color="#FFFFFF" />
          <Text style={{ color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' }}>试听</Text>
        </Pressable>

        <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, lineHeight: 18, marginTop: 16 }}>
          该设置用于系统朗读试听与单词发音；视频原声仍由 YouTube 播放器控制。部分安卓机型需要在系统设置里安装英文语音包。
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.card,
    ...CONTINUOUS_CORNER,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 66,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(120,116,104,0.16)',
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 2,
  },
  stepButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 50, textAlign: 'center', fontSize: 12.5, fontWeight: '800' },
  previewButton: {
    marginTop: 18,
    height: 46,
    borderRadius: RADIUS.control,
    ...CONTINUOUS_CORNER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
