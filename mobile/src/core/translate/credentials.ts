import { getSecret, openaiProfileSecretName } from '../secrets';
import type { Settings } from '../types';
import {
  DEFAULT_OPENAI_PROFILE_ID,
  activeOpenAiProfile,
} from './openaiProfiles';

/**
 * Read the key for the active OpenAI-compatible profile. The legacy `openai`
 * secret is only a one-time fallback for installs that predate profiles.
 */
export async function getActiveOpenAiKey(settings: Settings): Promise<string> {
  const profile = activeOpenAiProfile(settings);
  return getOpenAiProfileKey(profile.id, true);
}

export async function getOpenAiProfileKey(
  id: string,
  fallbackToLegacy = false
): Promise<string> {
  const key = await getSecret(openaiProfileSecretName(id));
  if (key) return key;
  if (fallbackToLegacy && id === DEFAULT_OPENAI_PROFILE_ID) {
    return getSecret('openai');
  }
  return '';
}
