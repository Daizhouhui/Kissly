import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Pressable, Text, View } from 'react-native';

import { TARGET_LANGUAGES } from '../../src/core/defaults';
import { useAppStore } from '../../src/core/store';
import { NavHeader, SectionTitle } from '../../src/ui/components';
import { useAppTheme } from '../../src/ui/theme';

export default function LanguageSettingsScreen() {
  const theme = useAppTheme();
  const settings = useAppStore((state) => state.settings);
  const patchSettings = useAppStore((state) => state.patchSettings);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader title="语言设置" subtitle="选择字幕翻译的目标语言" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: theme.colors.card,
            borderRadius: 16,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            padding: 14,
          }}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              backgroundColor: theme.colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="sparkles-outline" size={18} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontSize: 13.5, fontWeight: '700' }}>源语言自动检测</Text>
            <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 3, lineHeight: 16 }}>
              字幕会先识别原语言，再翻译成下面选择的目标语言。
            </Text>
          </View>
        </View>

        <SectionTitle title="目标语言" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TARGET_LANGUAGES.map((language) => {
            const active = settings.targetLang === language.code;
            return (
              <Pressable
                key={language.code}
                onPress={() => patchSettings({ targetLang: language.code })}
                style={{
                  height: 42,
                  paddingHorizontal: 16,
                  borderRadius: 13,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 7,
                  backgroundColor: active ? theme.colors.primary : theme.colors.card,
                  borderWidth: active ? 0 : StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                }}
              >
                {active ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}
                <Text
                  style={{
                    color: active ? '#fff' : theme.colors.textSecondary,
                    fontSize: 12,
                    fontWeight: active ? '700' : '500',
                  }}
                >
                  {language.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, lineHeight: 18, marginTop: 18 }}>
          修改后只影响之后新翻译的字幕；已经缓存的双语字幕会在播放器里“重新翻译字幕”时更新。
        </Text>
      </ScrollView>
    </View>
  );
}
