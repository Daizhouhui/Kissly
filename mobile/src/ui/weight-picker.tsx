import { StyleSheet, Text, View } from 'react-native';

import type { SubtitleWeight } from '../core/types';
import { RADIUS } from '../tokens';
import { AppPressable } from './app-pressable';
import { WEIGHT_OPTIONS } from './subtitleOptions';
import { useAppTheme } from './theme';

type WeightPickerProps = {
  value: SubtitleWeight;
  onChange: (value: SubtitleWeight) => void;
};

/** Shared by the player panels and the subtitle-style settings page. */
export function WeightPicker({ value, onChange }: WeightPickerProps) {
  const theme = useAppTheme();
  return (
    <View style={styles.row}>
      {WEIGHT_OPTIONS.map((option) => {
        const active = value === option.id;
        return (
          <AppPressable
            key={option.id}
            onPress={() => onChange(option.id)}
            style={[
              styles.item,
              { backgroundColor: active ? theme.colors.primary : theme.colors.surfaceAlt },
            ]}
          >
            <Text
              style={[
                styles.label,
                {
                  color: active ? '#FFFFFF' : theme.colors.textSecondary,
                  fontWeight: option.value,
                },
              ]}
            >
              {option.label} {option.value}
            </Text>
          </AppPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  item: {
    flex: 1,
    height: 40,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11.5,
    letterSpacing: 0.1,
  },
});
