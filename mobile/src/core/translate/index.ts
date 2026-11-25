import { findCueIndexAt } from '../cueIndex';
import { getSecret } from '../secrets';
import { getSettings } from '../store';
import { loadCachedEntry, loadJson, saveCached, saveJson } from '../storage';
import { Cue, ProviderId } from '../types';
import { hashString } from '../utils';
import {
  autoCacheProviders,
  buildProviderChain,
} from './autoOrder';
import { aiTranslate, deepseekConfig, openaiConfig, openrouterConfig, siliconflowConfig } from './ai';
import { cueCacheKeyForProvider, titleCacheKey } from './cacheKey';
import { pickBestCueCache } from './cacheSelection';
import { getActiveOpenAiKey } from './credentials';
import { googleTranslate } from './google';
import { google2Translate } from './google2';
import { microsoftTranslate } from './microsoft';
import { cueBatchRanges, pickNextCueBatch } from './schedule';
import { systemTranslateTexts } from './system';

export type TranslateOptions = {
  from?: string;
  to?: string;
  contextTitle?: string;
  /** Lets a caller (for example a screen that was left) stop between batches. */
  shouldStop?: () => boolean;
  /** Bypass saved batches for an explicit "translate again" action. */
  ignoreCache?: boolean;
  /**
   * Initial playback position, in seconds. Callers that can supply a live
   * position should also set `getAnchorTime` so a seek can reprioritize the
   * batches that have not started yet.
   */
  anchorTime?: number;
  /** Read the current playback position for dynamic re-prioritization. */
  getAnchorTime?: () => number;
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
/**
 * Twelve lines still fit in one AI request after the 1600-character cap while
 * cutting the request count by a third compared with the old size of eight.
 */
const TRANSLATE_BATCH_SIZE = 12;
/**
 * Two requests in flight is the safe middle ground for DeepSeek RPM/TPM limits:
 * meaningful speedup without the 429 noise that three or more can cause.
 */
const TRANSLATE_CONCURRENCY = 2;
/** A delayed retry is allowed for one transient batch failure. */
const TRANSLATE_RETRY_DELAY_MS = 2000;

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

/** Drop the in-memory title cache after a global cache wipe. */
export function resetTranslationCacheMemory() {
  memoryTitles.clear();
  titleCache = {};
  titleCacheLoaded = false;
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
      deepseekConfig(
        key,
        settings.deepseekModel,
        timeoutMs,
        settings.deepseekThinking
      ),
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
  if (provider === 'openrouter') {
    const key = await getSecret('openrouter');
    const settings = getSettings();
    return aiTranslate(
      openrouterConfig(key, settings.openrouterModel, timeoutMs),
      texts,
      from,
      to,
      contextTitle
    );
  }
  if (provider === 'openai') {
    const settings = getSettings();
    const key = await getActiveOpenAiKey(settings);
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

  // Auto uses the user's free order, then the paid order when fallback is
  // enabled. Manual free engines keep the same paid safety net; manual paid
  // engines never switch to another provider behind the user's back.
  const tryList = buildProviderChain(settings);

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
      if (provider === 'openrouter') {
        const key = await getSecret('openrouter');
        if (!key) continue;
      }
      if (provider === 'openai') {
        const key = await getActiveOpenAiKey(getSettings());
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

function cueAnchorIndex(cues: Cue[], options: TranslateOptions): number {
  let liveTime: number | undefined;
  try {
    liveTime = options.getAnchorTime?.();
  } catch {
    liveTime = undefined;
  }
  const time =
    typeof liveTime === 'number' && Number.isFinite(liveTime)
      ? liveTime
      : options.anchorTime;
  if (typeof time !== 'number' || !Number.isFinite(time)) return -1;
  return findCueIndexAt(cues, time);
}

function timeoutLike(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  if (name === 'AbortError' || name === 'HttpTimeoutError' || name === 'TimeoutError') {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /timeout|timed out|aborted|超时/i.test(message);
}

function retryableBatchError(error: unknown): boolean {
  // The AI layer already splits a timed-out batch, so retrying the whole batch
  // here would double the worst-case wait. 429s and transient server errors are
  // worth one delayed retry after the other worker has made progress.
  if (timeoutLike(error)) return false;
  const status = (error as { status?: unknown })?.status;
  if (typeof status !== 'number') return true;
  return status === 429 || status >= 500;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function translateCueList(
  videoId: string,
  cues: Cue[],
  trackKey: string,
  options: TranslateOptions = {},
  onProgress?: CueTranslationProgress
): Promise<{ cues: Cue[]; provider: ProviderId }> {
  const settings = getSettings();
  const from = options.from ?? settings.sourceLang;
  const to = options.to ?? settings.targetLang;
  const autoMode = settings.provider === 'auto';
  const cacheProviders: ProviderId[] = autoMode
    ? autoCacheProviders()
    : [settings.provider];
  const cacheKeys = Array.from(
    new Set(
      cacheProviders.map((provider) =>
        cueCacheKeyForProvider(videoId, trackKey, from, to, settings, provider)
      )
    )
  );
  // Auto mode is free to reuse a translation made with any saved OpenAI
  // profile, even when another profile is currently selected.
  if (autoMode) {
    for (const profile of settings.openaiProfiles) {
      cacheKeys.push(
        cueCacheKeyForProvider(
          videoId,
          trackKey,
          from,
          to,
          {
            ...settings,
            openaiBaseUrl: profile.baseUrl,
            openaiModel: profile.model,
          },
          'openai'
        )
      );
    }
  }
  const uniqueCacheKeys = Array.from(new Set(cacheKeys));

  // Auto mode can reuse a complete translation produced earlier by any engine,
  // even one the user no longer has in the current order. Manual mode stays
  // scoped to the engine the user picked.
  const cacheEntries = options.ignoreCache
    ? []
    : await Promise.all(
        uniqueCacheKeys.map((key) =>
          loadCachedEntry<{ cues: Cue[]; provider: ProviderId }>(
            key,
            CUE_CACHE_TTL_MS
          )
        )
      );
  const cached = pickBestCueCache(cues, cacheEntries);

  const translations = cached?.translations ?? cues.map(() => '');
  let provider: ProviderId | null = cached?.provider ?? null;

  const build = (values: string[]): Cue[] =>
    cues.map((cue, index) => ({
      ...cue,
      translation: values[index] ?? '',
    }));
  // Empty caption lines do not need a provider request. Asking a model to
  // translate "" is one of the easiest ways to make it return fewer items than
  // requested and trigger a false "条数不匹配".
  const sourceNeedsTranslation = (index: number) =>
    Boolean(cues[index]?.text?.trim());

  if (
    cues.every(
      (_, index) =>
        !sourceNeedsTranslation(index) || Boolean(translations[index])
    )
  ) {
    const complete = build(translations);
    const completeProvider = provider ?? settings.provider;
    onProgress?.(complete, completeProvider);
    return { cues: complete, provider: completeProvider };
  }

  const saveCueCache = async (
    values: string[],
    actualProvider: ProviderId
  ) => {
    const payload = { cues: build(values), provider: actualProvider };
    const targets = autoMode
      ? [
          cueCacheKeyForProvider(
            videoId,
            trackKey,
            from,
            to,
            settings,
            'auto'
          ),
          cueCacheKeyForProvider(
            videoId,
            trackKey,
            from,
            to,
            settings,
            actualProvider
          ),
        ]
      : [
          cueCacheKeyForProvider(
            videoId,
            trackKey,
            from,
            to,
            settings,
            actualProvider
          ),
        ];
    await Promise.all(
      Array.from(new Set(targets)).map((key) => saveCached(key, payload))
    );
  };

  if (provider) {
    // A partially cached translation should be visible before the first
    // network batch returns, instead of showing 0/N until then.
    onProgress?.(build(translations), provider);
  }

  const ranges = cueBatchRanges(cues.length, TRANSLATE_BATCH_SIZE);
  const completedBatches = new Set<number>();
  ranges.forEach((range, index) => {
    let complete = true;
    for (let cueIndex = range.start; cueIndex < range.end; cueIndex += 1) {
      if (sourceNeedsTranslation(cueIndex) && !translations[cueIndex]) {
        complete = false;
        break;
      }
    }
    if (complete) completedBatches.add(index);
  });
  const activeBatches = new Set<number>();
  /**
   * A provider can return an array of the right length with an empty string for
   * one line. Without this guard the worker would see that cue as still missing
   * and re-request the same batch forever.
   */
  const attemptedBatches = new Set<number>();

  // Cache writes are serialized: concurrent batches finish out of order, and
  // every write replaces the whole video snapshot. Without this queue an older
  // snapshot could land after a newer one and erase freshly translated lines.
  let cacheWrite: Promise<void> = Promise.resolve();
  const queueCacheSave = (actualProvider: ProviderId) => {
    const snapshot = translations.slice();
    cacheWrite = cacheWrite
      .catch(() => {})
      .then(() => saveCueCache(snapshot, actualProvider))
      .catch(() => {
        // A cache write failure must not throw away subtitles already shown.
      });
    return cacheWrite;
  };

  const translateBatch = async (batchIndex: number) => {
    const range = ranges[batchIndex];
    const missing: number[] = [];
    for (let cueIndex = range.start; cueIndex < range.end; cueIndex += 1) {
      if (sourceNeedsTranslation(cueIndex) && !translations[cueIndex]) {
        missing.push(cueIndex);
      }
    }
    if (!missing.length) {
      completedBatches.add(batchIndex);
      attemptedBatches.add(batchIndex);
      return;
    }

    const result = await translateTexts(
      missing.map((cueIndex) => cues[cueIndex].text),
      options
    );
    if (options.shouldStop?.()) return;

    // Results are always merged by the original cue index, never by request
    // order, so re-prioritized batches cannot scramble the subtitle list.
    missing.forEach((cueIndex, offset) => {
      translations[cueIndex] = result.texts[offset] ?? '';
    });
    provider = result.provider;

    let covered = true;
    for (let cueIndex = range.start; cueIndex < range.end; cueIndex += 1) {
      if (sourceNeedsTranslation(cueIndex) && !translations[cueIndex]) {
        covered = false;
        break;
      }
    }
    if (covered) completedBatches.add(batchIndex);
    attemptedBatches.add(batchIndex);

    onProgress?.(build(translations), result.provider);
    void queueCacheSave(result.provider);
  };

  let failedError: unknown = null;
  let retryBudget = 1;
  const worker = async () => {
    while (!failedError && !options.shouldStop?.()) {
      // Re-read the playback position before each pick. A seek therefore
      // reprioritizes every batch that has not started yet; in-flight requests
      // are left alone, which wastes at most TRANSLATE_CONCURRENCY batches.
      const batchIndex = pickNextCueBatch(
        ranges,
        cueAnchorIndex(cues, options),
        (index) =>
          !completedBatches.has(index) &&
          !attemptedBatches.has(index) &&
          !activeBatches.has(index)
      );
      if (batchIndex < 0) return;

      activeBatches.add(batchIndex);
      try {
        await translateBatch(batchIndex);
      } catch (error) {
        if (
          retryBudget > 0 &&
          retryableBatchError(error) &&
          !options.shouldStop?.()
        ) {
          retryBudget -= 1;
          await wait(TRANSLATE_RETRY_DELAY_MS);
          continue;
        }
        failedError ??= error;
      } finally {
        activeBatches.delete(batchIndex);
      }
    }
  };

  await Promise.all(
    Array.from({ length: TRANSLATE_CONCURRENCY }, () => worker())
  );
  await cacheWrite;

  if (failedError && !options.shouldStop?.()) throw failedError;

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
    case 'openrouter':
      return 'OpenRouter';
    case 'openai':
      return 'OpenAI 兼容';
    default:
      return '自动';
  }
}
