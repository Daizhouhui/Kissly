import { httpText } from '../http';

export type AiConfig = {
  id: string;
  url: string;
  key: string;
  model: string;
  timeoutMs: number;
  /** Provider-specific headers merged after the shared JSON/auth headers. */
  extraHeaders?: Record<string, string>;
  /** DeepSeek thinking toggle; omitted leaves the provider default untouched. */
  thinking?: 'enabled' | 'disabled';
};

const LANG_NAMES: Record<string, string> = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

const RETRY_DELAY_MS = 400;
/**
 * One subtitle batch may get this much extra time after its first request
 * times out. It lets us split the lines without recreating the old
 * 20s + 20s + split-batch wait.
 */
const SPLIT_GRACE_MS = 8000;
const MIN_SPLIT_BUDGET_MS = 1500;
/**
 * A model that merges or omits a line will often do the same for a smaller
 * batch. Three halvings are enough to reach 1–2 lines from a 12-line batch
 * without turning a persistent failure into dozens of requests.
 */
const MAX_COUNT_MISMATCH_DEPTH = 3;

function systemPrompt(to: string, contextTitle?: string): string {
  const language = LANG_NAMES[to] ?? to;
  return [
    'You are a professional subtitle translator.',
    `Translate every input line into ${language}.`,
    'Keep the original meaning, tone, names and numbers accurate.',
    'The input is a JSON array of subtitle strings. Treat each element as one independent subtitle line.',
    'Never merge adjacent lines, split one line into several entries, omit a line or add a line, even when the lines form a sentence together.',
    'If an input element is empty, keep an empty string at the same position in the output.',
    contextTitle ? `Video title for context: ${contextTitle}` : '',
    'Return ONLY a JSON array of strings, with exactly the same number of items and in the same order as the input array.',
    'No markdown, no explanations, no extra keys.',
  ]
    .filter(Boolean)
    .join(' ');
}

function stripFence(content: string): string {
  return content
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

type ParsedArray = {
  values: string[] | null;
  count: number;
};

function parseArray(content: string, expected: number): ParsedArray {
  const cleaned = stripFence(content);
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  let parsedCount = 0;
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        const values = parsed.map((item) => String(item ?? ''));
        parsedCount = values.length;
        if (values.length === expected) return { values, count: values.length };
      }
    } catch {}
  }
  const lines = cleaned
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:[-*]|\d+[.)])\s*/, '')
        .replace(/^["']|["'],?$/g, '')
        .trim()
    )
    .filter(Boolean);
  if (lines.length === expected) return { values: lines, count: lines.length };
  return { values: null, count: parsedCount || lines.length };
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}

