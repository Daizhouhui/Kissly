export type WebdavSavedProfile = {
  id: string;
  name: string;
  providerId: string;
  url: string;
  username: string;
  folder: string;
  updatedAt: number;
};

type ProfileConfig = Pick<WebdavSavedProfile, 'url' | 'username' | 'folder'>;

function cleanText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback;
}

export function normalizeWebdavServerUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function normalizeFolder(value: unknown) {
  return cleanText(value, 'Kissly').replace(/^\/+|\/+$/g, '') || 'Kissly';
}

export function normalizeWebdavProfiles(value: unknown): WebdavSavedProfile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Partial<WebdavSavedProfile>;
    const id = cleanText(raw.id);
    const url = cleanText(raw.url);
    if (!id || !url || seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        name: cleanText(raw.name, 'WebDAV'),
        providerId: cleanText(raw.providerId),
        url,
        username: cleanText(raw.username),
        folder: normalizeFolder(raw.folder),
        updatedAt: Number.isFinite(Number(raw.updatedAt))
          ? Number(raw.updatedAt)
          : 0,
      },
    ];
  });
}

export function findMatchingWebdavProfile(
  profiles: WebdavSavedProfile[],
  config: ProfileConfig
) {
  const url = normalizeWebdavServerUrl(config.url);
  const username = config.username.trim().toLowerCase();
  const folder = normalizeFolder(config.folder);
  return profiles.find(
    (profile) =>
      normalizeWebdavServerUrl(profile.url) === url &&
      profile.username.trim().toLowerCase() === username &&
      profile.folder === folder
  );
}

export function upsertWebdavProfile(
  profiles: WebdavSavedProfile[],
  profile: WebdavSavedProfile
) {
  const index = profiles.findIndex((item) => item.id === profile.id);
  if (index < 0) return [...profiles, profile];
  const next = [...profiles];
  next[index] = profile;
  return next;
}

export function newWebdavProfileId() {
  return `webdav-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}
