import type { Subscription } from '../types';

const CHANNEL_ID_RE = /UC[\w-]{22}/;

/**
 * Google Takeout's subscriptions.csv has Channel ID / Channel URL / Channel
 * Title columns. The Channel URL is not a group: writing it into `group` made
 * every imported channel look like it belonged to its own URL-named group.
 */
function handleFromUrl(value: string | undefined): string | undefined {
  const url = String(value ?? '').trim();
  const match = url.match(/youtube\.com\/@([^/?#]+)/i);
  if (!match) return undefined;
  try {
    return `@${decodeURIComponent(match[1])}`;
  } catch {
    return `@${match[1]}`;
  }
}

function parseRows(content: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseTakeoutCsv(content: string): Subscription[] {
  const rows = parseRows(content);
  const headerIndex = rows.findIndex((line) =>
    line.some((cell) => /channel\s*id/i.test(cell))
  );
  const header = headerIndex >= 0 ? rows[headerIndex] : rows[0];
  const idIndex = header.findIndex((cell) => /channel\s*id/i.test(cell));
  const titleIndex = header.findIndex((cell) =>
    /(?:channel\s*title|^title$)/i.test(cell.trim())
  );
  const urlIndex = header.findIndex((cell) =>
    /(?:channel\s*url|^url$)/i.test(cell.trim())
  );
  const groupIndex = header.findIndex((cell) => /^(?:group|分组)$/i.test(cell.trim()));
  if (idIndex < 0) throw new Error('CSV 里没有找到 Channel ID 列');

  const subs = new Map<string, Subscription>();
  for (const line of rows.slice(headerIndex + 1)) {
    const rawId = (line[idIndex] ?? '').trim();
    const match = rawId.match(CHANNEL_ID_RE);
    if (!match) continue;
    const channelId = match[0];
    if (subs.has(channelId)) continue;
    const title =
      (titleIndex >= 0 ? line[titleIndex] : '')?.trim() || channelId;
    const url = urlIndex >= 0 ? line[urlIndex] : '';
    const group = groupIndex >= 0 ? line[groupIndex]?.trim() : '';
    subs.set(channelId, {
      channelId,
      title,
      handle: handleFromUrl(url),
      avatar: undefined,
      addedAt: Date.now(),
      ...(group ? { group } : {}),
    });
  }
  if (!subs.size) throw new Error('CSV 里没有可导入的频道');
  return Array.from(subs.values());
}
