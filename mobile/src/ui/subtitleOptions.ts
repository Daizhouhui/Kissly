import type { SubtitleFont, SubtitleWeight } from '../core/types';

export type SubtitleFontOption = {
  id: SubtitleFont;
  label: string;
  description: string;
};

export const ORIGINAL_FONT_OPTIONS: SubtitleFontOption[] = [
  { id: 'default', label: '默认', description: '跟随系统无衬线字体' },
  { id: 'rounded', label: '圆角体', description: '收笔更圆润，适合口语' },
  { id: 'serif', label: '衬线', description: '有笔锋，适合纪录片' },
  { id: 'geometric', label: '几何', description: '字形更利落，适合教学' },
];

export const TRANSLATION_FONT_OPTIONS: SubtitleFontOption[] = [
  { id: 'default', label: '默认', description: '跟随系统无衬线字体' },
  { id: 'serif', label: '宋体', description: '横细竖粗，适合长文阅读' },
  { id: 'kai', label: '楷体', description: '书写感更强，适合精读' },
];

export const WEIGHT_OPTIONS: Array<{
  id: SubtitleWeight;
  label: string;
  value: '400' | '500' | '600' | '700' | '800';
}> = [
  { id: 'regular', label: '细', value: '400' },
  { id: 'normal', label: '常规', value: '500' },
  { id: 'medium', label: '中等', value: '600' },
  { id: 'bold', label: '粗', value: '700' },
  { id: 'heavy', label: '更粗', value: '800' },
];
