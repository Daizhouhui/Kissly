import { BROWSER_HEADERS, httpJson } from '../http';

const SEARCH_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const SEARCH_URL = `https://www.youtube.com/youtubei/v1/search?key=${SEARCH_KEY}&prettyPrint=false`;
const CHANNEL_FILTER = 'EgIQAg%3D%3D';

export type ChannelSearchResult = {
  channelId: string;
  title: string;
  handle?: string;
  avatar?: string;
  subscriberCount?: string;
  videoCount?: string;
};

function textOf(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.runs)) {
    return value.runs.map((run: any) => run?.text ?? '').join('');
  }
  return '';
}

function avatarOf(value: any): string {
  const thumbnails = value?.thumbnail?.thumbnails;
  if (!Array.isArray(thumbnails) || !thumbnails.length) return '';
  return String(thumbnails[thumbnails.length - 1]?.url ?? '');
}

function handleOf(node: any): string {
  const canonical =
    node?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ??
    node?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url ??
    node?.subscriberCountText?.runs?.[0]?.navigationEndpoint?.browseEndpoint
      ?.canonicalBaseUrl ??
    '';
  if (typeof canonical !== 'string') return '';
  const clean = canonical.startsWith('/') ? canonical.slice(1) : canonical;
  return clean.startsWith('@') ? clean : '';
}

function parseChannel(node: any): ChannelSearchResult | null {
  const channelId = String(node?.channelId ?? '');
  if (!channelId.startsWith('UC')) return null;
  const title = textOf(node.title) || textOf(node.channelTitle);
  if (!title) return null;
  return {
    channelId,
    title,
    handle: handleOf(node) || undefined,
    avatar: avatarOf(node) || undefined,
    subscriberCount: textOf(node.subscriberCountText) || undefined,
    videoCount: textOf(node.videoCountText) || undefined,
  };
}

function walkChannels(node: any, output: Map<string, ChannelSearchResult>) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkChannels(item, output);
    return;
  }
  const renderer = node.channelRenderer ?? node.gridChannelRenderer;
  if (renderer) {
    const parsed = parseChannel(renderer);
    if (parsed && !output.has(parsed.channelId)) output.set(parsed.channelId, parsed);
  }
  for (const key of Object.keys(node)) {
    if (key === 'channelRenderer' || key === 'gridChannelRenderer') continue;
    walkChannels(node[key], output);
  }
}

export async function searchChannels(
  query: string,
  timeoutMs = 20000
): Promise<ChannelSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const data = await httpJson(SEARCH_URL, {
    method: 'POST',
    timeoutMs,
    headers: {
      ...BROWSER_HEADERS,
      'Content-Type': 'application/json',
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
    },
    body: {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20260101.00.00',
          hl: 'en',
          gl: 'US',
        },
      },
      query: trimmed,
      params: CHANNEL_FILTER,
    },
  });
  const output = new Map<string, ChannelSearchResult>();
  walkChannels(data, output);
  return Array.from(output.values()).slice(0, 24);
}
