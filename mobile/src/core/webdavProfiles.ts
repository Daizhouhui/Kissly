import {
  normalizeWebdavProfiles,
  type WebdavSavedProfile,
} from './webdavProfileModel';
import { loadJson, saveJson } from './storage';

const PROFILES_KEY = 'webdavProfiles:v1';

export {
  findMatchingWebdavProfile,
  newWebdavProfileId,
  normalizeWebdavProfiles,
  normalizeWebdavServerUrl,
  upsertWebdavProfile,
  type WebdavSavedProfile,
} from './webdavProfileModel';

export async function loadWebdavProfiles(): Promise<WebdavSavedProfile[]> {
  return normalizeWebdavProfiles(await loadJson<unknown>(PROFILES_KEY, []));
}

export async function saveWebdavProfiles(
  profiles: WebdavSavedProfile[]
): Promise<void> {
  await saveJson(PROFILES_KEY, normalizeWebdavProfiles(profiles));
}
