export type ChannelInfo = {
  handle?: string;
  subscriberCount?: number;
  videoCount?: number;
  description?: string;
};

function textOf(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.content === 'string') return value.content;
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value.runs)) {
    return value.runs.map((run: any) => run?.text ?? '').join('');
  }
  return '';
}

/** "2.69M subscribers" / "6.1K videos" / "1.2万位订阅者" -> number. */
export function parseCountLabel(value: string): number | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  if (/(no|0)\s+(video|subscriber)|暂无|没有/i.test(text)) return 0;
  const normalized = text.replace(/,/g, '');
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(万|亿|千|[KMB])?/i);
  if (!match) return undefined;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return undefined;
  const suffix = String(match[2] ?? '').toUpperCase();
  if (suffix === '万') return Math.round(number * 10000);
  if (suffix === '亿') return Math.round(number * 100000000);
  if (suffix === '千') return Math.round(number * 1000);
  if (suffix === 'K') return Math.round(number * 1000);
  if (suffix === 'M') return Math.round(number * 1000000);
  if (suffix === 'B') return Math.round(number * 1000000000);
  return Math.round(number);
}

export function parseChannelInfo(data: any): ChannelInfo | undefined {
  const viewModel = data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;
  if (!viewModel) return undefined;

  const rows =
    viewModel.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  const parts = rows.flatMap((row: any) => row?.metadataParts ?? []);
  let handle: string | undefined;
  let subscriberCount: number | undefined;
  let videoCount: number | undefined;

  for (const part of parts) {
    const text = textOf(part?.text);
    if (!text) continue;
    if (!handle && /^@\S+/.test(text)) handle = text;
    if (subscriberCount === undefined && /(subscriber|订阅|关注)/i.test(text)) {
      subscriberCount = parseCountLabel(text);
    }
    if (videoCount === undefined && /(video|视频|影片)/i.test(text)) {
      videoCount = parseCountLabel(text);
    }
  }

  const description =
    textOf(viewModel.description?.descriptionPreviewViewModel?.description) ||
    undefined;

  if (
    handle === undefined &&
    subscriberCount === undefined &&
    videoCount === undefined &&
    description === undefined
  ) {
    return undefined;
  }
  return { handle, subscriberCount, videoCount, description };
}
