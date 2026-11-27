import { Platform, ViewStyle } from 'react-native';

/**
 * One radius language for the whole app.
 *
 * `pill` is a shape token, not a fifth visual tier: it is reserved for
 * avatars, round icon buttons, switch tracks and progress rails where a
 * circular geometry is part of the control.
 */
export const RADIUS = {
  modal: 28,
  card: 18,
  control: 13,
  badge: 8,
  pill: 999,
} as const;

export type RadiusToken = keyof typeof RADIUS;

/**
 * iOS gets the native continuous-curvature corner. Android and web keep the
 * same numeric radius with the platform's circular rounding, which preserves
 * performance, clipping and shadows.
 */
export const CONTINUOUS_CORNER: ViewStyle =
  Platform.OS === 'ios' ? { borderCurve: 'continuous' } : {};

export const RIPPLE = {
  surfaceLight: 'rgba(0,0,0,0.14)',
  surfaceDark: 'rgba(255,255,255,0.16)',
  onColor: 'rgba(255,255,255,0.18)',
  duration: 320,
} as const;

/**
 * Concentric inner radius: only use this when the inner surface is uniformly
 * inset and shares the same corner centre as the outer surface.
 */
export function innerRadius(outer: number, padding: number) {
  return Math.max(0, outer - padding);
}

export function radiusValue(value: number | RadiusToken) {
  return typeof value === 'number' ? value : RADIUS[value];
}
