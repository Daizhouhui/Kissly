import type { ProviderId } from '../types';

type CacheSettings = {
  provider: ProviderId;
  deepseekModel?: string;
  /** Only a `true` value gets its own cache namespace; see providerCacheScope. */
  deepseekThinking?: boolean;
  siliconflowModel?: string;
  openrouterModel?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  autoFreeOrder?: ProviderId[];
  autoPaidOrder?: ProviderId[];
};

function normalized(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/**
 * The provider name alone is not enough for AI engines: the same provider can
 * point at a different model or a different OpenAI-compatible endpoint. Mixing
 * those into one cache key serves month-old translations from the old model.
 *
 * DeepSeek thinking is opt-in. Its disabled key stays byte-identical to the
 * pre-toggle format so turning the switch off never invalidates the cache the
 * user already paid for; turning it on moves the request to a separate
 * namespace, because those translations were produced by a different request.
 */
export function providerCacheScope(
  settings: CacheSettings,
  provider: ProviderId = settings.provider
): string {
  if (provider === 'auto') {
    const scope: Record<string, unknown> = {
      d: normalized(settings.deepseekModel),
      s: normalized(settings.siliconflowModel),
      r: normalized(settings.openrouterModel),
      b: normalized(settings.openaiBaseUrl).replace(/\/+$/, ''),
      m: normalized(settings.openaiModel),
      f: settings.autoFreeOrder ?? [],
      p: settings.autoPaidOrder ?? [],
    };
    if (settings.deepseekThinking) scope.t = true;
    return `auto:${JSON.stringify(scope)}`;
  }
  switch (provider) {
    case 'deepseek':
      return `deepseek:${normalized(settings.deepseekModel)}${
        settings.deepseekThinking ? ':thinking' : ''
      }`;
    case 'siliconflow':
      return `siliconflow:${normalized(settings.siliconflowModel)}`;
    case 'openrouter':
      return `openrouter:${normalized(settings.openrouterModel)}`;
    case 'openai':
      return `openai:${normalized(settings.openaiBaseUrl)}:${normalized(
        settings.openaiModel
      )}`;
    default:
      return provider;
  }
}

export function cueCacheKeyForProvider(
  videoId: string,
  trackKey: string,
  source: string,
  target: string,
  settings: CacheSettings,
  provider: ProviderId
): string {
  return `cues:v4:${videoId}:${trackKey}:${source}:${target}:${providerCacheScope(
    settings,
    provider
  )}`;
}

export function cueCacheKey(
  videoId: string,
  trackKey: string,
  source: string,
  target: string,
  settings: CacheSettings
): string {
  // Source language is part of the contract: switching from "auto" to a
  // concrete language (or the other way around) must not reuse the old
  // provider's translation of the same track.
  return cueCacheKeyForProvider(
    videoId,
    trackKey,
    source,
    target,
    settings,
    settings.provider
  );
}

export function titleCacheKey(
  textHash: string,
  target: string,
  settings: CacheSettings
): string {
  return `${providerCacheScope(settings)}|${target}|${textHash}`;
}
