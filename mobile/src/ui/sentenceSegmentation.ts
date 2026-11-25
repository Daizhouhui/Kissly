import type { Cue } from '../core/types';

type Segment = {
  start: number;
  end: number;
  text: string;
  translation?: string;
};

const SENTENCE_END = /[.!?。！？…]["'”’)\]]*\s*$/u;
const TITLE_ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt']);
const NON_TERMINAL_ABBREVIATIONS = new Set([
  'etc',
  'eg',
  'ie',
  'vs',
  'am',
  'pm',
  'us',
  'uk',
  'no',
]);

const SMART_TARGET_CHARS = 92;
const SMART_MIN_CHARS = 20;
const SMART_MAX_CHARS = 112;
const WHOLE_MAX_CHARS = 320;
const WHOLE_MAX_DURATION = 24;
const EMERGENCY_MAX_CHARS = 420;
const EMERGENCY_MAX_DURATION = 36;

function normalizeText(value: string): string {
  return String(value ?? '')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.!?;:，。！？；：])/gu, '$1')
    .trim();
}

function needsSpace(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (/[\u3000-\u9fff]$/u.test(left) || /^[\u3000-\u9fff]/u.test(right)) {
    return false;
  }
  return !/[\s([{"'“]$/u.test(left) && !/^[.,!?;:，。！？；：)\]}”’]/u.test(right);
}

function joinText(left: string, right: string): string {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a) return b;
  if (!b) return a;
  return `${a}${needsSpace(a, b) ? ' ' : ''}${b}`;
}

function isSentenceEnd(text: string, nextText?: string): boolean {
  const value = normalizeText(text);
  if (!SENTENCE_END.test(value)) return false;
  if (!value.endsWith('.')) return true;

  const periodIndex = value.length - 1;
  const rawWord = value.slice(0, periodIndex).match(/[A-Za-z.]+$/u)?.[0] ?? '';
  const word = rawWord.replace(/\./gu, '').toLowerCase();
  const next = normalizeText(nextText ?? '');
  const nextStartsLower = /^[a-z]/u.test(next);

  // Titles and initials never end a sentence on their own, even before a name:
  // "Hi Mr." + "Hinkel." must become "Hi Mr. Hinkel.".
  if (TITLE_ABBREVIATIONS.has(word)) return false;
  if (!rawWord.includes('.') && /^[a-z]$/u.test(word)) return false;

  // "U.S. government" continues; "U.S. It is..." ends a sentence.
  if (rawWord.includes('.')) return !nextStartsLower;

  // "etc." / "No." / "3 pm." can end a sentence when the next cue starts a
  // new one, but stay attached when the next word is lowercase ("No. 5").
  if (NON_TERMINAL_ABBREVIATIONS.has(word)) return !nextStartsLower;

  return true;
}

function isAbbreviationPeriod(text: string, periodIndex: number): boolean {
  const previous = text[periodIndex - 1] ?? '';
  const next = text[periodIndex + 1] ?? '';
  const nextNonSpace = text.slice(periodIndex + 1).match(/\S/u)?.[0] ?? '';
  if (/\d/u.test(previous) && /\d/u.test(next)) return true;
  if (previous && next && /[A-Za-z]/u.test(previous) && /[A-Za-z]/u.test(next)) {
    return true;
  }
  const rawWord = text.slice(0, periodIndex).match(/[A-Za-z.]+$/u)?.[0] ?? '';
  if (rawWord.includes('.') && (!nextNonSpace || /[A-Z]/u.test(nextNonSpace))) {
    // "U.S. It is..." ends a sentence; "U.S. government" is an abbreviation.
    return false;
  }
  const word = rawWord.replace(/\./gu, '').toLowerCase();
  if (!word) return false;
  if (TITLE_ABBREVIATIONS.has(word) || NON_TERMINAL_ABBREVIATIONS.has(word)) {
    return true;
  }
  // A single-letter initial before a name ("J. Smith") is not a sentence end.
  if (/^[a-z]$/u.test(word)) {
    if (!nextNonSpace || /[A-Z]/u.test(nextNonSpace)) return true;
  }
  return false;
}

/**
 * Split a caption chunk at sentence punctuation. YouTube's manual tracks often
 * put two display lines into one cue, and those lines may contain a sentence
 * boundary plus the beginning of the next sentence. Splitting only at cue
 * boundaries cannot recover that structure.
 */
export function splitTextIntoSentences(value: string): string[] {
  const text = normalizeText(value);
  if (!text) return [];
  const pieces: string[] = [];
  let start = 0;
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    const isSentencePunctuation = /[.!?。！？…]/u.test(char);
    if (!isSentencePunctuation) {
      index += 1;
      continue;
    }

    let end = index + 1;
    if (char === '.' && text[index + 1] === '.') {
      while (text[end] === '.') end += 1;
    }
    while (/["'”’)\]]/u.test(text[end] ?? '')) end += 1;

    const next = text[end] ?? '';
    const hasBoundarySpace = !next || /\s/u.test(next);
    const startsNewSentence = /[A-Z\u4e00-\u9fff]/u.test(next);
    const isPeriod = char === '.';
    if (
      isPeriod &&
      (isAbbreviationPeriod(text, index) ||
        (!hasBoundarySpace && !/["'”’)\]]/u.test(next) && !startsNewSentence))
    ) {
      index = end;
      continue;
    }

    const piece = text.slice(start, end).trim();
    if (piece) pieces.push(piece);
    start = end;
    index = end;
  }

  const tail = text.slice(start).trim();
  if (tail) pieces.push(tail);
  return pieces.length ? pieces : [text];
}

function translationBoundaryPenalty(value: string, position: number): number | null {
  const left = value[position - 1] ?? '';
  const right = value[position] ?? '';
  if (!left || !right) return null;
  if (/[，,；;：:、。！？.!?]/u.test(left)) {
    if (
      (left === ',' || left === '，') &&
      /\d/u.test(value[position - 2] ?? '') &&
      /\d/u.test(right)
    ) {
      return null;
    }
    return 0;
  }
  if (/\s/u.test(left) || /\s/u.test(right)) return 2;
  // Never cut in the middle of an English word or a number.
  if (/[A-Za-z0-9]/u.test(left) && /[A-Za-z0-9]/u.test(right)) return null;
  if (/[\u3000-\u9fff]/u.test(left) || /[\u3000-\u9fff]/u.test(right)) {
    return 9;
  }
  return 12;
}

/**
 * One translated chunk can cover several source sentences when the provider
 * joins clauses with a Chinese comma. Assigning the whole chunk to the
 * longest source fragment leaves the other cards with no translation. Cut the
 * chunk at a punctuation/word boundary near each source fragment's weighted
 * position instead.
 */
function splitSingleTranslation(
  translation: string,
  sourcePieces: string[]
): string[] | null {
  const value = normalizeText(translation);
  const count = sourcePieces.length;
  if (!value || count <= 1) return [value];
  if (value.length < count) return null;

  const weights = sourcePieces.map((piece) => Math.max(1, piece.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const minimum = Math.max(1, Math.floor(value.length / (count * 3)));
  const cuts: number[] = [];
  let consumed = 0;

  for (let index = 0; index < count - 1; index += 1) {
    consumed += weights[index];
    const ideal = Math.round((value.length * consumed) / totalWeight);
    const lower = Math.max(
      (cuts[cuts.length - 1] ?? 0) + minimum,
      1
    );
    const upper = Math.min(
      value.length - minimum * (count - index - 1),
      value.length - 1
    );
    if (lower > upper) return null;

    const radius = Math.max(6, Math.round((value.length / count) * 0.7));
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestPenalty = Number.POSITIVE_INFINITY;
    const consider = (from: number, to: number) => {
      for (let position = from; position <= to; position += 1) {
        const penalty = translationBoundaryPenalty(value, position);
        if (penalty === null) continue;
        const score = Math.abs(position - ideal) + penalty;
        if (
          score < bestScore ||
          (score === bestScore && penalty < bestPenalty)
        ) {
          best = position;
          bestScore = score;
          bestPenalty = penalty;
        }
      }
    };

    consider(
      Math.max(lower, ideal - radius),
      Math.min(upper, ideal + radius)
    );
    if (best < 0) consider(lower, upper);
    if (best < 0) return null;
    if (best <= (cuts[cuts.length - 1] ?? 0)) return null;
    cuts.push(best);
  }

  const pieces: string[] = [];
  let start = 0;
  for (const cut of cuts) {
    const piece = value.slice(start, cut).trim();
    if (!piece) return null;
    pieces.push(piece);
    start = cut;
  }
  const tail = value.slice(start).trim();
  if (!tail) return null;
  pieces.push(tail);
  return pieces.length === count ? pieces : null;
}

function stripRepeatedTranslationLead(
  translation: string | undefined,
  previousTranslation: string | undefined
): string | undefined {
  if (!translation || !previousTranslation) return translation;
  const match = translation.match(/^([^：:，,。！？!?\s]{1,8})[：:]/u);
  if (!match) return translation;
  const prefix = match[1];
  const previous = normalizeText(previousTranslation).replace(
    /[。！？!?，,；;：:]+$/u,
    ''
  );
  if (!previous.endsWith(prefix)) return translation;
  const rest = translation.slice(match[0].length).trim();
  return rest || translation;
}

function alignTranslationByPosition(translation: string, sourcePieces: string[]): string[] {
  const translated = splitTextIntoSentences(translation);
  if (!translated.length) return sourcePieces.map(() => '');
  if (translated.length === 1) {
    const split = splitSingleTranslation(translated[0], sourcePieces);
    if (split) return split;
  }

  const output = sourcePieces.map(() => '');
  const sourceWeights = sourcePieces.map((piece) => Math.max(1, piece.length));
  const sourceTotal = sourceWeights.reduce((sum, weight) => sum + weight, 0);
  const translatedWeights = translated.map((piece) => Math.max(1, piece.length));
  const translatedTotal = translatedWeights.reduce((sum, weight) => sum + weight, 0);
  const sourceCenters: number[] = [];
  const translatedCenters: number[] = [];
  let cursor = 0;

  for (const weight of sourceWeights) {
    sourceCenters.push((cursor + weight / 2) / sourceTotal);
    cursor += weight;
  }
  cursor = 0;
  for (const weight of translatedWeights) {
    translatedCenters.push((cursor + weight / 2) / translatedTotal);
    cursor += weight;
  }

  const groups = sourcePieces.map(() => [] as string[]);
  translated.forEach((piece, index) => {
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    sourceCenters.forEach((center, sourceIndex) => {
      const distance = Math.abs(center - translatedCenters[index]);
      if (distance < nearestDistance) {
        nearest = sourceIndex;
        nearestDistance = distance;
      }
    });
    groups[nearest].push(piece);
  });

  return groups.map((group) => joinText('', group.join(' ')));
}

function splitTranslationByChunks(
  translation: string | undefined,
  sourceChunks: string[]
): string[] {
  if (!translation) return sourceChunks.map(() => '');
  if (sourceChunks.length <= 1) return [translation];
  const direct = splitTextIntoSentences(translation);
  if (direct.length === sourceChunks.length) return direct;

  const value = normalizeText(translation);
  const weights = sourceChunks.map((chunk) => Math.max(1, chunk.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const cuts: number[] = [];
  let cumulative = 0;

  for (let index = 0; index < weights.length - 1; index += 1) {
    cumulative += weights[index];
    const expected = Math.round((value.length * cumulative) / totalWeight);
    let cut = expected;
    const punctuation = /[,.!?;:，。！？；：、]/u;
    const safeCut = (position: number): boolean => {
      const char = value[position] ?? '';
      const previous = value[position - 1] ?? '';
      if (
        (char === ',' || char === '，') &&
        /\d/u.test(previous) &&
        /\d/u.test(value[position + 1] ?? '')
      ) {
        return false;
      }
      if (punctuation.test(char)) {
        cut = position + 1;
        return true;
      }
      if (punctuation.test(previous)) {
        cut = position;
        return true;
      }
      if (/\s/u.test(char) || /\s/u.test(previous)) {
        cut = position;
        return true;
      }
      return false;
    };
    for (let distance = 0; distance <= 18; distance += 1) {
      const left = expected - distance;
      const right = expected + distance;
      if (left > 0 && safeCut(left)) break;
      if (right < value.length && safeCut(right)) break;
    }
    cuts.push(cut);
  }

  const pieces: string[] = [];
  let start = 0;
  for (const cut of cuts) {
    if (cut <= start || cut >= value.length) continue;
    const piece = value.slice(start, cut).trim();
    if (piece) pieces.push(piece);
    start = cut;
  }
  const tail = value.slice(start).trim();
  if (tail) pieces.push(tail);

  if (pieces.length === sourceChunks.length) return pieces;
  return alignTranslationByPosition(translation, sourceChunks);
}

function translationPieces(translation: string | undefined, sourcePieces: string[]): string[] {
  if (!translation) return sourcePieces.map(() => '');
  if (sourcePieces.length <= 1) return [translation];
  const direct = splitTextIntoSentences(translation);
  if (direct.length === sourcePieces.length) return direct;
  return alignTranslationByPosition(translation, sourcePieces);
}

function splitCue(cue: Cue): Segment[] {
  const pieces = splitTextIntoSentences(cue.text);
  if (!pieces.length) return [];
  const translations = translationPieces(cue.translation, pieces);
  const weights = pieces.map((piece) => Math.max(1, piece.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const duration = Math.max(0.01, cue.end - cue.start);
  const segments: Segment[] = [];
  let consumed = 0;
  let start = cue.start;

  pieces.forEach((text, index) => {
    consumed += weights[index];
    const end =
      index === pieces.length - 1
        ? cue.end
        : cue.start + (duration * consumed) / totalWeight;
    segments.push({
      start: Math.max(cue.start, start),
      end: Math.max(start + 0.01, end),
      text,
      translation: translations[index]?.trim() || undefined,
    });
    start = end;
  });

  return segments;
}

function mergeSegments(left: Segment, right: Segment): Segment {
  return {
    start: left.start,
    end: right.end,
    text: joinText(left.text, right.text),
    translation:
      left.translation || right.translation
        ? joinText(left.translation ?? '', right.translation ?? '')
        : undefined,
  };
}

function shouldEmergencyFlush(segment: Segment): boolean {
  const duration = segment.end - segment.start;
  return (
    segment.text.length >= EMERGENCY_MAX_CHARS ||
    duration >= EMERGENCY_MAX_DURATION
  );
}

function groupSentences(segments: Segment[]): Segment[] {
  const units: Segment[] = [];
  let current: Segment | null = null;

  for (const segment of segments) {
    if (!current) {
      current = { ...segment };
    } else if (isSentenceEnd(current.text, segment.text)) {
      units.push(current);
      current = { ...segment };
    } else {
      current = mergeSegments(current, segment);
    }

    if (current && shouldEmergencyFlush(current)) {
      units.push(current);
      current = null;
    }
  }
  if (current) units.push(current);
  return units;
}

type BoundaryCandidate = {
  index: number;
  penalty: number;
};

// A cut is scored by distance to the balanced position first. These small
// language penalties only break ties so a balanced cut does not leave a bare
// "and" / "for" / "so much" dangling at the edge of a card.
const DANGLING_END_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'so', 'because', 'although', 'though',
  'while', 'if', 'when', 'that', 'which', 'who', 'whom', 'whose', 'to', 'of',
  'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as', 'than', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must',
  'not', 'very', 'really', 'more', 'most', 'much', 'many', 'just', 'only',
  'also', 'then', 'there', 'here', 'his', 'her', 'my', 'your', 'our',
  'their', 'its', 'this', 'these', 'those',
]);
const CONNECTOR_START_WORDS = new Set([
  'and', 'or', 'but', 'so', 'because', 'although', 'though', 'while', 'if',
  'when', 'for', 'to', 'of', 'in', 'with', 'as', 'than',
]);

function contextualBoundaryPenalty(value: string, index: number): number {
  const left = value.slice(0, index).trimEnd();
  const right = value.slice(index).trimStart();
  const lastWord = (left.match(/([A-Za-z']+)$/u)?.[1] ?? '').toLowerCase();
  const firstWord = (right.match(/^([A-Za-z']+)/u)?.[1] ?? '').toLowerCase();
  if (DANGLING_END_WORDS.has(lastWord)) return 6;
  if (CONNECTOR_START_WORDS.has(firstWord)) return 1;
  return 0;
}

/**
 * Candidate cut points with a small preference for real punctuation/clause
 * boundaries over ordinary word gaps. The final cut is chosen by distance to
 * the balanced ideal position, so the same sentence is cut differently when
 * its total length changes.
 */
function smartBoundaryCandidates(text: string): BoundaryCandidate[] {
  const value = normalizeText(text);
  const candidates: BoundaryCandidate[] = [];
  const seen = new Map<number, number>();

  const add = (index: number, penalty: number) => {
    if (index <= SMART_MIN_CHARS || index >= value.length - 1) return;
    const score = penalty + contextualBoundaryPenalty(value, index);
    const current = seen.get(index);
    if (current === undefined || score < current) {
      seen.set(index, score);
    }
  };

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (/[，,；;：:、—–]/u.test(char)) {
      if (
        (char === ',' || char === '，') &&
        /\d/u.test(value[index - 1] ?? '') &&
        /\d/u.test(value[index + 1] ?? '')
      ) {
        continue;
      }
      let end = index + 1;
      while (/\s/u.test(value[end] ?? '')) end += 1;
      add(end, 0);
      continue;
    }

    // A word gap is a valid fallback cut when the sentence has no punctuation
    // near the balanced position. It still has to be scored against the ideal
    // position; it is not a fixed "cut after this word" rule.
    if (/\s/u.test(char)) {
      add(index, 3);
      continue;
    }

    // CJK text has no spaces, so a character boundary is the only fallback.
    if (/[\u3000-\u9fff]/u.test(char)) {
      add(index + 1, 4);
    }
  }

  for (const [index, penalty] of seen) candidates.push({ index, penalty });
  return candidates.sort((a, b) => a.index - b.index);
}

function smartBoundaries(text: string): number[] {
  return smartBoundaryCandidates(text).map((candidate) => candidate.index);
}

function pickBalancedBoundary(
  candidates: BoundaryCandidate[],
  ideal: number,
  lower: number,
  upper: number
): number {
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.index < lower || candidate.index > upper) continue;
    const score = Math.abs(candidate.index - ideal) + candidate.penalty;
    if (score < bestScore) {
      best = candidate.index;
      bestScore = score;
    }
  }
  if (best >= 0) return best;

  // Nothing near the ideal point: choose the least bad candidate that still
  // leaves enough text on both sides, rather than falling back to a hard cut.
  for (const candidate of candidates) {
    if (candidate.index < lower || candidate.index > upper) continue;
    const score = Math.abs(candidate.index - ideal) + candidate.penalty;
    if (score < bestScore) {
      best = candidate.index;
      bestScore = score;
    }
  }
  return best;
}

function buildBalancedSmartChunks(
  unit: Segment,
  text: string,
  count: number,
  candidates: BoundaryCandidate[]
): Segment[] | null {
  const cuts: number[] = [];
  let previous = 0;

  for (let index = 1; index < count; index += 1) {
    const ideal = (text.length * index) / count;
    const lower = previous + SMART_MIN_CHARS;
    const upper = text.length - SMART_MIN_CHARS * (count - index);
    const window = Math.max(18, Math.round(text.length / count / 2));
    let cut = pickBalancedBoundary(
      candidates,
      ideal,
      Math.max(lower, Math.round(ideal) - window),
      Math.min(upper, Math.round(ideal) + window)
    );
    if (cut < 0) {
      cut = pickBalancedBoundary(
        candidates,
        ideal,
        lower,
        upper
      );
    }
    if (cut <= previous || cut >= text.length) return null;
    cuts.push(cut);
    previous = cut;
  }

  if (cuts.length !== count - 1) return null;
  const sourceChunks: string[] = [];
  let start = 0;
  for (const cut of cuts) {
    const chunk = text.slice(start, cut).trim();
    if (!chunk) return null;
    sourceChunks.push(chunk);
    start = cut;
  }
  const tail = text.slice(start).trim();
  if (!tail) return null;
  sourceChunks.push(tail);
  if (sourceChunks.some((chunk) => chunk.length > SMART_MAX_CHARS)) {
    return null;
  }

  const translations = splitTranslationByChunks(unit.translation, sourceChunks);
  const weights = sourceChunks.map((chunk) => Math.max(1, chunk.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const duration = Math.max(0.01, unit.end - unit.start);
  const output: Segment[] = [];
  let consumed = 0;
  let segmentStart = unit.start;

  sourceChunks.forEach((chunk, index) => {
    consumed += weights[index];
    const end =
      index === sourceChunks.length - 1
        ? unit.end
        : unit.start + (duration * consumed) / totalWeight;
    output.push({
      start: segmentStart,
      end: Math.max(segmentStart + 0.01, end),
      text: chunk,
      translation: translations[index]?.trim() || undefined,
    });
    segmentStart = end;
  });
  return output;
}

function splitForSmartBalanced(unit: Segment): Segment[] {
  const text = normalizeText(unit.text);
  if (!text) return [unit];
  const candidates = smartBoundaryCandidates(text);
  if (!candidates.length) return [unit];

  const desired = Math.max(1, Math.ceil(text.length / SMART_TARGET_CHARS));
  const minimumChunks = Math.ceil(text.length / SMART_MAX_CHARS);
  const startCount = Math.max(desired, minimumChunks);

  for (let count = startCount; count <= startCount + 2; count += 1) {
    const chunks = buildBalancedSmartChunks(unit, text, count, candidates);
    if (chunks) return chunks;
  }
  return [unit];
}

function splitAtBoundaries(
  unit: Segment,
  boundaries: number[],
  maxChars: number,
  minChars: number
): Segment[] {
  const text = normalizeText(unit.text);
  if (!boundaries.length || text.length <= maxChars) return [unit];
  const sourceChunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const remaining = text.slice(start).trim();
    if (remaining.length <= maxChars) {
      if (remaining) sourceChunks.push(remaining);
      break;
    }
    const target = start + maxChars;
    let cut = -1;
    for (const boundary of boundaries) {
      if (boundary <= start + minChars) continue;
      if (boundary <= target) cut = boundary;
      else break;
    }
    if (cut < 0) {
      for (const boundary of boundaries) {
        if (boundary > target && boundary <= start + SMART_MAX_CHARS) {
          cut = boundary;
          break;
        }
      }
    }
    if (cut < 0) {
      if (remaining) sourceChunks.push(remaining);
      break;
    }
    const chunk = text.slice(start, cut).trim();
    if (chunk) sourceChunks.push(chunk);
    start = cut;
  }

  if (sourceChunks.length <= 1) return [unit];
  const translations = splitTranslationByChunks(unit.translation, sourceChunks);
  const weights = sourceChunks.map((chunk) => Math.max(1, chunk.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const duration = Math.max(0.01, unit.end - unit.start);
  const output: Segment[] = [];
  let consumed = 0;
  let segmentStart = unit.start;

  sourceChunks.forEach((chunk, index) => {
    consumed += weights[index];
    const end =
      index === sourceChunks.length - 1
        ? unit.end
        : unit.start + (duration * consumed) / totalWeight;
    output.push({
      start: segmentStart,
      end: Math.max(segmentStart + 0.01, end),
      text: chunk,
      translation: translations[index]?.trim() || undefined,
    });
    segmentStart = end;
  });
  return output;
}

function splitForSmart(unit: Segment): Segment[] {
  const duration = unit.end - unit.start;
  if (unit.text.length <= SMART_MAX_CHARS && duration <= 14) return [unit];

  const balanced = splitForSmartBalanced(unit);
  if (balanced.length > 1) return balanced;

  // Last-resort fallback for pathological text with no usable boundaries.
  return splitAtBoundaries(
    unit,
    smartBoundaries(unit.text),
    SMART_TARGET_CHARS,
    SMART_MIN_CHARS
  );
}

function limitWhole(unit: Segment): Segment[] {
  const duration = unit.end - unit.start;
  if (unit.text.length <= WHOLE_MAX_CHARS && duration <= WHOLE_MAX_DURATION) {
    return [unit];
  }
  // A sentence with no punctuation can be arbitrarily long in ASR tracks.
  // Only this emergency path cuts it, at clause punctuation when available.
  return splitAtBoundaries(
    unit,
    smartBoundaries(unit.text),
    WHOLE_MAX_CHARS,
    SMART_MIN_CHARS
  );
}

/**
 * Convert raw caption cues into display sentences.
 *
 * `smart` keeps a sentence whole while it fits; for a long sentence it derives
 * the number of cards from the total length and cuts near evenly spaced ideal
 * positions, preferring punctuation or a word gap. `whole` keeps one complete
 * sentence per card. Both modes first repair cues that begin or end in the
 * middle of a sentence, which is common in YouTube manual tracks.
 */
export function segmentSubtitleCues(cues: Cue[], mode: 'smart' | 'whole'): Cue[] {
  if (!cues.length) return [];
  const segments = cues.flatMap(splitCue);
  const sentences = groupSentences(segments);
  const output =
    mode === 'smart'
      ? sentences.flatMap(splitForSmart)
      : sentences.flatMap(limitWhole);

  const displayCues: Cue[] = output
    .map((segment) => ({
      start: Number(segment.start.toFixed(3)),
      end: Number(segment.end.toFixed(3)),
      text: normalizeText(segment.text),
      ...(segment.translation ? { translation: segment.translation } : {}),
    }))
    .filter(
      (cue) =>
        cue.text &&
        Number.isFinite(cue.start) &&
        Number.isFinite(cue.end) &&
        cue.end > cue.start
    );

  // Providers sometimes repeat the last translated word at the beginning of
  // the next cue ("目标：...") when a caption boundary falls mid-sentence.
  for (let index = 1; index < displayCues.length; index += 1) {
    const cue = displayCues[index];
    if (!cue.translation) continue;
    const stripped = stripRepeatedTranslationLead(
      cue.translation,
      displayCues[index - 1]?.translation
    );
    if (stripped && stripped !== cue.translation) {
      displayCues[index] = { ...cue, translation: stripped };
    }
  }

  return displayCues;
}
