import { Easing } from 'react-native-reanimated';

/**
 * One motion language for Kissly.
 *
 * Durations follow the frequency of the interaction, not the taste of the
 * screen: press feedback is the most frequent gesture in the app, so it stays
 * under 150ms. Anything slower reads as lag on a list row.
 */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
export const EASE_SHEET = Easing.bezier(0.32, 0.72, 0, 1);

export const DURATION = {
  pressIn: 110,
  pressOut: 140,
  tint: 120,
  smallState: 180,
  enter: 220,
  exit: 160,
} as const;

/**
 * Press scale per surface size. Bigger surfaces move less: scaling a full
 * width row by 3% would leave a visible gap at both screen edges, which is why
 * rows use a tint instead and are never scaled.
 */
export const PRESS_SCALE = {
  card: 0.98,
  control: 0.97,
  pill: 0.94,
  avatar: 0.96,
  tab: 0.92,
  none: 1,
} as const;

/** A wash that is visible in both themes without competing with the ripple. */
export const PRESS_TINT = {
  light: 'rgba(0,0,0,0.09)',
  dark: 'rgba(255,255,255,0.11)',
} as const;

export function pressTintColor(dark: boolean) {
  return dark ? PRESS_TINT.dark : PRESS_TINT.light;
}
