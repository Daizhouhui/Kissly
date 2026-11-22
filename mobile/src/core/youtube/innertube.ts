import { BROWSER_HEADERS, httpJson, httpText } from '../http';
import { CaptionTrack, Cue, VideoMeta } from '../types';
import {
  extractInitialPlayerResponse,
  parseCaptionText,
} from './parse';

const WEB_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
// YouTube's mobile clients still receive servable caption URLs. The web
// player's timedtext URLs now answer 200 with an empty body (they require a
// proof-of-origin token that is generated inside the signed-in web player).
// Keep the Android client first so captions work without cookies or login.
const ANDROID_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';

type ClientConfig = {
  name: string;
  version: string;
  key: string;
  headers: Record<string, string>;
  extra?: Record<string, unknown>;
};

const CLIENTS: ClientConfig[] = [
  {
    name: 'ANDROID',
    version: '21.03.36',
    key: ANDROID_KEY,
    headers: {
      'X-Youtube-Client-Name': '3',
      'X-Youtube-Client-Version': '21.03.36',
      'X-Goog-Api-Format-Version': '2',
      'User-Agent':
        'com.google.android.youtube/21.03.36 (Linux; U; Android 14) gzip',
    },
    extra: {
      androidSdkVersion: 34,
      osName: 'Android',
      osVersion: '14',
    },
  },
  {
    name: 'ANDROID',
    version: '20.10.38',
    key: ANDROID_KEY,
    headers: {
      'X-Youtube-Client-Name': '3',
      'X-Youtube-Client-Version': '20.10.38',
      'X-Goog-Api-Format-Version': '2',
      'User-Agent':
        'com.google.android.youtube/20.10.38 (Linux; U; Android 13) gzip',
    },
    extra: {
      androidSdkVersion: 33,
      osName: 'Android',
      osVersion: '13',
    },
  },
  {
    name: 'IOS',
    version: '20.03.02',
    key: ANDROID_KEY,
    headers: {
      'X-Youtube-Client-Name': '5',
      'X-Youtube-Client-Version': '20.03.02',
      'X-Goog-Api-Format-Version': '2',
      'User-Agent':
        'com.google.ios.youtube/20.03.02 (iPhone16,2; U; CPU iOS 18_2_1 like Mac OS X;)',
    },
    extra: {
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.2.1.22C161',
    },
  },
  {
    name: 'WEB',
    version: '2.20260101.00.00',
    key: WEB_KEY,
    headers: {
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': '2.20260101.00.00',
    },
  },
];

function normalizeTrack(track: any): CaptionTrack | null {
  if (!track || typeof track.baseUrl !== 'string') return null;
  const name =
    track.name?.simpleText ||
    track.name?.runs?.map((run: any) => run.text).join('') ||
    track.languageCode ||
    'Unknown';
  return {
    baseUrl: track.baseUrl.startsWith('http')
      ? track.baseUrl
      : `https://www.youtube.com${track.baseUrl}`,
    languageCode: track.languageCode ?? '',
    name,
    kind: track.kind,
    isTranslatable: track.isTranslatable,
  };
}

function parsePlayerResponse(response: any): VideoMeta | null {
  const details = response?.videoDetails;
  if (!details?.videoId) return null;
  const tracks = (response?.captions?.playerCaptionsTracklistRenderer
    ?.captionTracks ?? []) as any[];
  const thumbnails = details?.thumbnail?.thumbnails ?? [];
  return {
    videoId: details.videoId,
    title: details.title ?? '',
    author: details.author ?? '',
    channelId: details.channelId ?? undefined,
    lengthSeconds: Number(details.lengthSeconds ?? 0),
    thumbnail:
      thumbnails[thumbnails.length - 1]?.url ??
      `https://i.ytimg.com/vi/${details.videoId}/hqdefault.jpg`,
    captionTracks: tracks
      .map(normalizeTrack)
      .filter((track): track is CaptionTrack => !!track),
    visitorData: response?.responseContext?.visitorData,
  };
}

