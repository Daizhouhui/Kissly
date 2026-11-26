import type { SubtitleMode, SubtitleWeight } from '../core/types';
import { fontWeightFor, type SubtitleFontWeight } from '../core/subtitleWeights';

export type SubtitleSurface = 'portrait' | 'listening' | 'landscape';
export type SubtitleLine = 'original' | 'translation';

export type SubtitleTextMetrics = {
  fontSize: number;
  lineHeight?: number;
  fontWeight: SubtitleFontWeight;
};

type SubtitleMetricsInput = {
  surface: SubtitleSurface;
  line: SubtitleLine;
  mode: SubtitleMode;
  baseSize: number;
  weight: SubtitleWeight;
  /** Preview-only scale; real surfaces always pass 1. */
  scale?: number;
};

/**
 * Single source of truth for subtitle type. Portrait and precision listening
 * use the same formula; landscape keeps the font's natural line height.
 */
export function subtitleTextMetrics({
  surface,
  line,
  mode,
  baseSize,
  weight,
  scale = 1,
}: SubtitleMetricsInput): SubtitleTextMetrics {
  const landscape = surface === 'landscape';
  const translationOnly = mode === 'translation';
  const size =
    line === 'original'
      ? baseSize
      : translationOnly
        ? baseSize
        : Math.max(landscape ? 13 : 12, baseSize - (landscape ? 5 : 3));
  const scaledSize = Math.round(size * scale * 100) / 100;
  const lineHeight = landscape
    ? undefined
    : Math.round(
        (line === 'original' ? Math.max(14, size) * 1.4 : size * 1.48) * scale
      );
  return {
    fontSize: scaledSize,
    lineHeight,
    fontWeight: fontWeightFor(weight),
  };
}
