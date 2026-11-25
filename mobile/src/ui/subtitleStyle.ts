import { Platform } from 'react-native';

import type { Cue, SubtitleFont, SubtitleWeight } from '../core/types';
import { segmentSubtitleCues } from './sentenceSegmentation';

export function fontFamilyFor(font: SubtitleFont, language: 'source' | 'translation'): string | undefined {
  if (font === 'default') return undefined;
  const english =
    Platform.OS === 'ios'
      ? font === 'serif'
        ? 'Georgia'
        : font === 'geometric'
          ? 'Avenir Next'
          : font === 'kai'
            ? 'Snell Roundhand'
            : 'Avenir Next'
      : font === 'serif'
        ? 'serif'
        : font === 'geometric'
          ? 'sans-serif-light'
          : font === 'kai'
            ? 'cursive'
            : 'sans-serif';
  const chinese =
    Platform.OS === 'ios'
      ? font === 'serif'
        ? 'Songti SC'
        : font === 'kai'
          ? 'Kaiti SC'
          : 'PingFang SC'
      : font === 'serif'
        ? 'serif'
        : font === 'kai'
          ? 'cursive'
          : 'sans-serif';
  return language === 'translation' ? chinese : english;
}

export function fontWeightFor(weight: SubtitleWeight): '400' | '600' | '800' {
  if (weight === 'bold') return '800';
  if (weight === 'medium') return '600';
  return '400';
}

/**
 * "Smart" keeps complete sentences but splits long ones at real clause
 * boundaries. "Whole" keeps one complete sentence per card. Both modes repair
 * caption cues that start/end mid-sentence before grouping.
 */
export function sentenceCues(cues: Cue[], mode: 'smart' | 'whole'): Cue[] {
  return segmentSubtitleCues(cues, mode);
}
