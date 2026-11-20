import { googleTarget } from '../defaults';
import { httpText } from '../http';
import { mapLimit } from '../utils';

// Google2 is the translate-pa endpoint used by the upstream Kiss Translator
// preset. The key is a bundled public preset, not a personal Google account
// credential. It can be rate-limited or revoked, so it is only a fallback.
const GOOGLE2_URL = 'https://translate-pa.googleapis.com/v1/translateHtml';
const GOOGLE2_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520';

function encodeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

async function translateBatch(
  texts: string[],
  from: string,
  to: string,
  timeoutMs: number
): Promise<string[]> {
  const body = JSON.stringify([
    [texts.map(encodeText), from === 'auto' ? 'auto' : from, googleTarget(to)],
    'wt_lib',
  ]);
  const response = await httpText(GOOGLE2_URL, {
    method: 'POST',
    body,
    timeoutMs,
    headers: {
      'Content-Type': 'application/json+protobuf',
      'X-Goog-API-Key': GOOGLE2_KEY,
      Accept: '*/*',
    },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Google2 ${response.status}`);
  }
  let data: any;
  try {
    data = JSON.parse(response.text);
  } catch {
    throw new Error('Google2 返回格式异常');
  }
  const translated = Array.isArray(data?.[0]) ? data[0] : [];
  if (translated.length < texts.length) {
    throw new Error('Google2 返回条数不完整');
  }
  return texts.map((_, index) => decodeText(String(translated[index] ?? '')));
}

export async function google2Translate(
  texts: string[],
  from: string,
  to: string,
  timeoutMs: number
): Promise<string[]> {
  if (!texts.length) return [];
  // The endpoint accepts a batch; keep batches moderate so a retry never
  // resends an enormous caption payload.
  const batches: string[][] = [];
  for (let index = 0; index < texts.length; index += 12) {
    batches.push(texts.slice(index, index + 12));
  }
  const results = await mapLimit(batches, 2, (batch) =>
    translateBatch(batch, from, to, timeoutMs)
  );
  return results.flat();
}