async function fetchPlayerWithClient(
  videoId: string,
  client: ClientConfig
): Promise<any | null> {
  try {
    const url = `https://www.youtube.com/youtubei/v1/player?key=${client.key}&prettyPrint=false`;
    const body = {
      context: {
        client: {
          clientName: client.name,
          clientVersion: client.version,
          hl: 'en',
          gl: 'US',
          ...(client.extra ?? {}),
        },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    };
    const response = await httpJson(url, {
      method: 'POST',
      body,
      timeoutMs: 15000,
      headers: {
        ...BROWSER_HEADERS,
        ...client.headers,
        'Content-Type': 'application/json',
        Origin: 'https://www.youtube.com',
        Referer: `https://www.youtube.com/watch?v=${videoId}`,
      },
    });
    return response;
  } catch {
    return null;
  }
}

async function fetchPlayerFromWatchPage(videoId: string): Promise<any | null> {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}&hl=en&bpctr=9999999999&has_verified=1`;
    const response = await httpText(url, {
      timeoutMs: 15000,
      headers: {
        ...BROWSER_HEADERS,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (response.status !== 200) return null;
    return extractInitialPlayerResponse(response.text);
  } catch {
    return null;
  }
}

/**
 * Query all player clients at once. A client that returns caption tracks wins
 * immediately; otherwise the first usable metadata (in client order) is kept
 * as a fallback. This replaces the old 4×20s serial chain.
 */
function racePlayerMetadata(videoId: string): Promise<VideoMeta | null> {
  const tasks = CLIENTS.map((client) =>
    fetchPlayerWithClient(videoId, client)
  );
  if (!tasks.length) return Promise.resolve(null);

  return new Promise((resolve) => {
    const results: (VideoMeta | null)[] = new Array(tasks.length).fill(null);
    let pending = tasks.length;
    let settled = false;

    const finishFallback = () => {
      if (settled) return;
      settled = true;
      resolve(results.find((item) => item) ?? null);
    };

    tasks.forEach((task, index) => {
      task
        .then((response) => {
          if (settled) return;
          const parsed = response ? parsePlayerResponse(response) : null;
          if (parsed?.captionTracks.length) {
            settled = true;
            resolve(parsed);
            return;
          }
          results[index] = parsed;
        })
        .catch(() => {
          results[index] = null;
        })
        .finally(() => {
          pending -= 1;
          if (pending === 0) finishFallback();
        });
    });
  });
}

export async function getVideoMeta(videoId: string): Promise<VideoMeta> {
  const raced = await racePlayerMetadata(videoId);
  if (raced) return raced;

  const htmlResponse = await fetchPlayerFromWatchPage(videoId);
  const parsed = parsePlayerResponse(htmlResponse);
  if (parsed) return parsed;

  throw new Error('无法读取该视频的信息，可能被限制访问');
}

export function pickCaptionTracks(
  tracks: CaptionTrack[],
  preferredLanguage = 'en'
): CaptionTrack[] {
  if (!tracks.length) return [];
  const manual = tracks.filter((track) => (track.kind ?? '') !== 'asr');
  const auto = tracks.filter((track) => (track.kind ?? '') === 'asr');
  const preferred = preferredLanguage.toLowerCase().split('-')[0];
  const matches = (track: CaptionTrack) =>
    track.languageCode.toLowerCase() === preferredLanguage.toLowerCase() ||
    track.languageCode.toLowerCase().split('-')[0] === preferred;
  const matchingManual = manual.filter(matches);
  const matchingAuto = auto.filter(matches);
  const candidates = matchingManual.length || matchingAuto.length
    ? [...matchingManual, ...matchingAuto]
    : [...manual, ...auto];
  const seen = new Set<string>();
  return candidates
    .filter((track) => {
      const key = `${track.languageCode}|${track.kind ?? 'manual'}|${track.baseUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

export function pickCaptionTrack(
  tracks: CaptionTrack[],
  preferredLanguage = 'en'
): CaptionTrack | null {
  return pickCaptionTracks(tracks, preferredLanguage)[0] ?? null;
}

/**
 * How much of the video the parsed cues actually cover. YouTube's ASR can
 * return a complete json3 track for one request and a truncated one for
 * another; choosing only "the first track with 3 cues" creates the scattered
 * missing-caption bug. Coverage and end-time are therefore scored together.
 */
export function captionQualityScore(cues: Cue[], durationSeconds = 0): number {
  if (!cues.length) return 0;
  const lastEnd = cues.reduce((max, cue) => Math.max(max, cue.end), 0);
  const covered = cues.reduce((sum, cue) => sum + Math.max(0, cue.end - cue.start), 0);
  const chars = cues.reduce((sum, cue) => sum + cue.text.length, 0);
  const duration = durationSeconds > 0 ? durationSeconds : Math.max(lastEnd, 1);
  let gapSeconds = 0;
  for (let index = 1; index < cues.length; index += 1) {
    const gap = cues[index].start - cues[index - 1].end;
    if (gap > 2.5) gapSeconds += gap;
  }
  const coverage = Math.min(1, covered / duration);
  const endRatio = Math.min(1, lastEnd / duration);
  return coverage * 100 + endRatio * 30 - gapSeconds * 0.5 + Math.min(chars, 20000) * 0.001;
}

function withFormat(baseUrl: string, format: string): string {
  const clean = baseUrl.replace(/&amp;/g, '&');
  if (/[?&]fmt=/.test(clean)) {
    return clean.replace(/([?&])fmt=[^&]*/, `$1fmt=${format}`);
  }
  const joiner = clean.includes('?') ? '&' : '?';
  return `${clean}${joiner}fmt=${format}`;
}

function withAndroidClient(baseUrl: string): string {
  const clean = baseUrl.replace(/&amp;/g, '&');
  if (/[?&]c=/.test(clean)) {
    return clean.replace(/([?&])c=[^&]*/, '$1c=ANDROID');
  }
  const joiner = clean.includes('?') ? '&' : '?';
  return `${clean}${joiner}c=ANDROID`;
}

export async function fetchCaptionCues(
  track: CaptionTrack,
  durationSeconds = 0,
  visitorData = ''
): Promise<Cue[]> {
  // Fetch every format, score what actually came back, and keep the most
  // complete response. YouTube sometimes serves a truncated json3 payload
  // for the same track while the VTT response contains the full rolling
  // transcript. The old code returned the first json3 with 3+ cues, which is
  // exactly how scattered missing subtitles were introduced.
  const variants = [
    { label: 'original', rank: 0, url: track.baseUrl },
    {
      label: 'json3-android',
      rank: 7,
      url: withAndroidClient(withFormat(track.baseUrl, 'json3')),
    },
    { label: 'json3', rank: 5, url: withFormat(track.baseUrl, 'json3') },
    {
      label: 'vtt-android',
      rank: 2,
      url: withAndroidClient(withFormat(track.baseUrl, 'vtt')),
    },
    { label: 'vtt', rank: 0, url: withFormat(track.baseUrl, 'vtt') },
    {
      label: 'srv3-android',
      rank: 4,
      url: withAndroidClient(withFormat(track.baseUrl, 'srv3')),
    },
    { label: 'srv3', rank: 3, url: withFormat(track.baseUrl, 'srv3') },
  ];
  const results = await Promise.all(
    variants.map(async (variant) => {
      try {
        const response = await httpText(variant.url, {
          timeoutMs: 8000,
          headers: {
            ...BROWSER_HEADERS,
            'User-Agent':
              'com.google.android.youtube/21.03.36 (Linux; U; Android 14) gzip',
            'X-Goog-Api-Format-Version': '2',
            ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
            Accept: 'application/json,text/xml,text/vtt,text/plain,*/*',
            Origin: 'https://m.youtube.com',
            Referer: 'https://m.youtube.com/',
          },
        });
        if (response.status !== 200 || !response.text.trim()) return null;
        const cues = parseCaptionText(response.text, track.languageCode);
        if (!cues.length) return null;
        return {
          cues,
          score:
            captionQualityScore(cues, durationSeconds) + variant.rank,
        };
      } catch {
        // A single blocked format should not block the others.
        return null;
      }
    })
  );

  const best = results.reduce<{ cues: Cue[]; score: number } | null>(
    (current, result) =>
      result && (!current || result.score > current.score) ? result : current,
    null
  );
  if (best) return best.cues;
  throw new Error('该视频没有可用的字幕数据');
}

export async function fetchTranslatedCaptionCues(
  track: CaptionTrack,
  targetLang: string
): Promise<Cue[]> {
  const clean = track.baseUrl.replace(/&amp;/g, '&');
  const joiner = clean.includes('?') ? '&' : '?';
  const url = `${clean}${joiner}tlang=${encodeURIComponent(
    targetLang
  )}&fmt=json3`;
  const response = await httpText(url, {
    timeoutMs: 20000,
    headers: {
      ...BROWSER_HEADERS,
      Accept: '*/*',
      Referer: 'https://www.youtube.com/',
    },
  });
  if (response.status !== 200 || !response.text.trim()) {
    throw new Error('YouTube 自动翻译字幕不可用');
  }
  return parseCaptionText(response.text, targetLang);
}
