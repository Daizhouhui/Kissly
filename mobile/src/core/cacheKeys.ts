/**
 * AsyncStorage cache families that are safe to delete together. User data
 * (settings, history, favorites, subscriptions) uses different keys and is
 * deliberately excluded.
 */
export const GLOBAL_CACHE_PREFIXES = [
  'captions:',
  'cues:',
  'feed:',
  'title-cache',
] as const;
