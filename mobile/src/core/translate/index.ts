import { getSecret } from '../secrets';
import { getSettings } from '../store';
import { loadCached, loadJson, saveCached, saveJson } from '../storage';
import { Cue, ProviderId } from '../types';
import { hashString } from '../utils';
import { aiTranslate, deepseekConfig, openaiConfig, siliconflowConfig } from './ai';
import { cueCacheKey, titleCacheKey } from './cacheKey';
import { googleTranslate } from './google';
import { google2Translate } from './google2';
import { microsoftTranslate } from './microsoft';
import { systemTranslateTexts } from './system';

export type TranslateOptions = {
  from?: string;
  to?: string;
  contextTitle?: string;
  /** Lets a caller (for example a screen that was left) stop between batches. */
  shouldStop?: () => boolean;
  /** Bypass saved batches for an explicit "translate again" action. */
  ignoreCache?: boolean;
};

export type CueTranslationProgress = (
  cues: Cue[],
  provider: ProviderId
) => void;

/**
 * Translations are kept much longer than source captions in practice: users
 * reopen long videos repeatedly, and re-calling a provider for every open is
 * both slow and rate-limit prone.
 */
const CUE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Small enough that the first visible lines arrive quickly, large enough to
 * avoid one provider request per line. */
const TRANSLATE_BATCH_SIZE = 8;

const memoryTitles = new Map<string, string>();
let titleCacheLoaded = false;
let titleCache: Record<string, string> = {};
/** Keep the permanent title cache bounded so AsyncStorage does not grow forever. */
const TITLE_CACHE_LIMIT = 3000;

async function ensureTitleCache() {
  if (titleCacheLoaded) return;
  titleCacheLoaded = true;
  titleCache = await loadJson<Record<string, string>>('title-cache', {});
}

function trimTitleCache() {
  const keys = Object.keys(titleCache);
  if (keys.length <= TITLE_CACHE_LIMIT) return;
  for (const key of keys.slice(0, keys.length - TITLE_CACHE_LIMIT)) {
    delete titleCache[key];
  }
  const memoryKeys = Array.from(memoryTitles.keys());
  for (const key of memoryKeys.slice(0, Math.max(0, memoryKeys.length - TITLE_CACHE_LIMIT))) {
    memoryTitles.delete(key);
  }
}

async function translateWithProvider(
  provider: ProviderId,
  texts: string[],
  from: string,
  to: string,
  contextTitle: string | undefined,
  timeoutMs: number
): Promise<string[]> {
  if (provider === 'system') {
    return systemTranslateTexts(texts, from, to, timeoutMs);
  }
  if (provider === 'microsoft') {
    return microsoftTranslate(texts, from, to, timeoutMs);
  }
  if (provider === 'google') {
    return googleTranslate(texts, from, to, timeoutMs);
  }
  if (provider === 'google2') {
    return google2Translate(texts, from, to, timeoutMs);
  }
  if (provider === 'deepseek') {
    const key = await getSecret('deepseek');
    const settings = getSettings();
    return aiTranslate(
      deepseekConfig(key, settings.deepseekModel, timeoutMs),
      texts,
      from,
      to,
      contextTitle
    );
  }
  if (provider === 'siliconflow') {
    const key = await getSecret('siliconflow');
    const settings = getSettings();
    return aiTranslate(
      siliconflowConfig(key, settings.siliconflowModel, timeoutMs),
      texts,
      from,
      to,
      contextTitle
    );
  }
  if (provider === 'openai') {
    const key = await getSecret('openai');
    const settings = getSettings();
    return aiTranslate(
      openaiConfig(
        key,
        settings.openaiBaseUrl,
        settings.openaiModel,
        timeoutMs
      ),
      texts,
      from,
      to,
      contextTitle
    );
  }
  throw new Error(`未知翻译引擎 ${provider}`);
}

