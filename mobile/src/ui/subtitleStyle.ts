import { Platform } from 'react-native';

import type { Cue, SubtitleFont, SubtitleWeight } from '../core/types';

const SENTENCE_END = /[.!?。！？…]["'”’)]?\s*$/u;

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
 * "Smart" keeps the word-level cues produced by the YouTube parser. "Whole"
 * joins consecutive cues until a sentence ending, a real pause, or a safe
 * maximum length, so the learner sees one complete sentence per card.
 */
export function sentenceCues(cues: Cue[], mode: 'smart' | 'whole'): Cue[] {
  if (mode === 'smart' || !cues.length) return cues;
  const merged: Cue[] = [];
  let current: Cue | null = null;

  for (const cue of cues) {
    if (!current) {
      current = { ...cue };
      continue;
    }
    const gap = cue.start - current.end;
    if (gap > 1.35 || current.text.length > 260) {
      merged.push(current);
      current = { ...cue };
      continue;
    }
    current.text = `${current.text}${needsSpace(current.text, cue.text) ? ' ' : ''}${cue.text}`;
    if (current.translation && cue.translation) {
      current.translation = `${current.translation}${needsSpace(current.translation, cue.translation) ? ' ' : ''}${cue.translation}`;
    } else if (!current.translation && cue.translation) {
      current.translation = cue.translation;
    }
    current.end = cue.end;
    if (SENTENCE_END.test(cue.text)) {
      merged.push(current);
      current = null;
    }
  }
  if (current) merged.push(current);
  return merged;
}

function needsSpace(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (/[\u3000-\u9fff]$/u.test(left) || /^[\u3000-\u9fff]/u.test(right)) return false;
  return !/[\s([{"'“]$/u.test(left) && !/^[.,!?;:，。！？；：)\]}”’]/u.test(right);
}
