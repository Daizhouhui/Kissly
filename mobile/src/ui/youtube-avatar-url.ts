const AVATAR_HOSTS = [
  'yt3.ggpht.com',
  'yt3.googleusercontent.com',
  'yt3.youtube.com',
  'lh3.googleusercontent.com',
];

/**
 * YouTube account avatars come from yt3/ggpht/googleusercontent. Only accept
 * those over https so a compromised page cannot feed an arbitrary image URL
 * into the persistent store.
 */
export function normalizeYoutubeAvatarUrl(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const url = value.indexOf('//') === 0 ? `https:${value}` : value;
  const match = url.match(/^https:\/\/([^/?#]+)\//i);
  if (!match) return '';
  const host = match[1].replace(/:\d+$/, '').toLowerCase();
  if (!AVATAR_HOSTS.some((allowed) => host === allowed)) return '';
  return url;
}
