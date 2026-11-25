export type AudioTrackCandidate = {
  id?: string;
  name?: string;
  isOriginal?: boolean;
  isDefault?: boolean;
  isAutoDubbed?: boolean;
};

type ResolvedTrack = AudioTrackCandidate & {
  lang: string;
};

const LANGUAGE_ALIASES: Record<string, string> = {
  'zh-cn': 'zh-hans',
  'zh-sg': 'zh-hans',
  'zh-tw': 'zh-hant',
  'zh-hk': 'zh-hant',
  'zh-mo': 'zh-hant',
};

function canonicalLanguage(value: string): string {
  const lower = value.trim().toLowerCase().replace('_', '-');
  return LANGUAGE_ALIASES[lower] ?? lower;
}

function baseLanguage(value: string): string {
  return canonicalLanguage(value).split('-')[0];
}

/** YouTube track ids look like `en-US.3`, `en.4`, `zh-Hans.2`. */
function languageTagFromId(id: string | undefined): string {
  const match = String(id ?? '')
    .trim()
    .match(/^([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})?)/);
  return match ? canonicalLanguage(match[1]) : '';
}

function languageTagFromName(name: string | undefined): string {
  const value = String(name ?? '').trim();
  if (!value) return '';
  const lower = value.toLowerCase();
  if (/english|英语|英語/.test(lower)) {
    if (/uk|gb|british|england|英式|英国|英國/.test(lower)) return 'en-gb';
    if (/us|american|美式|美国|美國/.test(lower)) return 'en-us';
    return 'en';
  }
  if (/japanese|日语|日語|日本語/.test(lower)) return 'ja';
  if (/korean|韩语|韓語|한국어/.test(lower)) return 'ko';
  if (/spanish|西班牙语|西班牙語|español/.test(lower)) return 'es';
  if (/french|法语|法語|français/.test(lower)) return 'fr';
  if (/german|德语|德語|deutsch/.test(lower)) return 'de';
  if (/chinese|中文|汉语|漢語/.test(lower)) {
    if (/traditional|繁體|繁体|台湾|台灣/.test(lower)) return 'zh-hant';
    if (/simplified|简体|簡體|中国|中國/.test(lower)) return 'zh-hans';
    return 'zh';
  }
  return '';
}

function resolveTrack(track: AudioTrackCandidate): ResolvedTrack | null {
  const lang = languageTagFromId(track.id) || languageTagFromName(track.name);
  if (!lang) return null;
  const name = String(track.name ?? '');
  const isOriginal =
    track.isOriginal === true ||
    /原始|原声|原聲|original/i.test(name);
  return { ...track, lang, isOriginal };
}

function matchesOriginalLanguage(
  trackLanguage: string,
  learningLanguage: string
): boolean {
  const target = canonicalLanguage(learningLanguage);
  const track = canonicalLanguage(trackLanguage);
  if (!target || !track) return false;
  // `en`, `ja`, `es` mean "any variant of that language". A regional target
  // such as `zh-CN` must not silently accept Traditional Chinese.
  return target.includes('-') ? track === target : baseLanguage(track) === target;
}

function pickEnglishVariant(
  candidates: ResolvedTrack[],
  accent: string
): ResolvedTrack {
  const preferred =
    canonicalLanguage(accent) === 'en-gb' ? 'en-gb' : 'en-us';
  const exact = candidates.find(
    (track) => canonicalLanguage(track.lang) === preferred
  );
  if (exact) return exact;
  const generic = candidates.find(
    (track) => canonicalLanguage(track.lang) === 'en'
  );
  if (generic) return generic;
  return candidates[0];
}

function pickVariant(
  candidates: ResolvedTrack[],
  learningLanguage: string,
  accent: string
): ResolvedTrack {
  const target = canonicalLanguage(learningLanguage);
  const targetBase = baseLanguage(target);
  if (targetBase === 'en') {
    return pickEnglishVariant(candidates, accent);
  }
  const exact = candidates.find(
    (track) => canonicalLanguage(track.lang) === target
  );
  if (exact) return exact;
  const generic = candidates.find(
    (track) => canonicalLanguage(track.lang) === targetBase
  );
  if (generic) return generic;
  return candidates[0];
}

/**
 * Choose the audio track that matches the learner's language.
 *
 * Rules:
 * 1. If the video's original track is already in the learning language, keep
 *    it. This preserves an English (UK) original even when US is preferred.
 * 2. Otherwise prefer the configured English variant (`en-US` by default),
 *    then a generic English track, then any remaining English track.
 * 3. Non-English learning languages use an exact regional match first.
 * 4. Return null when the video has no track in the learning language; the
 *    caller must not switch audio in that case.
 */
export function pickPreferredAudioTrack(
  tracks: AudioTrackCandidate[],
  learningLanguage: string,
  englishAccent = 'en-US'
): AudioTrackCandidate | null {
  if (!Array.isArray(tracks) || !tracks.length) return null;
  const target = canonicalLanguage(String(learningLanguage ?? ''));
  if (!target) return null;

  const resolved = tracks
    .map(resolveTrack)
    .filter((track): track is ResolvedTrack => !!track);
  if (!resolved.length) return null;

  const original = resolved.find(
    (track) =>
      track.isOriginal &&
      matchesOriginalLanguage(track.lang, learningLanguage)
  );
  if (original) return original;

  const candidates = resolved.filter(
    (track) => baseLanguage(track.lang) === baseLanguage(learningLanguage)
  );
  if (!candidates.length) return null;
  return pickVariant(candidates, learningLanguage, englishAccent);
}
