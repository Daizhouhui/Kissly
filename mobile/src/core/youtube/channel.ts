import { BROWSER_HEADERS, httpText } from '../http';
import { Subscription } from '../types';
import { stripHtml } from '../utils';

const CHANNEL_ID_RE = /UC[\w-]{22}/;

function decodeAttribute(value: string): string {
  return stripHtml(
    value
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\\u0026/g, '&')
  );
}

function metaContent(html: string, property: string): string {
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const match = html.match(regex);
  return match ? decodeAttribute(match[1]) : '';
}

function channelIdFromHtml(html: string): string {
  const matches = [
    html.match(/"channelId":"(UC[\w-]{22})"/),
    html.match(/"externalId":"(UC[\w-]{22})"/),
    html.match(/channel_id=(UC[\w-]{22})/),
  ];
  for (const match of matches) {
    if (match?.[1]) return match[1];
  }
  return '';
}

function buildChannelUrl(input: string): string {
  const trimmed = input.trim();
  if (CHANNEL_ID_RE.test(trimmed) && trimmed.length <= 30) {
    return `https://www.youtube.com/channel/${trimmed.match(CHANNEL_ID_RE)![0]}`;
  }
  if (trimmed.startsWith('@')) {
    return `https://www.youtube.com/${trimmed}`;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    if (/youtu\.be\//i.test(trimmed)) {
      const id = trimmed.split('/').pop()?.split('?')[0];
      return `https://www.youtube.com/watch?v=${id}`;
    }
    return trimmed;
  }
  if (/^[\w.-]+$/.test(trimmed) && !trimmed.includes('.')) {
    return `https://www.youtube.com/@${trimmed}`;
  }
  throw new Error('请输入频道链接、@handle 或 UC 开头的频道 ID');
}

async function fetchHtml(url: string): Promise<string> {
  const response = await httpText(url, {
    timeoutMs: 20000,
    headers: {
      ...BROWSER_HEADERS,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (response.status !== 200) {
    throw new Error(`无法打开 YouTube 页面 (${response.status})`);
  }
  return response.text;
}

async function resolveFromVideo(url: string): Promise<Subscription> {
  const html = await fetchHtml(url);
  const channelId = channelIdFromHtml(html);
  if (!channelId) throw new Error('无法从视频页面识别频道');
  return resolveChannelById(channelId);
}

export async function resolveChannelById(
  channelId: string
): Promise<Subscription> {
  const html = await fetchHtml(
    `https://www.youtube.com/channel/${channelId}?hl=en&gl=US`
  );
  const title =
    metaContent(html, 'og:title').replace(/\s*-\s*YouTube\s*$/i, '') ||
    channelId;
  const avatar = metaContent(html, 'og:image');
  return {
    channelId,
    title,
    avatar,
    addedAt: Date.now(),
  };
}

export async function resolveChannelInput(input: string): Promise<Subscription> {
  const url = buildChannelUrl(input);
  if (/\/watch\?|\/shorts\//i.test(url)) {
    return resolveFromVideo(url);
  }
  const html = await fetchHtml(
    url.includes('?') ? url : `${url}?hl=en&gl=US`
  );
  const channelId = channelIdFromHtml(html);
  if (!channelId) {
    throw new Error('没有找到频道，请确认链接或 @handle 是否正确');
  }
  const title =
    metaContent(html, 'og:title').replace(/\s*-\s*YouTube\s*$/i, '') ||
    channelId;
  const avatar = metaContent(html, 'og:image');
  const handleMatch = url.match(/youtube\.com\/@([^/?#]+)/i);
  return {
    channelId,
    title,
    handle: handleMatch ? `@${handleMatch[1]}` : undefined,
    avatar,
    addedAt: Date.now(),
  };
}

export async function refreshChannelInfo(
  sub: Subscription
): Promise<Subscription> {
  try {
    const fresh = await resolveChannelById(sub.channelId);
    return { ...sub, ...fresh, addedAt: sub.addedAt, group: sub.group };
  } catch {
    return sub;
  }
}

export async function fetchChannelDescription(channelId: string): Promise<string> {
  if (!CHANNEL_ID_RE.test(channelId)) return '';
  try {
    const html = await fetchHtml(
      `https://www.youtube.com/channel/${channelId}?hl=en&gl=US`
    );
    return metaContent(html, 'og:description') || metaContent(html, 'description') || '';
  } catch {
    return '';
  }
}
