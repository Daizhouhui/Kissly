import type { OpenAiProfile, Settings } from '../types';

export const DEFAULT_OPENAI_PROFILE_ID = 'default';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function safeId(value: unknown, index: number): string {
  const raw =
    typeof value === 'string'
      ? value
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
      : '';
  return raw || `openai-profile-${index + 1}`;
}

function cleanProfile(
  value: unknown,
  index: number,
  fallbackBase: string,
  fallbackModel: string
): OpenAiProfile {
  const raw = value && typeof value === 'object'
    ? (value as Partial<OpenAiProfile>)
    : {};
  const baseUrl =
    typeof raw.baseUrl === 'string'
      ? raw.baseUrl.trim()
      : fallbackBase || DEFAULT_OPENAI_BASE_URL;
  const model =
    typeof raw.model === 'string'
      ? raw.model.trim()
      : fallbackModel || DEFAULT_OPENAI_MODEL;
  const name =
    typeof raw.name === 'string'
      ? raw.name.trim()
      : index === 0
        ? 'OpenAI 兼容'
        : `OpenAI 兼容 ${index + 1}`;
  return {
    id: safeId(raw.id, index),
    name,
    baseUrl,
    model,
  };
}

/**
 * Profiles are the source of truth. A missing or malformed list is rebuilt from
 * the legacy single profile, so settings written by older app versions still
 * open with a usable entry instead of an empty editor.
 */
export function normalizeOpenAiProfiles(
  value: unknown,
  fallbackBase: string,
  fallbackModel: string
): OpenAiProfile[] {
  const source = Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object')
    : [];
  const profiles = source.map((item, index) =>
    cleanProfile(item, index, fallbackBase, fallbackModel)
  );
  if (!profiles.length) {
    return [
      {
        id: DEFAULT_OPENAI_PROFILE_ID,
        name: 'OpenAI 兼容',
        baseUrl: fallbackBase || DEFAULT_OPENAI_BASE_URL,
        model: fallbackModel || DEFAULT_OPENAI_MODEL,
      },
    ];
  }

  const used = new Set<string>();
  for (const profile of profiles) {
    let id = profile.id;
    let suffix = 2;
    while (used.has(id)) {
      id = `${profile.id}-${suffix}`;
      suffix += 1;
    }
    profile.id = id;
    used.add(id);
  }
  return profiles;
}

export function normalizeOpenAiProfileId(
  value: unknown,
  profiles: OpenAiProfile[]
): string {
  if (
    typeof value === 'string' &&
    profiles.some((profile) => profile.id === value)
  ) {
    return value;
  }
  return profiles[0]?.id ?? DEFAULT_OPENAI_PROFILE_ID;
}

export function activeOpenAiProfile(
  settings: Pick<Settings, 'openaiProfiles' | 'openaiProfileId'>
): OpenAiProfile {
  return (
    settings.openaiProfiles.find(
      (profile) => profile.id === settings.openaiProfileId
    ) ??
    settings.openaiProfiles[0] ?? {
      id: DEFAULT_OPENAI_PROFILE_ID,
      name: 'OpenAI 兼容',
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      model: DEFAULT_OPENAI_MODEL,
    }
  );
}

export function newOpenAiProfile(index: number): OpenAiProfile {
  const stamp = Date.now().toString(36);
  return {
    id: `openai-${stamp}-${index}`,
    name: `OpenAI 兼容 ${index + 1}`,
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    model: DEFAULT_OPENAI_MODEL,
  };
}
