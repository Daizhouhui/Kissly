import { httpText } from '../http';
import { chunk } from '../utils';

export type AiConfig = {
  id: string;
  url: string;
  key: string;
  model: string;
  timeoutMs: number;
  /** Provider-specific headers merged after the shared JSON/auth headers. */
  extraHeaders?: Record<string, string>;
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

function systemPrompt(to: string, contextTitle?: string): string {
  const language = LANG_NAMES[to] ?? to;
  return [
    'You are a professional subtitle translator.',
    `Translate every input line into ${language}.`,
    'Keep the original meaning, tone, names and numbers accurate.',
    'Do not merge, split, omit or add lines.',
    contextTitle ? `Video title for context: ${contextTitle}` : '',
    'Return ONLY a JSON array of strings, with exactly the same number of items and in the same order.',
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

function parseArray(content: string, expected: number): string[] | null {
  const cleaned = stripFence(content);
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        const values = parsed.map((item) => String(item ?? ''));
        if (values.length === expected) return values;
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
  if (lines.length === expected) return lines;
  return null;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}

function shouldRetryAiError(error: unknown): boolean {
  const status = statusOf(error);
  if (status === undefined) return true;
  return status === 408 || status === 429 || status >= 500;
}

async function chat(
  config: AiConfig,
  texts: string[],
  from: string,
  to: string,
  contextTitle?: string
): Promise<string[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await httpText(config.url, {
        method: 'POST',
        timeoutMs: config.timeoutMs,
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
      if (!parsed) throw new Error(`${config.id} 返回的条数不匹配`);
      lastError = null;
      return parsed;
    } catch (error) {
      lastError = error;
      if (!shouldRetryAiError(error) || attempt >= 1) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
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
    try {
      output.push(...(await chat(config, batch, from, to, contextTitle)));
    } catch (error) {
      const status = statusOf(error);
      if (!shouldRetryAiError(error) || status === 408 || status === 429) {
        throw error;
      }
      if (batch.length > 1) {
        // Fall back to smaller batches so one bad line cannot poison the block.
        for (const single of chunk(batch, 4)) {
          output.push(...(await chat(config, single, from, to, contextTitle)));
        }
      } else {
        throw error;
      }
    }
  }
  return output;
}

export function deepseekConfig(
  key: string,
  model: string,
  timeoutMs: number
): AiConfig {
  return {
    id: 'DeepSeek',
    url: 'https://api.deepseek.com/chat/completions',
    key,
    model: model || 'deepseek-chat',
    timeoutMs,
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
