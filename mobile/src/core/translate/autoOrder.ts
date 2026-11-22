import type { ProviderId, Settings } from '../types';

export const AUTO_FREE_PROVIDERS = [
  'microsoft',
  'google',
  'google2',
] as const;

export const AUTO_PAID_PROVIDERS = [
  'deepseek',
  'siliconflow',
  'openrouter',
  'openai',
] as const;

type AutoOrderSettings = Pick<
  Settings,
  'provider' | 'autoFallbackDeepSeek' | 'autoFreeOrder' | 'autoPaidOrder'
>;

function uniqueValid<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: readonly T[]
): T[] {
  const source = Array.isArray(value) ? value : fallback;
  const allowedSet = new Set<string>(allowed);
  const result: T[] = [];
  for (const item of source) {
    if (typeof item !== 'string' || !allowedSet.has(item)) continue;
    if (!result.includes(item as T)) result.push(item as T);
  }
  // The UI only reorders engines; it never removes one. Appending missing
  // providers also repairs old or malformed WebDAV payloads.
  for (const item of allowed) {
    if (!result.includes(item)) result.push(item);
  }
  return result;
}

export function normalizeAutoFreeOrder(value: unknown) {
  return uniqueValid(value, AUTO_FREE_PROVIDERS, AUTO_FREE_PROVIDERS);
}

export function normalizeAutoPaidOrder(value: unknown) {
  const result = uniqueValid(value, AUTO_PAID_PROVIDERS, AUTO_PAID_PROVIDERS);
  // Before OpenRouter existed, OpenAI was the last paid engine. Put the newly
  // added engine in the product order on the first migration instead of after
  // the old tail.
  if (Array.isArray(value) && !value.includes('openrouter')) {
    const routerIndex = result.indexOf('openrouter');
    const openaiIndex = result.indexOf('openai');
    if (openaiIndex >= 0 && routerIndex > openaiIndex) {
      result.splice(routerIndex, 1);
      result.splice(openaiIndex, 0, 'openrouter');
    }
  }
  return result;
}

/**
 * Auto mode checks every provider's cached cue list, not only engines in the
 * current chain. This makes a manual trial translation reusable later for free.
 */
export function autoCacheProviders(): ProviderId[] {
  return [
    'auto',
    'system',
    ...AUTO_FREE_PROVIDERS,
    ...AUTO_PAID_PROVIDERS,
  ];
}

function freeProvider(provider: ProviderId): boolean {
  return (
    provider === 'system' ||
    (AUTO_FREE_PROVIDERS as readonly string[]).includes(provider)
  );
}

/**
 * Manual free engines keep the old safety net: when they fail and paid fallback
 * is enabled, try the user's paid order. Paid engines never silently fall back
 * to another provider because the user explicitly chose a model.
 */
export function buildProviderChain(settings: AutoOrderSettings): ProviderId[] {
  const paid = settings.autoFallbackDeepSeek
    ? normalizeAutoPaidOrder(settings.autoPaidOrder)
    : [];

  if (settings.provider !== 'auto') {
    return freeProvider(settings.provider)
      ? [settings.provider, ...paid]
      : [settings.provider];
  }

  return [
    ...normalizeAutoFreeOrder(settings.autoFreeOrder),
    ...paid,
  ].filter((provider, index, list) => list.indexOf(provider) === index);
}
