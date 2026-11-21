import { Cue } from '../types';
import { stripHtml } from '../utils';

/**
 * YouTube caption parsing.
 *
 * The important detail here is that json3 ASR captions are word-level events:
 * every `segs[]` entry carries a `tOffsetMs` inside the parent event. The old
 * mobile parser ignored `tOffsetMs`, merged overlapping rolling captions and
 * then re-distributed timestamps by character count. That produced exactly the
 * "missing lines / subtitles no longer match the audio" symptom. We instead
 * flatten the word events first and only then group them into readable lines,
 * keeping the original word timings.
 */

type TimedSegment = {
  text: string;
  start: number;
  end: number;
};

type TimedEvent = {
  tStartMs: number;
  dDurationMs: number;
  segs: Array<{ utf8: string; tOffsetMs?: number; acAsrConf?: number }>;
  aAppend?: number;
};

const NO_SPACE_LANGUAGES = ['zh', 'ja', 'ko', 'th', 'lo', 'km', 'my'];
const NON_SPEECH_RE = /^(?:>>\s*)?(?:\[[^\]\r\n]+\]\s*)+$/u;
const LONG_LINE = 120;
const PAUSE_MS = 1000;
const MAX_DURATION_MS = 10000;

function decodeEntities(value: string): string {
  return stripHtml(
    value
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
      .replace(/\u200B/g, '')
  );
}

function cleanTimedText(value: string): string {
  return stripCaptionMarkers(
    decodeEntities(String(value ?? '').replace(/<[^>]+>/g, ''))
  )
    .replace(/\s+/g, ' ')
    .trim();
}

// YouTube auto-captions prefix a speaker change with ">>" (sometimes repeated).
// It is a caption control marker, not spoken text, so keep it out of the
// transcript, translations, favorites and sentence analysis.
function stripCaptionMarkers(value: string): string {
  return value.replace(/^\s*(?:>>\s*)+/u, '');
}

function isNonSpeech(text: string): boolean {
  return NON_SPEECH_RE.test(text.trim());
}

function eventText(event: TimedEvent): string {
  return cleanTimedText(
    (event.segs ?? []).map((seg) => String(seg?.utf8 ?? '')).join(' ')
  );
}

function eventKey(event: TimedEvent): string {
  const text = eventText(event);
  if (!text) return '';
  return `${Number(event.tStartMs) || 0}|${Number(event.dDurationMs) || 0}|${text}`;
}

function nextEventStart(
  events: TimedEvent[],
  fromIndex: number,
  currentStartMs: number
): number {
  for (let index = fromIndex + 1; index < events.length; index += 1) {
    const start = Number(events[index]?.tStartMs);
    if (Number.isFinite(start) && start > currentStartMs) return start;
  }
  return NaN;
}

function expandWords(
  text: string,
  startMs: number,
  endMs: number
): Array<{ text: string; start: number; end: number }> | null {
  const words = text.split(' ').filter(Boolean);
  if (words.length < 2 || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  const totalWeight = words.reduce((sum, word) => sum + word.length, 0) || 1;
  let elapsed = 0;
  return words.map((word, index) => {
    const wordStart = startMs + ((endMs - startMs) * elapsed) / totalWeight;
    elapsed += word.length;
    const wordEnd =
      index === words.length - 1
        ? endMs
        : startMs + ((endMs - startMs) * elapsed) / totalWeight;
    return { text: word, start: wordStart / 1000, end: wordEnd / 1000 };
  });
}

export function flattenCaptionEvents(
  rawEvents: TimedEvent[],
  languageCode = 'auto'
): TimedSegment[] {
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  const canExpand = !NO_SPACE_LANGUAGES.some((lang) =>
    String(languageCode).toLowerCase().startsWith(lang)
  );
  const segments: TimedSegment[] = [];
  let buffer: TimedSegment | null = null;
  let lastKey = '';

  const flush = (endAtMs?: number) => {
    if (!buffer) return;
    const endAt =
      Number.isFinite(endAtMs) && endAtMs !== undefined
        ? Number(endAtMs) / 1000
        : undefined;
    if (endAt !== undefined && (!buffer.end || buffer.end > endAt)) {
      buffer.end = endAt;
    }
    if (Number.isFinite(buffer.end) && buffer.end > buffer.start) {
      segments.push({ ...buffer });
    }
    buffer = null;
  };

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex] ?? ({} as TimedEvent);
    const key = eventKey(event);
    if (key && key === lastKey) continue;
    const segs = Array.isArray(event.segs) ? event.segs : [];
    const tStartMs = Number(event.tStartMs) || 0;
    const dDurationMs = Number(event.dDurationMs) || 0;
    if (key) lastKey = key;

    for (let segIndex = 0; segIndex < segs.length; segIndex += 1) {
      const seg = segs[segIndex] ?? { utf8: '' };
      const text = cleanTimedText(seg.utf8 ?? '');
      const startMs = tStartMs + (Number(seg.tOffsetMs) || 0);

      if (!text || isNonSpeech(text)) {
        if (!buffer || startMs > buffer.start * 1000) flush(startMs);
        continue;
      }

      flush(startMs);
      const nextOffset =
        segIndex === segs.length - 1
          ? dDurationMs
          : Number(segs[segIndex + 1]?.tOffsetMs) || 0;
      const declaredEnd = tStartMs + nextOffset;
      const followingStart = nextEventStart(events, eventIndex, startMs);
      const effectiveEnd =
        segIndex === segs.length - 1 &&
        Number.isFinite(followingStart) &&
        followingStart > startMs
          ? Math.min(declaredEnd, followingStart)
          : declaredEnd;

      const asr = Object.prototype.hasOwnProperty.call(seg, 'acAsrConf');
      const expanded =
        asr && canExpand && text.includes(' ')
          ? expandWords(text, startMs, effectiveEnd)
          : null;
      if (expanded?.length) {
        segments.push(...expanded.slice(0, -1));
        buffer = expanded[expanded.length - 1];
        continue;
      }

      buffer = { text, start: startMs / 1000, end: 0 };
      if (segIndex === segs.length - 1) {
        buffer.end = (tStartMs + dDurationMs) / 1000;
      }
    }
  }

  flush();
  return segments.filter(
    (item) =>
      item.text &&
      Number.isFinite(item.start) &&
      Number.isFinite(item.end) &&
      item.end > item.start
  );
}

