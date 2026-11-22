import AsyncStorage from '@react-native-async-storage/async-storage';

import { shouldPruneCacheEntry } from './cacheExpiry';

const NS = 'kissmobile:';

export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(NS + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    // Caching must never break the UI.
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(NS + key);
  } catch {}
}

export async function removeKeysByPrefix(prefix: string): Promise<void> {
  await removeKeysByPrefixes([prefix]);
}

/** Remove several cache families in one AsyncStorage pass. */
export async function removeKeysByPrefixes(prefixes: string[]): Promise<number> {
  if (!prefixes.length) return 0;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const targets = keys.filter((key) =>
      prefixes.some((prefix) => key.startsWith(NS + prefix))
    );
    if (targets.length) await AsyncStorage.multiRemove(targets);
    return targets.length;
  } catch {
    return 0;
  }
}

export type TimedValue<T> = { at: number; value: T };

export type LoadedCacheEntry<T> = { at: number; value: T };

export async function loadCachedEntry<T>(
  key: string,
  ttlMs: number
): Promise<LoadedCacheEntry<T> | null> {
  const entry = await loadJson<TimedValue<T> | null>(key, null);
  if (!entry || !entry.at) return null;
  if (Date.now() - entry.at > ttlMs) {
    // A stale entry will never be read again. Delete it so captions, feeds and
    // translations do not accumulate in AsyncStorage forever.
    void removeKey(key);
    return null;
  }
  return { at: entry.at, value: entry.value };
}

export async function loadCached<T>(
  key: string,
  ttlMs: number
): Promise<T | null> {
  const entry = await loadCachedEntry<T>(key, ttlMs);
  return entry?.value ?? null;
}

export async function saveCached<T>(key: string, value: T): Promise<void> {
  await saveJson(key, { at: Date.now(), value });
}

export type CachePruneRule = { prefix: string; ttlMs: number };

/**
 * One startup sweep deletes expired entries that may never be read again,
 * including caches written with an older key format.
 */
export async function pruneExpiredCaches(
  rules: CachePruneRule[]
): Promise<number> {
  if (!rules.length) return 0;
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const matches = allKeys.filter((key) =>
      rules.some((rule) => key.startsWith(NS + rule.prefix))
    );
    if (!matches.length) return 0;
    const entries = await AsyncStorage.multiGet(matches);
    const stale: string[] = [];
    for (const [key, raw] of entries) {
      if (!raw) continue;
      const rule = rules.find((item) => key.startsWith(NS + item.prefix));
      if (!rule) continue;
      if (shouldPruneCacheEntry(raw, rule.ttlMs)) stale.push(key);
    }
    if (stale.length) await AsyncStorage.multiRemove(stale);
    return stale.length;
  } catch {
    return 0;
  }
}
