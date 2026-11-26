import { useEffect } from 'react';
import type { TextStyle, ViewStyle } from 'react-native';
import {
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { DURATION, EASE_IN_OUT, SPRING } from './motion';

type Progress = ReturnType<typeof useStateProgress>;

/**
 * A 0→1 value for a two-state control (switch, chip, check mark).
 *
 * The change is driven from an effect rather than from the render, so an
 * interrupted toggle keeps its current position instead of snapping: the new
 * timing starts from wherever the value already is.
 */
export function useStateProgress(
  active: boolean,
  duration: number = DURATION.smallState,
  mode: 'timing' | 'spring' = 'timing'
) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    const target = active ? 1 : 0;
    if (reduced) {
      // Reduced motion keeps the state change, drops the travel.
      progress.set(target);
      return;
    }
    progress.set(
      mode === 'spring'
        ? withSpring(target, {
            duration,
            dampingRatio: SPRING.knob.dampingRatio,
          })
        : withTiming(target, { duration, easing: EASE_IN_OUT })
    );
    return () => cancelAnimation(progress);
  }, [active, duration, mode, reduced, progress]);

  return progress;
}

export function useProgressOpacity(progress: Progress) {
  return useAnimatedStyle(() => ({ opacity: progress.get() }));
}

export function useProgressColor(
  progress: Progress,
  from: string,
  to: string,
  property: 'backgroundColor' | 'borderColor' | 'color' = 'backgroundColor'
) {
  return useAnimatedStyle(() => {
    const value = interpolateColor(progress.get(), [0, 1], [from, to]);
    return (
      property === 'color' ? { color: value } : { [property]: value }
    ) as TextStyle & ViewStyle;
  });
}