export async function translateTexts(
  texts: string[],
  options: TranslateOptions = {}
): Promise<{ texts: string[]; provider: ProviderId }> {
  const settings = getSettings();
  const from = options.from ?? settings.sourceLang;
  const to = options.to ?? settings.targetLang;
  const timeout = settings.requestTimeoutMs;
  const requested = settings.provider;

  const chain: ProviderId[] =
    requested === 'auto'
      ? // Auto stays on free providers in a predictable order. Google2 is the
        // last-resort built-in preset; DeepSeek is appended separately when enabled.
        ['microsoft', 'google', 'google2']
      : [requested];

  if (
    requested !== 'auto' &&
    !chain.includes('deepseek') &&
    !(requested === 'deepseek')
  ) {
    // Explicit free provider still gets the deepseek net when enabled.
  }

  const tryList = [...chain];
  if (settings.autoFallbackDeepSeek && !tryList.includes('deepseek')) {
    tryList.push('deepseek');
  }
  if (requested === 'deepseek' && !tryList.includes('deepseek')) {
    tryList.unshift('deepseek');
  }

  let lastError: unknown = null;
  for (const provider of tryList) {
    try {
      if (provider === 'deepseek') {
        const key = await getSecret('deepseek');
        if (!key) continue;
      }
      if (provider === 'siliconflow') {
        const key = await getSecret('siliconflow');
        if (!key) continue;
      }
      if (provider === 'openai') {
        const key = await getSecret('openai');
        if (!key) continue;
      }
      const translated = await translateWithProvider(
        provider,
        texts,
        from,
        to,
        options.contextTitle,
        timeout
      );
      return { texts: translated, provider };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('所有翻译引擎都不可用');
}

export async function translateOne(
  text: string,
  options: TranslateOptions = {}
): Promise<string> {
  const result = await translateTexts([text], options);
  return result.texts[0] ?? text;
}

export async function translateCueList(
  videoId: string,
  cues: Cue[],
  trackKey: string,
  options: TranslateOptions = {},
  onProgress?: CueTranslationProgress
): Promise<{ cues: Cue[]; provider: ProviderId }> {
  const settings = getSettings();
  const to = options.to ?? settings.targetLang;
  const cacheKey = cueCacheKey(videoId, trackKey, to, settings);
  const cached = options.ignoreCache
    ? null
    : await loadCached<{ cues: Cue[]; provider: ProviderId }>(
        cacheKey,
        CUE_CACHE_TTL_MS
      );

  // A cached list may be partial: batches saved before the user closed the
  // player. Reuse every line that still matches this exact cue.
  const translations = cues.map(() => '');
  let provider: ProviderId | null = null;
  if (
    cached?.cues?.length === cues.length &&
    cached.cues.every(
      (cue, index) =>
        Math.abs(cue.start - cues[index].start) < 0.002 &&
        Math.abs(cue.end - cues[index].end) < 0.002 &&
        cue.text === cues[index].text
    )
  ) {
    provider = cached.provider;
    cached.cues.forEach((cue, index) => {
      if (cue.translation) translations[index] = cue.translation;
    });
  }

  const build = (values: string[]): Cue[] =>
    cues.map((cue, index) => ({
      ...cue,
      translation: values[index] ?? '',
    }));

  if (provider && translations.every(Boolean)) {
    const complete = build(translations);
    onProgress?.(complete, provider);
    return { cues: complete, provider };
  }

  for (let start = 0; start < cues.length; start += TRANSLATE_BATCH_SIZE) {
    if (options.shouldStop?.()) {
      return {
        cues: build(translations),
        provider: provider ?? settings.provider,
      };
    }
    const end = Math.min(cues.length, start + TRANSLATE_BATCH_SIZE);
    const missing: number[] = [];
    for (let index = start; index < end; index += 1) {
      if (!translations[index]) missing.push(index);
    }
    if (!missing.length) continue;

    const result = await translateTexts(
      missing.map((index) => cues[index].text),
      options
    );
    if (options.shouldStop?.()) {
      return {
        cues: build(translations),
        provider: provider ?? result.provider,
      };
    }
    missing.forEach((index, offset) => {
      translations[index] = result.texts[offset] ?? '';
    });
    provider = result.provider;

    const partial = build(translations);
    await saveCached(cacheKey, { cues: partial, provider: result.provider });
    onProgress?.(partial, result.provider);
  }

  const complete = build(translations);
  const finalProvider = provider ?? settings.provider;
  onProgress?.(complete, finalProvider);
  return { cues: complete, provider: finalProvider };
}

export async function translateTitles(
  titles: string[],
  options: TranslateOptions = {}
): Promise<string[]> {
  await ensureTitleCache();
  const settings = getSettings();
  const to = options.to ?? settings.targetLang;
  const missing: { index: number; text: string; key: string }[] = [];
  const output = new Array<string>(titles.length);

  titles.forEach((text, index) => {
    const key = titleCacheKey(hashString(text), to, settings);
    const hit = memoryTitles.get(key) ?? titleCache[key];
    if (hit) output[index] = hit;
    else missing.push({ index, text, key });
  });

  if (!missing.length) return output;

  const result = await translateTexts(
    missing.map((item) => item.text),
    options
  );
  missing.forEach((item, index) => {
    const translated = result.texts[index] ?? item.text;
    output[item.index] = translated;
    memoryTitles.set(item.key, translated);
    titleCache[item.key] = translated;
  });
  trimTitleCache();
  await saveJson('title-cache', titleCache);
  return output;
}

export async function testTranslation(provider: ProviderId): Promise<string> {
  const settings = getSettings();
  const texts = await translateWithProvider(
    provider,
    ['Hello, this is a subtitle translation test.'],
    'en',
    settings.targetLang,
    undefined,
    settings.requestTimeoutMs
  );
  return texts[0] ?? '';
}

export function providerDisplayName(provider: ProviderId): string {
  switch (provider) {
    case 'microsoft':
      return '微软翻译';
    case 'system':
      return '系统内置';
    case 'google':
      return '谷歌翻译';
    case 'google2':
      return 'Google 备用';
    case 'deepseek':
      return 'DeepSeek';
    case 'siliconflow':
      return 'SiliconFlow';
    case 'openai':
      return 'OpenAI';
    default:
      return '自动';
  }
}
