import * as Haptics from 'expo-haptics';
import { ReactNode, Ref, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  GestureResponderEvent,
  LayoutChangeEvent,
  Platform,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { CONTINUOUS_CORNER, RADIUS, RIPPLE, RadiusToken, radiusValue } from '../tokens';
import { useAppTheme } from './theme';

type Feedback = 'ripple' | 'opacity' | 'none';
type RippleTone = 'surface' | 'onColor';
type HapticStrength = 'tiny' | 'light' | 'medium' | 'heavy' | false;

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
  haptic?: HapticStrength;
  pressableRef?: any;
  collapsable?: boolean;
};

function triggerHaptic(strength: Exclude<HapticStrength, false>) {
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

function hasCorner(style: PressableProps['style']) {
  const base = typeof style === 'function' ? style({ pressed: false, hovered: false } as any) : style;
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
 * Ripple geometry is clipped by the same rounded surface that receives the
 * press. Cards with shadows should keep the shadow on an outer wrapper and
 * place AppPressable inside it; otherwise iOS clips the shadow.
 */
export function AppPressable({
  children,
  style,
  feedback = 'ripple',
  tone = 'surface',
  rippleColor,
  radius,
  rippleSize,
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
  const progress = useRef(new Animated.Value(0)).current;
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [ripple, setRipple] = useState<{ x: number; y: number; size: number } | null>(
    null
  );

  useEffect(() => {
    return () => {
      progress.stopAnimation();
    };
  }, [progress]);

  const resolvedColor =
    rippleColor ??
    (tone === 'onColor'
      ? RIPPLE.onColor
      : theme.dark
        ? RIPPLE.surfaceDark
        : RIPPLE.surfaceLight);

  const handlePressIn = (event: GestureResponderEvent) => {
    if (feedback === 'ripple' && !disabled) {
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
      setRipple({ x, y, size });
      progress.stopAnimation();
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: RIPPLE.duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }).start(({ finished }) => {
        if (finished) setRipple(null);
      });
    }
    onPressIn?.(event);
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

  return (
    <Pressable
      {...rest}
      ref={pressableRef}
      collapsable={collapsable}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={onPressOut}
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
              opacity: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.18, 0],
              }),
              transform: [
                {
                  scale: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.2, 1],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
    </Pressable>
  );
}

export const PRESSABLE_RADIUS = RADIUS;

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  ripple: { position: 'absolute' },
});
