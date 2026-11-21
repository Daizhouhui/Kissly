/**
 * Backwards-compatible name for the app-wide press surface. New code should
 * import `AppPressable` directly.
 */
export {
  AppPressable as RipplePressable,
  PRESSABLE_RADIUS,
} from './app-pressable';
export type { AppPressableProps } from './app-pressable';

export type RipplePressableProps = import('./app-pressable').AppPressableProps;
