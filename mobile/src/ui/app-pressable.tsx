import * as Haptics from 'expo-haptics';
import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  Platform,
  Pressable,
  PressableProps,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { CONTINUOUS_CORNER, RADIUS, RIPPLE, RadiusToken, radiusValue } from '../tokens';
import { DURATION, EASE_OUT, SPRING, pressTintColor } from './motion';
import { useAppTheme } from './theme';

type Feedback = 'ripple' | 'opacity' | 'none';
type RippleTone = 'surface' | 'onColor';
type HapticStrength = 'tiny' | 'light' | 'medium' | 'heavy' | false;

const RIPPLE_PEAK_OPACITY = 0.18;
const RIPPLE_START_SCALE = 0.2;

export type AppPressableProps = Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  style?: PressableProps['style'];
  /** `ripple` for buttons/cards/list rows, `opacity` for text links and toggles. */
  feedback?: Feedback;
  /** Surface uses a translucent black/white wash; onColor is for colored buttons. */
  tone?: RippleTone;
  rippleColor?: string;
  radius?: number | RadiusToken;
  /** Legacy fixed diameter; normal use should let the ripple size itself. */
  rippleSize?: number;
  /** Scale applied while held. Keep at 1 for full-width rows. */
  pressScale?: number;
  /** Release with a short spring so the surface settles instead of stopping dead. */
  releaseSpring?: boolean;
  /** Faint wash under the finger. The right feedback for full-width rows. */
  pressTint?: boolean;
  haptic?: HapticStrength;
  pressableRef?: any;
  collapsable?: boolean;
};

