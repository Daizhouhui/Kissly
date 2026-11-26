import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { RADIUS } from '../tokens';
import { DURATION, EASE_OUT, SPRING } from './motion';
import { useAppTheme } from './theme';

export type ToastKind = 'success' | 'info' | 'error';

export type ToastOptions = {
  duration?: number;
  /** Extra distance from the bottom safe area, e.g. to clear player controls. */
  bottomOffset?: number;
};

type ToastPayload = {
  id: number;
  message: string;
  kind: ToastKind;
  duration: number;
  bottomOffset: number;
};

type Presenter = (payload: ToastPayload) => void;

let presenter: Presenter | null = null;
let pending: ToastPayload | null = null;
let nextId = 1;

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 1000,
  info: 1500,
  error: 2500,
};

const DEFAULT_BOTTOM_OFFSET = 92;

function present(
  message: string,
  kind: ToastKind,
  options: ToastOptions = {}
) {
  const payload: ToastPayload = {
    id: nextId++,
    message,
    kind,
    duration: options.duration ?? DEFAULT_DURATION[kind],
    bottomOffset: options.bottomOffset ?? DEFAULT_BOTTOM_OFFSET,
  };
  if (presenter) presenter(payload);
  else pending = payload;
}

/**
 * Global, non-blocking feedback for success/info/error messages. Mount
 * `AppToastHost` once at the app root; call these helpers from any screen.
 */
export const toast = {
  success(message: string, options?: ToastOptions) {
    present(message, 'success', options);
  },
  info(message: string, options?: ToastOptions) {
    present(message, 'info', options);
  },
  error(message: string, options?: ToastOptions) {
    present(message, 'error', options);
  },
};

export function AppToastHost() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [payload, setPayload] = useState<ToastPayload | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progress = useSharedValue(0);

  useEffect(() => {
    const show = (next: ToastPayload) => {
      if (timer.current) clearTimeout(timer.current);
      if (exitTimer.current) clearTimeout(exitTimer.current);
      setPayload(next);
      // Enter: a short lift plus fade, so the pill reads as arriving rather
      // than blinking on. Spring matches every other transient surface.
      progress.set(0);
      progress.set(
        reduced
          ? withTiming(1, { duration: 120 })
          : withSpring(1, {
              duration: 300,
              dampingRatio: SPRING.release.dampingRatio,
            })
      );
      timer.current = setTimeout(() => {
        progress.set(withTiming(0, { duration: DURATION.exit, easing: EASE_OUT }));
        exitTimer.current = setTimeout(() => {
          setPayload(null);
          exitTimer.current = null;
        }, DURATION.exit);
        timer.current = null;
      }, next.duration);
    };
    presenter = show;
    // A startup effect may fire before this host mounts; don't drop it.
    if (pending) {
      const next = pending;
      pending = null;
      show(next);
    }
    return () => {
      presenter = null;
      if (timer.current) clearTimeout(timer.current);
      if (exitTimer.current) clearTimeout(exitTimer.current);
      cancelAnimation(progress);
    };
  }, [progress, reduced]);

  useEffect(() => {
    if (payload) AccessibilityInfo.announceForAccessibility(payload.message);
  }, [payload]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [
      { translateY: reduced ? 0 : interpolate(progress.get(), [0, 1], [12, 0]) },
    ],
  }));

  if (!payload) return null;

  const palette =
    payload.kind === 'success'
      ? {
          bg: theme.dark ? 'rgba(16,49,34,0.96)' : '#ECFDF3',
          border: theme.dark ? 'rgba(52,211,153,0.45)' : '#A7F3D0',
          text: theme.dark ? '#E7FFF2' : '#065F46',
          accent: theme.dark ? '#34D399' : '#059669',
          icon: 'checkmark-circle' as const,
        }
      : payload.kind === 'error'
        ? {
            bg: theme.dark ? 'rgba(60,20,24,0.97)' : '#FEF2F2',
            border: theme.dark ? 'rgba(248,113,113,0.5)' : '#FECACA',
            text: theme.dark ? '#FFECEC' : '#991B1B',
            accent: theme.dark ? '#F87171' : '#DC2626',
            icon: 'alert-circle' as const,
          }
        : {
            bg: theme.dark ? 'rgba(30,22,46,0.94)' : '#FFFFFF',
            border: theme.dark ? 'rgba(148,163,184,0.35)' : '#E2E8F0',
            text: theme.dark ? '#F5F2FF' : '#334155',
            accent: theme.dark ? '#C4B5FD' : '#7C5CFF',
            icon: 'information-circle' as const,
          };

  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: insets.bottom + payload.bottomOffset,
        paddingHorizontal: 24,
        alignItems: 'center',
        zIndex: 1000,
        elevation: 12,
      }}
    >
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            maxWidth: '100%',
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: RADIUS.pill,
            backgroundColor: palette.bg,
            borderWidth: 1,
            borderColor: palette.border,
          },
          theme.shadow.floating,
          cardStyle,
        ]}
      >
        <Ionicons name={palette.icon} size={17} color={palette.accent} />
        <Text
          numberOfLines={4}
          style={{
            flexShrink: 1,
            color: palette.text,
            fontSize: 12.5,
            lineHeight: 18,
          }}
        >
          {payload.message}
        </Text>
      </Animated.View>
    </View>
  );
}
