/**
 * The hidden login WebView is expensive (a full YouTube page on a 3-hour TTL)
 * and can burn 12 seconds on a cold start when the network cannot reach Google.
 * Only mount it while the "me" tab is actually visible.
 */
export function shouldProbeYoutubeLogin(pathname: string): boolean {
  const clean = (pathname || '').split('?')[0].replace(/\/+$/, '');
  return clean === '/me' || clean.endsWith('/me');
}