export function triggerHaptic(strength: Exclude<HapticStrength, false>) {
  if (Platform.OS === 'web') return;
  if (strength === 'tiny') {
    if (Platform.OS === 'android') {
      const type =
        Number(Platform.Version) >= 34
          ? Haptics.AndroidHaptics.Segment_Frequent_Tick
          : Haptics.AndroidHaptics.Clock_Tick;
      Haptics.performAndroidHapticsAsync(type).catch(() => {
        Haptics.selectionAsync().catch(() => {});
      });
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    return;
  }
  const style =
    strength === 'heavy'
      ? Haptics.ImpactFeedbackStyle.Heavy
      : strength === 'medium'
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light;
  Haptics.impactAsync(style).catch(() => {});
}

function resolvedRadius(
  style: PressableProps['style'],
  radius: number | RadiusToken | undefined
) {
  if (typeof radius === 'number') return radius;
  if (radius) return radiusValue(radius);
  const base = typeof style === 'function' ? style({ pressed: false, hovered: false } as any) : style;
  const flattened = StyleSheet.flatten(base) as ViewStyle | undefined;
  return typeof flattened?.borderRadius === 'number'
    ? flattened.borderRadius
    : undefined;
}

/** Slots that decide where the pressable sits, so the scale wrapper takes them. */
const LAYOUT_SLOTS = [
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'alignSelf',
  'position',
  'left',
  'right',
  'top',
  'bottom',
  'zIndex',
] as const;

function layoutSlots(style: PressableProps['style']): ViewStyle {
  const base =
    typeof style === 'function' ? style({ pressed: false, hovered: false } as any) : style;
  const flattened = StyleSheet.flatten(base) as ViewStyle | undefined;
  if (!flattened) return {};
  const slots: Record<string, unknown> = {};
  for (const key of LAYOUT_SLOTS) {
    const value = (flattened as Record<string, unknown>)[key];
    if (value !== undefined) slots[key] = value;
  }
  return slots as ViewStyle;
}

function hasCorner(style: PressableProps['style']) {  const base = typeof style === 'function' ? style({ pressed: false, hovered: false } as any) : style;
  const flattened = StyleSheet.flatten(base) as ViewStyle | undefined;
  if (!flattened) return false;
  return (
    typeof flattened.borderRadius === 'number' ||
    typeof flattened.borderTopLeftRadius === 'number' ||
    typeof flattened.borderTopRightRadius === 'number' ||
    typeof flattened.borderBottomLeftRadius === 'number' ||
    typeof flattened.borderBottomRightRadius === 'number'
  );
}

/**
 * The single press surface for Kissly.
 *
 * Two feedback layers run on the UI thread: a light scale for cards and
 * buttons, and a faint wash for full-width rows that must not shrink at the
 * screen edges. The ripple stays as the third layer.
 *
 * Cards with shadows should keep the shadow on an outer wrapper and place
 * AppPressable inside it; otherwise iOS clips the shadow.
 */
export function AppPressable({
  children,
  style,
  feedback = 'ripple',
  tone = 'surface',
  rippleColor,
  radius,
  rippleSize,
  pressScale = 1,
  pressTint = false,
  releaseSpring = false,
  haptic = false,
  pressableRef,
  collapsable,
  disabled,
  onPressIn,
  onPressOut,
  onLayout,
  ...rest
}: AppPressableProps) {
  const theme = useAppTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const rippleProgress = useSharedValue(0);
  const tint = useSharedValue(0);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [ripple, setRipple] = useState<{ x: number; y: number; size: number } | null>(
    null
  );
  const rippleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (rippleTimer.current) {
        clearTimeout(rippleTimer.current);
        rippleTimer.current = null;
      }
      cancelAnimation(scale);
      cancelAnimation(rippleProgress);
      cancelAnimation(tint);
    };
  }, [scale, rippleProgress, tint]);

  const resolvedColor =
    rippleColor ??
    (tone === 'onColor'
      ? RIPPLE.onColor
      : theme.dark
        ? RIPPLE.surfaceDark
        : RIPPLE.surfaceLight);

  // Full-width rows never scale (it would gap the screen edges), so they get
  // the wash by default. Anything that scales already reads as a press.
  const tintEnabled = pressTint || (feedback === 'ripple' && pressScale === 1);

  const handlePressIn = (event: GestureResponderEvent) => {
    if (!disabled) {
      if (pressScale !== 1) {
        scale.set(
          withTiming(reduced ? 1 : pressScale, {
            duration: DURATION.pressIn,
            easing: EASE_OUT,
          })
        );
      }
      if (tintEnabled) {
        tint.set(withTiming(1, { duration: DURATION.tint, easing: EASE_OUT }));
      }
      if (feedback === 'ripple') {
        if (haptic) triggerHaptic(haptic);
        const width = layout.width || 0;
        const height = layout.height || 0;
        const x = event.nativeEvent.locationX ?? 0;
        const y = event.nativeEvent.locationY ?? 0;
        const maxDistance = Math.max(
          Math.hypot(x, y),
          Math.hypot(Math.max(0, width - x), y),
          Math.hypot(x, Math.max(0, height - y)),
          Math.hypot(Math.max(0, width - x), Math.max(0, height - y))
        );
        const size = rippleSize ?? Math.max(24, maxDistance * 2);
        if (rippleTimer.current) {
          clearTimeout(rippleTimer.current);
          rippleTimer.current = null;
        }
        if (reduced) {
          // Reduced motion keeps the state change but drops the sweep.
          setRipple(null);
        } else {
          setRipple({ x, y, size });
          rippleProgress.set(0);
          rippleProgress.set(
            withTiming(1, { duration: RIPPLE.duration, easing: EASE_OUT })
          );
          rippleTimer.current = setTimeout(() => {
            setRipple(null);
            rippleTimer.current = null;
          }, RIPPLE.duration);
        }
      }
    }
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    if (pressScale !== 1) {
      // A spring on release carries the finger's momentum: chips and pills
      // settle with a hint of overshoot instead of stopping dead.
      scale.set(
        releaseSpring && !reduced
          ? withSpring(1, {
              duration: SPRING.release.duration,
              dampingRatio: SPRING.release.dampingRatio,
            })
          : withTiming(1, { duration: DURATION.pressOut, easing: EASE_OUT })
      );
    }
    if (tintEnabled) {
      tint.set(withTiming(0, { duration: DURATION.tint, easing: EASE_OUT }));
    }
    onPressOut?.(event);
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height }
    );
    onLayout?.(event);
  };

  const baseRadius =
    resolvedRadius(style, radius) ??
    (feedback === 'ripple' ? RADIUS.control : undefined);

  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  const tintStyle = useAnimatedStyle(() => ({
    opacity: tint.get(),
  }));

  const rippleStyle = useAnimatedStyle(() => {
    const progress = rippleProgress.get();
    return {
      opacity: interpolate(progress, [0, 1], [RIPPLE_PEAK_OPACITY, 0]),
      transform: [
        { scale: interpolate(progress, [0, 1], [RIPPLE_START_SCALE, 1]) },
      ],
    };
  });

  const surface = (
    <Pressable
      {...rest}
      ref={pressableRef}
      collapsable={collapsable}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onLayout={handleLayout}
      style={(state) => {
        const base = typeof style === 'function' ? style(state) : style;
        const clip =
          feedback === 'ripple'
            ? [
                styles.clip,
                baseRadius ? { borderRadius: baseRadius } : null,
                (baseRadius !== undefined || hasCorner(style)) ? CONTINUOUS_CORNER : null,
              ]
            : null;
        const opacity =
          feedback === 'opacity' && state.pressed && !disabled
            ? { opacity: 0.7 }
            : null;
        return [base, clip, opacity];
      }}
    >
      {children}
      {tintEnabled ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: pressTintColor(theme.dark) },
            tintStyle,
          ]}
        />
      ) : null}
      {ripple ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ripple,
            {
              width: ripple.size,
              height: ripple.size,
              borderRadius: ripple.size / 2,
              left: ripple.x - ripple.size / 2,
              top: ripple.y - ripple.size / 2,
              backgroundColor: resolvedColor,
            },
            rippleStyle,
          ]}
        />
      ) : null}
    </Pressable>
  );

  if (pressScale === 1) return surface;

  // The scale wrapper becomes the flex item, so it has to carry the layout
  // slots the caller put on the pressable — otherwise `flex: 1` pills collapse
  // to their text width once they start scaling.
  return (
    <Animated.View style={[layoutSlots(style), scaleStyle]}>
      {surface}
    </Animated.View>
  );
}

export const PRESSABLE_RADIUS = RADIUS;

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  ripple: { position: 'absolute' },
});
