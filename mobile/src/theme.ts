import { Platform } from 'react-native';

import type { ThemeAccent } from './core/types';

export type ThemeMode = 'light' | 'dark';

export type Theme = {
  mode: ThemeMode;
  dark: boolean;
  accent: ThemeAccent;
  colors: {
    bg: string;
    bgElevated: string;
    surface: string;
    surfaceAlt: string;
    card: string;
    text: string;
    textSecondary: string;
    textTertiary: string;
    primary: string;
    primarySoft: string;
    primaryDeep: string;
    border: string;
    borderStrong: string;
    danger: string;
    success: string;
    warning: string;
    overlay: string;
    playerBg: string;
    playerSurface: string;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    pill: number;
  };
  space: (n: number) => number;
  shadow: {
    card: object;
    floating: object;
  };
};

const lightBase: Theme['colors'] = {
  bg: '#F6F7F9',
  bgElevated: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1F5',
  card: '#FFFFFF',
  text: '#151820',
  textSecondary: '#667085',
  textTertiary: '#98A2B3',
  primary: '#2F6FED',
  primarySoft: '#E8F0FE',
  primaryDeep: '#1D4ED8',
  border: '#E3E7ED',
  borderStrong: '#CDD3DC',
  danger: '#E5484D',
  success: '#2F9E68',
  warning: '#D9822B',
  overlay: 'rgba(15, 18, 25, 0.55)',
  playerBg: '#000000',
  playerSurface: '#11141A',
};

const darkBase: Theme['colors'] = {
  bg: '#0D1017',
  bgElevated: '#11151D',
  surface: '#161B24',
  surfaceAlt: '#1D242F',
  card: '#141922',
  text: '#F2F5FA',
  textSecondary: '#9AA4B2',
  textTertiary: '#667085',
  primary: '#6E9BFF',
  primarySoft: '#16233D',
  primaryDeep: '#3B82F6',
  border: '#242B36',
  borderStrong: '#333D4B',
  danger: '#FF6B6E',
  success: '#4ED18C',
  warning: '#F0A45B',
  overlay: 'rgba(0, 0, 0, 0.62)',
  playerBg: '#000000',
  playerSurface: '#11141A',
};

type AccentColors = Pick<Theme['colors'], 'primary' | 'primarySoft' | 'primaryDeep'>;

const accents: Record<ThemeMode, Record<ThemeAccent, AccentColors>> = {
  light: {
    blue: { primary: '#2F6FED', primarySoft: '#E8F0FE', primaryDeep: '#1D4ED8' },
    teal: { primary: '#0F9D8A', primarySoft: '#E3F7F4', primaryDeep: '#0B7C6D' },
    orange: { primary: '#E87817', primarySoft: '#FFF0E2', primaryDeep: '#C25A0C' },
    rose: { primary: '#E0447A', primarySoft: '#FDE8EF', primaryDeep: '#BE2F63' },
    green: { primary: '#2E9B63', primarySoft: '#E7F7EE', primaryDeep: '#237A4E' },
  },
  dark: {
    blue: { primary: '#6E9BFF', primarySoft: '#16233D', primaryDeep: '#3B82F6' },
    teal: { primary: '#2DD4BF', primarySoft: '#12302C', primaryDeep: '#14B8A6' },
    orange: { primary: '#FFA94D', primarySoft: '#3A2411', primaryDeep: '#F59E0B' },
    rose: { primary: '#FF7FA8', primarySoft: '#3A1825', primaryDeep: '#F43F5E' },
    green: { primary: '#52D68D', primarySoft: '#102B1E', primaryDeep: '#22C55E' },
  },
};

export const THEME_ACCENTS: Array<{
  id: ThemeAccent;
  label: string;
  light: string;
  dark: string;
}> = [
  { id: 'blue', label: '青蓝', light: '#2F6FED', dark: '#6E9BFF' },
  { id: 'teal', label: '青绿', light: '#0F9D8A', dark: '#2DD4BF' },
  { id: 'orange', label: '琥珀', light: '#E87817', dark: '#FFA94D' },
  { id: 'rose', label: '玫瑰', light: '#E0447A', dark: '#FF7FA8' },
  { id: 'green', label: '森绿', light: '#2E9B63', dark: '#52D68D' },
];

export function getTheme(
  mode: ThemeMode,
  accent: ThemeAccent = 'blue'
): Theme {
  const dark = mode === 'dark';
  const base = dark ? darkBase : lightBase;
  const accentColors = accents[mode][accent] ?? accents[mode].blue;
  return {
    mode,
    dark,
    accent,
    colors: { ...base, ...accentColors },
    radius: { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 },
    space: (n: number) => n * 4,
    shadow: {
      card: Platform.select({
        ios: {
          shadowColor: '#0B1220',
          shadowOpacity: dark ? 0.35 : 0.08,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        },
        android: { elevation: 2 },
        default: {},
      }) as object,
      floating: Platform.select({
        ios: {
          shadowColor: '#0B1220',
          shadowOpacity: 0.28,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 10 },
        },
        android: { elevation: 8 },
        default: {},
      }) as object,
    },
  };
}

export function getBrandGradient(theme: Theme): [string, string, string] {
  return [theme.colors.primary, theme.colors.primaryDeep, theme.colors.primary];
}

export const brandGradient = ['#2F6FED', '#1D4ED8', '#2F6FED'] as const;
