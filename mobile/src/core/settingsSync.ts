import type { Settings } from './types';

/**
 * Settings that travel through WebDAV. `webdav` holds credentials, `theme` and
 * `themeAccent` are device-local looks, so none of them ever leave the device.
 */
export const SYNCED_SETTING_KEYS = [
  'sourceLang',
  'targetLang',
  'learningLang',
  'interfaceLang',
  'provider',
  'autoFallbackDeepSeek',
  'translateTitles',
  'titleTranslationMode',
  'defaultTab',
  'discoverLayout',
  'keepAwake',
  'speechRate',
  'speechPitch',
  'designVersion',
  'subtitle',
  'deepseekModel',
  'siliconflowModel',
  'openaiBaseUrl',
  'openaiModel',
  'requestTimeoutMs',
] as const;

export type SyncedSettingKey = (typeof SYNCED_SETTING_KEYS)[number];

export type SettingsStamps = Partial<Record<SyncedSettingKey, number>>;

export type SyncSettings = Pick<Settings, SyncedSettingKey>;

export function isSyncedSettingKey(key: string): key is SyncedSettingKey {
  return (SYNCED_SETTING_KEYS as readonly string[]).includes(key);
}

function equalValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => equalValue(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      equalValue(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
    );
  }
  return false;
}

/**
 * Top-level settings whose value really changed. `patchSettings` bumps only
 * these stamps, so changing the theme no longer makes every setting newer than
 * the other device's copy.
 */
export function changedSettingKeys(
  previous: Settings,
  next: Settings
): (keyof Settings)[] {
  const keys = new Set<string>([
    ...Object.keys(previous),
    ...Object.keys(next),
  ]);
  const changed: (keyof Settings)[] = [];
  for (const key of keys) {
    if (
      !equalValue(
        (previous as unknown as Record<string, unknown>)[key],
        (next as unknown as Record<string, unknown>)[key]
      )
    ) {
      changed.push(key as keyof Settings);
    }
  }
  return changed;
}

export function stampsForAllKeys(updatedAt: number): SettingsStamps {
  const at = Number(updatedAt) || 0;
  const stamps: SettingsStamps = {};
  for (const key of SYNCED_SETTING_KEYS) stamps[key] = at;
  return stamps;
}

/**
 * Missing stamps come from a version-1 file (one timestamp for the whole file)
 * or from a key that did not exist yet. A missing key on a v2 file falls back
 * to 0 so the local value wins instead of being silently overwritten.
 */
export function normalizeStamps(
  stamps: SettingsStamps | undefined,
  fallback: number
): SettingsStamps {
  const result: SettingsStamps = {};
  for (const key of SYNCED_SETTING_KEYS) {
    const stamp = Number(stamps?.[key]);
    result[key] =
      Number.isFinite(stamp) && stamp > 0 ? stamp : Number(fallback) || 0;
  }
  return result;
}

export function pickSyncedSettings(settings: Settings): SyncSettings {
  const result: Record<string, unknown> = {};
  for (const key of SYNCED_SETTING_KEYS) {
    result[key] = settings[key];
  }
  return result as unknown as SyncSettings;
}

export type MergedSettings = {
  /** Local settings with every newer remote value applied. */
  settings: Settings;
  /** Per-key newest timestamp after the merge. */
  stamps: SettingsStamps;
  /** Newest stamp across all keys (payload `updatedAt`). */
  updatedAt: number;
  /** Keys whose value was taken from the remote file. */
  fromRemote: SyncedSettingKey[];
};

/**
 * Key-level last-writer-wins merge.
 *
 * Version 1 files only carry one `updatedAt`, so every key is treated as
 * written at that moment. Version 2 files carry a stamp per key, which lets two
 * devices edit different settings without either copy being wiped.
 */
export function mergeSettings(
  local: Settings,
  localStamps: SettingsStamps | undefined,
  localUpdatedAt: number,
  remote: Partial<Settings> | undefined,
  remoteStamps: SettingsStamps | undefined,
  remoteUpdatedAt: number
): MergedSettings {
  const localNormalized = normalizeStamps(localStamps, localUpdatedAt);
  const remoteNormalized = remote
    ? normalizeStamps(
        remoteStamps,
        remoteStamps ? 0 : Number(remoteUpdatedAt) || 0
      )
    : undefined;

  const settings = { ...local } as Settings;
  const stamps: SettingsStamps = { ...localNormalized };
  const fromRemote: SyncedSettingKey[] = [];

  for (const key of SYNCED_SETTING_KEYS) {
    const hasRemote =
      !!remote &&
      Object.prototype.hasOwnProperty.call(remote, key) &&
      remote[key] !== undefined;
    const localStamp = localNormalized[key] ?? 0;
    const remoteStamp = remoteNormalized?.[key] ?? 0;
    if (hasRemote && remoteStamp > localStamp) {
      // The key union is validated at runtime by the shape of Settings; the
      // cast only satisfies TS's indexed assignment on a generic key.
      const remoteValue = (
        remote as unknown as Record<string, unknown>
      )[key];
      if (!equalValue((settings as unknown as Record<string, unknown>)[key], remoteValue)) {
        fromRemote.push(key);
      }
      (settings as unknown as Record<string, unknown>)[key] = remoteValue;
      stamps[key] = remoteStamp;
    } else {
      stamps[key] = localStamp;
    }
  }

  let updatedAt = 0;
  for (const key of SYNCED_SETTING_KEYS) {
    updatedAt = Math.max(updatedAt, Number(stamps[key]) || 0);
  }
  updatedAt = Math.max(updatedAt, Number(localUpdatedAt) || 0);

  return { settings, stamps, updatedAt, fromRemote };
}

export type RemoteSettingsFile = {
  version?: number;
  updatedAt?: number;
  stamps?: SettingsStamps;
  settings?: Partial<Settings>;
};

/** True when the merged file differs from what is already on the server. */
export function settingsFileChanged(
  payload: { updatedAt: number; stamps?: SettingsStamps; settings: SyncSettings },
  remote: RemoteSettingsFile | undefined
): boolean {
  if (!remote?.settings) return true;
  const payloadStamps = payload.stamps ?? {};
  for (const key of SYNCED_SETTING_KEYS) {
    if (!equalValue(payload.settings[key], remote.settings[key])) return true;
  }
  const remoteNormalized = normalizeStamps(
    remote.stamps,
    Number(remote.version) >= 2 ? 0 : Number(remote.updatedAt) || 0
  );
  return SYNCED_SETTING_KEYS.some(
    (key) =>
      (Number(payloadStamps[key]) || 0) !==
      (Number(remoteNormalized[key]) || 0)
  );
}
