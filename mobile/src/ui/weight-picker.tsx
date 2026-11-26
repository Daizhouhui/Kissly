import { StyleSheet, Text, View } from 'react-native';
import ReAnimated from 'react-native-reanimated';

import type { SubtitleWeight } from '../core/types';
import { CONTROL_HEIGHT, RADIUS } from '../tokens';
import { AppPressable } from './app-pressable';
import { PRESS_SCALE } from './motion';
import { useProgressColor, useStateProgress } from './state-anim';
import { WEIGHT_OPTIONS } from './subtitleOptions';
import { useAppTheme } from './theme';

type WeightPickerProps = {
  value: SubtitleWeight;
  onChange: (value: SubtitleWeight) => void;
  /**
   * Colour crossfade when the selection moves. The player passes `false`: its
   * portrait subtitle panels stay exactly as they were.
   */
  animate?: boolean;
};

type WeightOption = (typeof WEIGHT_OPTIONS)[number];

/** Shared by the player panels and the subtitle-style settings page. */
export function WeightPicker({ value, onChange, animate = true }: WeightPickerProps) {
  return (
    <View style={styles.row}>
      {WEIGHT_OPTIONS.map((option) =>
        animate ? (
          <AnimatedWeightItem
            key={option.id}
            option={option}
            active={value === option.id}
            onPress={() => onChange(option.id)}
          />
        ) : (
          <StaticWeightItem
            key={option.id}
            option={option}
            active={value === option.id}
            onPress={() => onChange(option.id)}
          />
        )
      )}
    </View>
  );
}

function StaticWeightItem({
  option,
  active,
  onPress,
}: {
  option: WeightOption;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <AppPressable
      onPress={onPress}
      feedback="ripple"
      radius={RADIUS.pill}
      pressScale={PRESS_SCALE.pill}
      releaseSpring
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
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
}

function AnimatedWeightItem({
  option,
  active,
  onPress,
}: {
  option: WeightOption;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  const progress = useStateProgress(active);
  const surfaceStyle = useProgressColor(
    progress,
    theme.colors.surfaceAlt,
    theme.colors.primary
  );
  const labelStyle = useProgressColor(
    progress,
    theme.colors.textSecondary,
    '#FFFFFF',
    'color'
  );
  return (
    <AppPressable
      onPress={onPress}
      feedback="ripple"
      radius={RADIUS.pill}
      pressScale={PRESS_SCALE.pill}
      releaseSpring
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.item, { backgroundColor: 'transparent' }]}
    >
      <ReAnimated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: RADIUS.pill },
          surfaceStyle,
        ]}
      />
      <ReAnimated.Text style={[styles.label, { fontWeight: option.value }, labelStyle]}>
        {option.label} {option.value}
      </ReAnimated.Text>
    </AppPressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  item: {
    flex: 1,
    height: CONTROL_HEIGHT.sm,
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
