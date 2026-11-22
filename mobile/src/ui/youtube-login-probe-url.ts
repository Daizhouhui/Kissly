const ALLOWED_HOSTS = [
  'youtube.com',
  'google.com',
  'gstatic.com',
  'googleusercontent.com',
  'ggpht.com',
  'youtube-nocookie.com',
];

function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  );
}

/**
 * The hidden login probe shares cookies with the player, so it must never
 * navigate to an arbitrary page that merely contains "youtube.com" in its
 * path or query string.
 */
export function isAllowedYoutubeProbeUrl(rawUrl: string): boolean {
  const value = String(rawUrl ?? '').trim();
  if (!value) return false;
  if (/^about:(?:blank|srcdoc)?$/i.test(value)) return true;
  const match = value.match(/^https:\/\/([^/?#]+)(?:[/?#]|$)/i);
  if (!match) return false;
  const host = match[1].replace(/:\d+$/, '').toLowerCase();
  return isAllowedHost(host);
}
