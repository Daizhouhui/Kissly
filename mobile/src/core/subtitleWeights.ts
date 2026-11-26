import type { SubtitleWeight } from './types';

export type SubtitleFontWeight = '400' | '500' | '600' | '700' | '800';

/**
 * Single mapping for every subtitle surface and the preview. Keeping this free
 * of React Native imports lets the typography rules be unit tested directly.
 */
export function fontWeightFor(weight: SubtitleWeight): SubtitleFontWeight {
  if (weight === 'heavy') return '800';
  if (weight === 'bold') return '700';
  if (weight === 'medium') return '600';
  if (weight === 'normal') return '500';
  return '400';
}
