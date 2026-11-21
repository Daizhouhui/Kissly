import * as Haptics from 'expo-haptics';
import {
  Animated,
  Easing,
  GestureResponderEvent,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { ReactNode, useEffect, useRef, useState } from 'react';

type HapticStrength = 'light' | 'medium' | 'heavy' | false;

type RipplePressableProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  hitSlop?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  pressableRef?: any;
  collapsable?: boolean;
  rippleSize?: number;
  rippleColor?: string;
  haptic?: HapticStrength;
};

function triggerHaptic(strength: Exclude<HapticStrength, false>) {
  if (Platform.OS === 'web') return;
  const style =
    strength === 'heavy'
      ? Haptics.ImpactFeedbackStyle.Heavy
      : strength === 'medium'
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light;
  Haptics.impactAsync(style).catch(() => {});
}

/**
 * Pressable with a small liquid-like ripple. The native ripple differs by
 * platform and looks too flat on iOS, so the same animated overlay is used on
 * both platforms.
 */
export function RipplePressable({
  children,
  style,
  onPress,
  disabled,
  hitSlop,
  accessibilityLabel,
  accessibilityHint,
  pressableRef,
  collapsable,
  rippleSize = 54,
  rippleColor = 'rgba(255,255,255,0.22)',
  haptic = 'light',
}: RipplePressableProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const [ripple, setRipple] = useState<{ x: number; y: number; size: number } | null>(
    null
  );

  useEffect(() => {
    return () => {
      progress.stopAnimation();
    };
  }, [progress]);

  const handlePressIn = (event: GestureResponderEvent) => {
    if (disabled) return;
    if (haptic) triggerHaptic(haptic);
    setRipple({
      x: event.nativeEvent.locationX,
      y: event.nativeEvent.locationY,
      size: rippleSize,
    });
    progress.stopAnimation();
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setRipple(null);
    });
  };

  return (
    <Pressable
      ref={pressableRef}
      collapsable={collapsable}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPressIn={handlePressIn}
      onPress={onPress}
      style={[style, styles.pressable]}
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
              backgroundColor: rippleColor,
              opacity: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.32, 0],
              }),
              transform: [
                {
                  scale: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.35, 1.45],
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

const styles = StyleSheet.create({
  pressable: { overflow: 'hidden' },
  ripple: { position: 'absolute' },
});
