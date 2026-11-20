import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { useAppStore } from '../core/store';
import { getTheme, Theme } from '../theme';

/**
 * Resolves the user's appearance preference against the current system scheme.
 * Theme mode and accent are local-only: they deliberately stay out of WebDAV.
 */
export function useAppTheme(): Theme {
  const preference = useAppStore((state) => state.settings.theme);
  const accent = useAppStore((state) => state.settings.themeAccent);
  const systemScheme = useColorScheme();
  const mode =
    preference === 'system'
      ? systemScheme === 'light'
        ? 'light'
        : 'dark'
      : preference;
  return useMemo(() => getTheme(mode, accent), [mode, accent]);
}