function timeoutLike(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  if (name === 'AbortError' || name === 'HttpTimeoutError' || name === 'TimeoutError') {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /timeout|timed out|aborted|超时/i.test(message);
}

function timeoutError(id: string, detail = '翻译批次超时'): Error {
  const error = new Error(`${id} ${detail}`) as Error & { status?: number };
  error.name = 'TimeoutError';
  error.status = 408;
  return error;
}

function countMismatchError(id: string, expected: number, received: number): Error {
  const error = new Error(
    `${id} 返回的条数不匹配（期望 ${expected}，实际 ${received}）`
  );
  error.name = 'AiCountMismatchError';
  return error;
}

function countMismatchLike(error: unknown): boolean {
  return (error as { name?: unknown })?.name === 'AiCountMismatchError';
}

function shouldRetryAiError(error: unknown): boolean {
  // A timeout must be split immediately, never replayed unchanged. A count
  // mismatch is also deterministic: replaying the same 12 lines usually
  // reproduces the same merge/omission. 429 and other 4xx errors need the
  // caller/provider chain to decide what is next.
  if (timeoutLike(error) || countMismatchLike(error)) return false;
  const status = statusOf(error);
  if (status === undefined) return true;
  return status >= 500;
}

function shouldSplitAiError(error: unknown): boolean {
  if (timeoutLike(error) || countMismatchLike(error)) return true;
  const status = statusOf(error);
  if (status === undefined) return true;
  return status === 408 || status >= 500;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function chat(
  config: AiConfig,
  texts: string[],
  from: string,
  to: string,
  deadline: number,
  contextTitle?: string
): Promise<string[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_SPLIT_BUDGET_MS) {
      throw timeoutError(config.id);
    }
    try {
      const response = await httpText(config.url, {
        method: 'POST',
        timeoutMs: Math.max(1, Math.min(config.timeoutMs, remaining)),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.key}`,
          Accept: 'application/json',
          ...(config.extraHeaders ?? {}),
        },
        body: {
          model: config.model,
          temperature: 0.2,
          stream: false,
          ...(config.thinking ? { thinking: { type: config.thinking } } : {}),
          messages: [
            { role: 'system', content: systemPrompt(to, contextTitle) },
            {
              role: 'user',
              content: JSON.stringify(texts),
            },
          ],
        },
      });
      if (response.status < 200 || response.status >= 300) {
        const error = new Error(
          `${config.id} ${response.status}: ${response.text.slice(0, 160)}`
        ) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      const data = JSON.parse(response.text);
      const content =
        data?.choices?.[0]?.message?.content ??
        data?.output?.text ??
        data?.result ??
        '';
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error(`${config.id} 返回空内容`);
      }
      const parsed = parseArray(content, texts.length);
      if (!parsed.values) {
        throw countMismatchError(config.id, texts.length, parsed.count);
      }
      lastError = null;
      return parsed.values;
    } catch (error) {
      lastError = error;
      if (!shouldRetryAiError(error) || attempt >= 1) break;
      const pause = Math.min(
        RETRY_DELAY_MS * (attempt + 1),
        Math.max(0, deadline - Date.now() - MIN_SPLIT_BUDGET_MS)
      );
      await wait(pause);
    }
  }
  throw lastError;
}

function batches(texts: string[], maxChars = 1600, maxItems = 18): string[][] {
  const result: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const text of texts) {
    if (
      current.length >= maxItems ||
      (current.length && chars + text.length > maxChars)
    ) {
      result.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += text.length;
  }
  if (current.length) result.push(current);
  return result;
}

async function translateAiBatch(
  config: AiConfig,
  texts: string[],
  from: string,
  to: string,
  deadline: number,
  allowSplit: boolean,
  splitDepth = 0,
  contextTitle?: string
): Promise<string[]> {
  try {
    return await chat(config, texts, from, to, deadline, contextTitle);
  } catch (error) {
    const remaining = deadline - Date.now();
    if (
      !allowSplit ||
      texts.length <= 1 ||
      remaining < MIN_SPLIT_BUDGET_MS ||
      !shouldSplitAiError(error)
    ) {
      throw error;
    }
    // Timeouts and server errors split once. A count mismatch is allowed to
    // split again because the model may only respect the line count at a
    // smaller size; the depth cap keeps a broken model from fanning out.
    const canSplitAgain =
      countMismatchLike(error) && splitDepth < MAX_COUNT_MISMATCH_DEPTH;
    const splitAt = Math.ceil(texts.length / 2);
    const head = await translateAiBatch(
      config,
      texts.slice(0, splitAt),
      from,
      to,
      deadline,
      canSplitAgain,
      splitDepth + 1,
      contextTitle
    );
    const tail = await translateAiBatch(
      config,
      texts.slice(splitAt),
      from,
      to,
      deadline,
      canSplitAgain,
      splitDepth + 1,
      contextTitle
    );
    return [...head, ...tail];
  }
}

export async function aiTranslate(
  config: AiConfig,
  texts: string[],
  from: string,
  to: string,
  contextTitle?: string
): Promise<string[]> {
  if (!config.key) throw new Error(`${config.id} 没有填写 API Key`);
  const output: string[] = [];
  for (const batch of batches(texts)) {
    // Budget belongs to one logical AI batch, not to the whole video, so a
    // multi-chunk title request is not capped by a single global deadline.
    const deadline =
      Date.now() + Math.max(config.timeoutMs, 8000) + SPLIT_GRACE_MS;
    output.push(
      ...(await translateAiBatch(
        config,
        batch,
        from,
        to,
        deadline,
        true,
        0,
        contextTitle
      ))
    );
  }
  return output;
}

export function deepseekConfig(
  key: string,
  model: string,
  timeoutMs: number,
  thinking = false
): AiConfig {
  return {
    id: 'DeepSeek',
    url: 'https://api.deepseek.com/chat/completions',
    key,
    model: model || 'deepseek-flash',
    timeoutMs,
    // Always explicit: the DeepSeek API enables thinking by default with
    // effort=high, which is slow and expensive for subtitle batches.
    thinking: thinking ? 'enabled' : 'disabled',
  };
}

export function siliconflowConfig(
  key: string,
  model: string,
  timeoutMs: number
): AiConfig {
  return {
    id: 'SiliconFlow',
    url: 'https://api.siliconflow.cn/v1/chat/completions',
    key,
    model: model || 'Qwen/Qwen3.5-9B',
    timeoutMs,
  };
}

export function openaiConfig(
  key: string,
  baseUrl: string,
  model: string,
  timeoutMs: number
): AiConfig {
  const normalized = (baseUrl ?? '').trim().replace(/\/+$/, '');
  // Clearing the field falls back to the same defaults shown as placeholders;
  // otherwise the request becomes a relative "/chat/completions" URL.
  const base = normalized || 'https://api.openai.com/v1';
  return {
    id: 'OpenAI',
    url: base.endsWith('/chat/completions')
      ? base
      : `${base}/chat/completions`,
    key,
    model: model || 'gpt-4o-mini',
    timeoutMs,
  };
}

export function openrouterConfig(
  key: string,
  model: string,
  timeoutMs: number
): AiConfig {
  return {
    id: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    key,
    model: model || 'openai/gpt-4o-mini',
    timeoutMs,
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/Daizhouhui/Kissly',
      'X-Title': 'Kissly',
    },
  };
}

const ANALYSIS_PROMPT = [
  '你是一名英语老师，请用简体中文分析下面这句视频对话。',
  '请按以下结构输出，语言简洁、重点明确：',
  '1. 句子主干：指出主语、谓语、宾语（如果有）。',
  '2. 修饰成分：指出从句、介词短语、不定式、分词等分别修饰什么。',
  '3. 时态与语态：说明句子使用的时态、语态。',
  '4. 翻译要点：解释关键词、短语和容易误解的地方。',
  '5. 一句话总结这句话表达了什么。',
  '不要输出 Markdown 表格，不要重复原句和译文。',
].join('\n');

export async function aiAnalyzeSentence(
  config: AiConfig,
  sentence: string,
  translation: string,
  contextTitle?: string
): Promise<string> {
  if (!config.key) throw new Error(`${config.id} 没有填写 API Key`);
  const response = await httpText(config.url, {
    method: 'POST',
    timeoutMs: Math.max(20000, config.timeoutMs),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.key}`,
      Accept: 'application/json',
      ...(config.extraHeaders ?? {}),
    },
    body: {
      model: config.model,
      temperature: 0.35,
      stream: false,
      ...(config.thinking ? { thinking: { type: config.thinking } } : {}),
      messages: [
        { role: 'system', content: ANALYSIS_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            video: contextTitle ?? '',
            sentence,
            translation,
          }),
        },
      ],
    },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${config.id} ${response.status}: ${response.text.slice(0, 160)}`);
  }
  const data = JSON.parse(response.text);
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.output?.text ??
    data?.result ??
    '';
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`${config.id} 返回空内容`);
  }
  return stripFence(content);
}
