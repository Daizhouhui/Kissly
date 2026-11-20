import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TARGET_LANGUAGES } from '../../src/core/defaults';
import { useAppStore } from '../../src/core/store';
import { NavHeader } from '../../src/ui/components';
import { useAppTheme } from '../../src/ui/theme';

const LEARNING_LANGUAGES = [
  { code: 'en', label: 'English', native: '英语' },
  { code: 'ja', label: '日本語', native: '日语' },
  { code: 'ko', label: '한국어', native: '韩语' },
  { code: 'es', label: 'Español', native: '西班牙语' },
  { code: 'fr', label: 'Français', native: '法语' },
  { code: 'de', label: 'Deutsch', native: '德语' },
];

export default function LanguageSettingsScreen() {
  const theme = useAppTheme();
  const settings = useAppStore((state) => state.settings);
  const patchSettings = useAppStore((state) => state.patchSettings);
  const [panel, setPanel] = useState<'learning' | 'target' | null>(null);

  const learning =
    LEARNING_LANGUAGES.find((language) => language.code === settings.learningLang) ??
    LEARNING_LANGUAGES[0];
  const target =
    TARGET_LANGUAGES.find((language) => language.code === settings.targetLang) ??
    TARGET_LANGUAGES[0];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader title="语言" subtitle="学习语言、翻译语言与界面语言" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.group,
            { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
          ]}
        >
          <Pressable onPress={() => setPanel('learning')} style={styles.row}>
            <View style={[styles.iconBox, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="school-outline" size={20} color={theme.colors.primary} />
            </View>
            <Text style={[styles.rowTitle, { color: theme.colors.text }]}>学习中</Text>
            <Text style={[styles.rowValue, { color: theme.colors.textSecondary }]}>
              {learning.label}
            </Text>
            <Ionicons name="chevron-forward" size={17} color={theme.colors.textTertiary} />
          </Pressable>
          <Pressable onPress={() => setPanel('target')} style={styles.row}>
            <View style={[styles.iconBox, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="language-outline" size={20} color={theme.colors.primary} />
            </View>
            <Text style={[styles.rowTitle, { color: theme.colors.text }]}>翻译语言</Text>
            <Text style={[styles.rowValue, { color: theme.colors.textSecondary }]}>
              {target.label}
            </Text>
            <Ionicons name="chevron-forward" size={17} color={theme.colors.textTertiary} />
          </Pressable>
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={[styles.iconBox, { backgroundColor: theme.colors.primarySoft }]}>
              <Ionicons name="globe-outline" size={20} color={theme.colors.primary} />
            </View>
            <Text style={[styles.rowTitle, { color: theme.colors.text }]}>界面语言</Text>
            <Text style={[styles.rowValue, { color: theme.colors.textSecondary }]}>
              中文（中国）
            </Text>
          </View>
        </View>

        {panel ? (
          <View style={{ marginTop: 24 }}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 10, marginLeft: 4 }}>
              {panel === 'learning' ? '选择学习语言' : '选择翻译语言'}
            </Text>
            {(panel === 'learning' ? LEARNING_LANGUAGES : TARGET_LANGUAGES).map((language) => {
              const current =
                panel === 'learning'
                  ? settings.learningLang === language.code
                  : settings.targetLang === language.code;
              const native =
                'native' in language ? language.native : undefined;
              return (
                <Pressable
                  key={language.code}
                  onPress={() => {
                    if (panel === 'learning') {
                      patchSettings({ learningLang: language.code });
                      setPanel(null);
                    } else {
                      patchSettings({ targetLang: language.code });
                      setPanel(null);
                    }
                  }}
                  style={[
                    styles.optionRow,
                    { backgroundColor: current ? theme.colors.primarySoft : theme.colors.card },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>
                      {language.label}
                    </Text>
                    {native ? (
                      <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 2 }}>
                        {native}
                      </Text>
                    ) : null}
                  </View>
                  {current ? (
                    <Ionicons name="checkmark" size={20} color={theme.colors.primary} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text
            style={{
              color: theme.colors.textTertiary,
              fontSize: 11.5,
              lineHeight: 18,
              marginTop: 18,
              paddingHorizontal: 4,
            }}
          >
            学习语言用于选择 YouTube 字幕轨道；翻译语言是字幕译成的目标语言。当前界面仅提供简体中文。
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(120,116,104,0.16)',
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: '700' },
  rowValue: { fontSize: 13, marginRight: 8 },
  optionRow: {
    minHeight: 58,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