function isSentenceEnd(text: string): boolean {
  return /[.!?…][”’"')\]]*$/.test(text.trim());
}

function isComma(text: string): boolean {
  return /[,，、;；:：]$/.test(text.trim());
}

/**
 * Group word-level events into readable sentence cues. Timestamps are the
 * first/last word timestamps, never a proportional estimate.
 */
export function groupCaptionSegments(
  segments: TimedSegment[],
  languageCode = 'auto'
): Cue[] {
  if (!segments.length) return [];
  const noSpace = NO_SPACE_LANGUAGES.some((lang) =>
    String(languageCode).toLowerCase().startsWith(lang)
  );
  const cues: Cue[] = [];
  let current: TimedSegment[] = [];
  let charCount = 0;
  let wordCount = 0;

  const flush = () => {
    if (!current.length) return;
    const text = noSpace
      ? current.map((item) => item.text).join('')
      : current.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
    if (text) {
      const start = current[0].start;
      const end = Math.max(current[current.length - 1].end, start + 0.18);
      cues.push({
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        text,
      });
    }
    current = [];
    charCount = 0;
    wordCount = 0;
  };

  for (const segment of segments) {
    const last = current[current.length - 1];
    if (last) {
      const gapMs = (segment.start - last.end) * 1000;
      // Use the next word's start, not the previous word's possibly-held
      // VTT end timestamp, so a long silent hold does not split a sentence.
      const durationMs = (segment.start - current[0].start) * 1000;
      const nextChars =
        charCount + segment.text.length + (noSpace ? 0 : 1);
      const nextWords = wordCount + segment.text.split(/\s+/).filter(Boolean).length;
      const shouldFlush =
        isSentenceEnd(last.text) ||
        gapMs > PAUSE_MS ||
        durationMs > MAX_DURATION_MS ||
        nextChars > LONG_LINE ||
        (isComma(last.text) && nextWords >= 15);
      if (shouldFlush) flush();
    }
    current.push(segment);
    charCount += segment.text.length + (noSpace ? 0 : 1);
    wordCount += segment.text.split(/\s+/).filter(Boolean).length;
  }
  flush();

  // A few automatic tracks leave one-word cues with no punctuation. Merge only
  // very short neighbours that are already contiguous; never invent timings.
  return cues.filter((cue) => cue.text.trim() && cue.end > cue.start);
}

export function parseJson3(payload: any, languageCode = 'auto'): Cue[] {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  if (!events.length) return [];
  const segments = flattenCaptionEvents(events as TimedEvent[], languageCode);
  return groupCaptionSegments(segments, languageCode);
}

export function parseSrv3(xml: string, languageCode = 'auto'): Cue[] {
  const events: TimedEvent[] = [];
  const bodyMatch = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : xml;
  const paragraphRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let match: RegExpExecArray | null;
  while ((match = paragraphRe.exec(body))) {
    const attrs = match[1];
    const inner = match[2];
    const tMatch = attrs.match(/\bt="(\d+)"/);
    const dMatch = attrs.match(/\bd="(\d+)"/);
    if (!tMatch || !dMatch) continue;
    const tStartMs = Number(tMatch[1]);
    const dDurationMs = Number(dMatch[1]);
    if (!Number.isFinite(tStartMs) || !Number.isFinite(dDurationMs)) continue;
    const wordRe = /<s([^>]*)>([\s\S]*?)<\/s>/gi;
    const segs: TimedEvent['segs'] = [];
    let word: RegExpExecArray | null;
    while ((word = wordRe.exec(inner))) {
      const offset = word[1].match(/\bt="(\d+)"/);
      segs.push({
        utf8: word[2].replace(/<[^>]+>/g, ''),
        ...(offset ? { tOffsetMs: Number(offset[1]), acAsrConf: 1 } : {}),
      });
    }
    if (!segs.length) {
      segs.push({ utf8: inner.replace(/<[^>]+>/g, '') });
    }
    events.push({ tStartMs, dDurationMs, segs });
  }
  if (!events.length) return [];
  const segments = flattenCaptionEvents(events, languageCode);
  return groupCaptionSegments(segments, languageCode);
}

export function parseVtt(vtt: string, languageCode = 'auto'): Cue[] {
  const lines = vtt.replace(/\r/g, '').split('\n');
  const segments: TimedSegment[] = [];
  let start = 0;
  let end = 0;
  let textLines: string[] = [];
  let previousLastLine = '';
  let sawInlineTags = false;

  const flush = () => {
    const duration = end - start;
    if (duration > 0 && textLines.length) {
      const cleanedLines = textLines.map(cleanTimedText).filter(Boolean);
      const firstLine = cleanedLines[0] ?? '';
      const lastLine = cleanedLines[cleanedLines.length - 1] ?? '';
      const rolling =
        sawInlineTags &&
        cleanedLines.length >= 2 &&
        !!previousLastLine &&
        (firstLine === previousLastLine ||
          firstLine.startsWith(`${previousLastLine} `) ||
          previousLastLine.startsWith(`${firstLine} `));
      // YouTube's auto-generated VTT is a rolling two-line transcript:
      // the first line repeats the previous cue and the last line contains
      // the newly spoken words with inline absolute timestamps. Parsing the
      // whole cue would duplicate every previous line; parsing only the
      // timestamped line keeps the complete, unique word stream.
      const taggedLine = [...textLines]
        .reverse()
        .find((line) => /<(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})>/.test(line));
      let produced = false;
      if (taggedLine) {
        sawInlineTags = true;
        const tagRe = /<(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})>/g;
        let cursorTime = start;
        let cursorIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = tagRe.exec(taggedLine))) {
          const at = Number(match[1] ?? 0) * 3600 +
            Number(match[2]) * 60 +
            Number(match[3]) +
            Number(match[4]) / 1000;
          const text = cleanTimedText(taggedLine.slice(cursorIndex, match.index));
          if (text && at > cursorTime && at <= end) {
            segments.push({ text, start: cursorTime, end: at });
            produced = true;
          }
          cursorTime = Math.max(cursorTime, Math.min(at, end));
          cursorIndex = tagRe.lastIndex;
        }
        const tail = cleanTimedText(taggedLine.slice(cursorIndex));
        if (tail && end > cursorTime) {
          segments.push({ text: tail, start: cursorTime, end });
          produced = true;
        }
      }
      if (!produced) {
        // Manual VTT: keep the whole cue. Rolling VTT cues without inline
        // timestamps (usually the last fragment of a sentence) must only
        // use the final line, otherwise the previous line is duplicated.
        const joined = rolling ? lastLine : cleanTimedText(textLines.join(' '));
        if (joined && duration >= 0.05) {
          segments.push({ text: joined, start, end });
        }
      }
      if (lastLine) previousLastLine = lastLine;
    }
    textLines = [];
  };

  for (const line of lines) {
    const timing = line.match(
      /^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})/
    );
    if (timing) {
      flush();
      start =
        Number(timing[1] ?? 0) * 3600 +
        Number(timing[2]) * 60 +
        Number(timing[3]) +
        Number(timing[4]) / 1000;
      end =
        Number(timing[5] ?? 0) * 3600 +
        Number(timing[6]) * 60 +
        Number(timing[7]) +
        Number(timing[8]) / 1000;
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^(WEBVTT|NOTE|Kind:|Language:)/i.test(line)) continue;
    textLines.push(line.trim());
  }
  flush();

  return groupCaptionSegments(
    segments.filter(
      (item) =>
        item.text &&
        !isNonSpeech(item.text) &&
        Number.isFinite(item.start) &&
        Number.isFinite(item.end) &&
        item.end > item.start
    ),
    languageCode
  );
}

export function parseCaptionText(text: string, languageCode = 'auto'): Cue[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{')) {
    try {
      return parseJson3(JSON.parse(trimmed), languageCode);
    } catch {
      return [];
    }
  }
  if (/<transcript|<timedtext/i.test(trimmed)) {
    return parseSrv3(trimmed, languageCode);
  }
  return parseVtt(trimmed, languageCode);
}

export function extractInitialPlayerResponse(html: string): any | null {
  const markers = [
    'ytInitialPlayerResponse = ',
    'ytInitialPlayerResponse =',
    'ytInitialPlayerResponse=',
  ];
  for (const marker of markers) {
    const index = html.indexOf(marker);
    if (index === -1) continue;
    let start = index + marker.length;
    while (start < html.length && /[\s;]/.test(html[start])) start++;
    if (html[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}
