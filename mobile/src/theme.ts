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
  bg: '#F3F1EA',
  bgElevated: '#FBF9F4',
  surface: '#FBF9F4',
  surfaceAlt: '#ECE9DF',
  card: '#FBF9F4',
  text: '#211F1A',
  textSecondary: '#6E6A60',
  textTertiary: '#A19C8F',
  primary: '#446B5B',
  primarySoft: '#E2ECE5',
  primaryDeep: '#315444',
  border: '#E4E0D4',
  borderStrong: '#D4CFC0',
  danger: '#D9534F',
  success: '#3E8B64',
  warning: '#C68435',
  overlay: 'rgba(20, 23, 19, 0.55)',
  playerBg: '#F1EDE4',
  playerSurface: '#F7F3EA',
};

const darkBase: Theme['colors'] = {
  bg: '#111410',
  bgElevated: '#181C16',
  surface: '#1C201A',
  surfaceAlt: '#242920',
  card: '#191D17',
  text: '#F1EFE7',
  textSecondary: '#AEAA9E',
  textTertiary: '#78766C',
  primary: '#8FB89F',
  primarySoft: '#223128',
  primaryDeep: '#6D987D',
  border: '#2D3228',
  borderStrong: '#3C4234',
  danger: '#FF7B72',
  success: '#6FD3A0',
  warning: '#E8AD66',
  overlay: 'rgba(0, 0, 0, 0.62)',
  playerBg: '#080A07',
  playerSurface: '#12150F',
};

type AccentColors = Pick<Theme['colors'], 'primary' | 'primarySoft' | 'primaryDeep'>;

const accents: Record<ThemeMode, Record<ThemeAccent, AccentColors>> = {
  light: {
    sage: { primary: '#446B5B', primarySoft: '#E2ECE5', primaryDeep: '#315444' },
    violet: { primary: '#6B4DF6', primarySoft: '#EEE9FF', primaryDeep: '#5136CF' },
    blue: { primary: '#2F6FED', primarySoft: '#E8F0FE', primaryDeep: '#1D4ED8' },
    teal: { primary: '#0F9D8A', primarySoft: '#E3F7F4', primaryDeep: '#0B7C6D' },
    orange: { primary: '#E87817', primarySoft: '#FFF0E2', primaryDeep: '#C25A0C' },
    rose: { primary: '#E0447A', primarySoft: '#FDE8EF', primaryDeep: '#BE2F63' },
    green: { primary: '#2E9B63', primarySoft: '#E7F7EE', primaryDeep: '#237A4E' },
  },
  dark: {
    sage: { primary: '#8FB89F', primarySoft: '#223128', primaryDeep: '#6D987D' },
    violet: { primary: '#A78BFA', primarySoft: '#241B3D', primaryDeep: '#8B5CF6' },
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
  { id: 'sage', label: '鼠尾草', light: '#446B5B', dark: '#8FB89F' },
  { id: 'violet', label: '紫罗兰', light: '#6B4DF6', dark: '#A78BFA' },
  { id: 'blue', label: '青蓝', light: '#2F6FED', dark: '#6E9BFF' },
  { id: 'teal', label: '青绿', light: '#0F9D8A', dark: '#2DD4BF' },
  { id: 'orange', label: '琥珀', light: '#E87817', dark: '#FFA94D' },
  { id: 'rose', label: '玫瑰', light: '#E0447A', dark: '#FF7FA8' },
  { id: 'green', label: '森绿', light: '#2E9B63', dark: '#52D68D' },
];

export function getTheme(
  mode: ThemeMode,
  accent: ThemeAccent = 'sage'
): Theme {
  const dark = mode === 'dark';
  const base = dark ? darkBase : lightBase;
  const accentColors = accents[mode][accent] ?? accents[mode].sage;
  return {
    mode,
    dark,
    accent,
    colors: { ...base, ...accentColors },
    radius: { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 },
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

export const brandGradient = ['#446B5B', '#315444', '#446B5B'] as const;
