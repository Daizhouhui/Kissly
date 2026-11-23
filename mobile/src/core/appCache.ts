import { GLOBAL_CACHE_PREFIXES } from './cacheKeys';
import { removeKeysByPrefixes } from './storage';
import { resetTranslationCacheMemory } from './translate';
import { clearChannelVideoCache } from './youtube/channelVideos';
import { clearFeedMemoryCache } from './youtube/rss';

/**
 * Delete only disposable caches. Settings, history, favorites, subscriptions,
 * WebDAV credentials and API keys are intentionally untouched.
 */
export async function clearGlobalCaches(): Promise<number> {
  const removed = await removeKeysByPrefixes([...GLOBAL_CACHE_PREFIXES]);
  resetTranslationCacheMemory();
  clearChannelVideoCache();
  clearFeedMemoryCache();
  return removed;
}
