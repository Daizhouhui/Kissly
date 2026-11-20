import { useAppStore } from '../core/store';
import { getTheme, Theme } from '../theme';

/**
 * Kissly is a dark-first player. Keeping the whole app on one palette avoids
 * white-on-white text when the device switches appearance mid-session.
 */
export function useAppTheme(): Theme {
  const preference = useAppStore((state) => state.settings.theme);
  // The appearance switch is kept for future themes; the shipping UI is dark.
  void preference;
  return getTheme('dark');
}
