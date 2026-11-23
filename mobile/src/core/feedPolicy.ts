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
