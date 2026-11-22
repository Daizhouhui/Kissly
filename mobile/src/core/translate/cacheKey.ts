import type { ProviderId } from '../types';

type CacheSettings = {
  provider: ProviderId;
  deepseekModel?: string;
  siliconflowModel?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
};

function normalized(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/**
 * The provider name alone is not enough for AI engines: the same provider can
 * point at a different model or a different OpenAI-compatible endpoint. Mixing
 * those into one cache key serves month-old translations from the old model.
 */
export function providerCacheScope(settings: CacheSettings): string {
  switch (settings.provider) {
    case 'deepseek':
      return `deepseek:${normalized(settings.deepseekModel)}`;
    case 'siliconflow':
      return `siliconflow:${normalized(settings.siliconflowModel)}`;
    case 'openai':
      return `openai:${normalized(settings.openaiBaseUrl)}:${normalized(
        settings.openaiModel
      )}`;
    default:
      return settings.provider;
  }
}

export function cueCacheKey(
  videoId: string,
  trackKey: string,
  target: string,
  settings: CacheSettings
): string {
  return `cues:v3:${videoId}:${trackKey}:${target}:${providerCacheScope(settings)}`;
}

export function titleCacheKey(
  textHash: string,
  target: string,
  settings: CacheSettings
): string {
  return `${providerCacheScope(settings)}|${target}|${textHash}`;
}
