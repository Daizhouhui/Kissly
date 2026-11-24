/** Shared feed loading budgets from docs/feed-loading-spec.md. */
export const CHANNEL_BATCH_SIZE = 20;

export const HOME_POOL_LIMIT = 2000;
export const HOME_FIRST_BATCH = 8;
export const HOME_CONCURRENCY = 8;
export const HOME_REQUEST_TIMEOUT_MS = 20_000;

/** The home pool stays usable for a week, but is refreshed after 30 minutes. */
export const FEED_FRESH_TTL = 30 * 60 * 1000;
export const FEED_STORE_TTL = 7 * 24 * 60 * 60 * 1000;

export const HOME_POOL_CACHE_KEY = 'feed:home-pool';
export const CHANNEL_FIRST_CACHE_PREFIX = 'channel:first:';
