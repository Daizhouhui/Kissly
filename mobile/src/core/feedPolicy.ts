export type FeedPaginationProgress = {
  attempts: number;
  failures: number;
  grew: boolean;
  anyLive: boolean;
};

export function shouldTranslateTitles(settings: {
  translateTitles: boolean;
  titleTranslationMode: string;
}): boolean {
  return settings.translateTitles && settings.titleTranslationMode !== 'none';
}

/** A channel is exhausted only when innertube answered without a next page.
 * RSS is a timeout fallback, so it must stay retryable. */
export function isChannelExhausted(
  source: string | undefined,
  continuation?: string
): boolean {
  return source === 'rss' ? false : !continuation;
}

/** Whether the home feed can still reveal another page. A full pool must not
 * hide its own unshown items just because it reached the cache cap. */
export function hasMoreFeed({
  visibleCount,
  poolLength,
  poolLimit,
  hasLiveChannel,
}: {
  visibleCount: number;
  poolLength: number;
  poolLimit: number;
  hasLiveChannel: boolean;
}): boolean {
  if (visibleCount < poolLength) return true;
  if (poolLength >= poolLimit) return false;
  return hasLiveChannel;
}

/** Stop automatic "fill the screen" pagination when another request cannot
 * make progress. A manual refresh starts a new pagination cycle. */
export function shouldStopAutoPagination({
  attempts,
  failures,
  grew,
  anyLive,
}: FeedPaginationProgress): boolean {
  if (!anyLive) return true;
  return !grew && attempts > 0 && failures > 0;
}
