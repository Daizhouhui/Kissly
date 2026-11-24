import { getSecret } from '../secrets';
import {
  mergeSettings,
  pickSyncedSettings,
  settingsFileChanged,
} from '../settingsSync';
import type { SettingsStamps, SyncSettings } from '../settingsSync';
import { getSettings, HISTORY_LIMIT, useAppStore } from '../store';
import { Subscription, WebDavConfig } from '../types';
import {
  favoritesLocalChanged,
  favoritesPayload,
  favoritesPayloadChanged,
  mergeFavorites,
} from './favorites';
import type { FavoritesFile } from './favorites';
import {
  applyProgressToHistory,
  mergeProgress,
  progressFromHistory,
  progressLocalChanged,
  progressPayload,
  progressPayloadChanged,
} from './progress';
import type { ProgressFile } from './progress';
import {
  mergeSentences,
  sentencesLocalChanged,
  sentencesPayload,
  sentencesPayloadChanged,
} from './sentences';
import type { SentencesFile } from './sentences';
import {
  localSubscriptionChanged,
  mergeSubscriptions,
  subscriptionPayloadChanged,
} from './subscriptions';
import type { SubscriptionTombstones } from './subscriptions';
import { isWebdavConflictError, WebdavClient } from './webdav';

type SubscriptionsFile = {
  version: 2;
  updatedAt: number;
  orderUpdatedAt: number;
  items: Subscription[];
  deleted: SubscriptionTombstones;
};

/**
 * `version: 1` files only have one `updatedAt`; `version: 2` adds a stamp per
 * top-level setting so two devices can edit different rows without one whole
 * file overwriting the other.
 */
type SettingsFile = {
  version: 1 | 2;
  updatedAt: number;
  stamps?: SettingsStamps;
  settings: SyncSettings;
};

export async function getWebdavConfig(): Promise<WebDavConfig> {
  const settings = getSettings();
  const storedPassword = await getSecret('webdavPassword');
  return {
    ...settings.webdav,
    password: settings.webdav.password || storedPassword,
  };
}

export async function testWebdav(config?: WebDavConfig): Promise<void> {
  const resolved = config ?? (await getWebdavConfig());
  if (!resolved.url.trim()) throw new Error('请填写 WebDAV 地址');
  if (!resolved.username.trim()) throw new Error('请填写 WebDAV 用户名');
  if (!resolved.password) throw new Error('请填写 WebDAV 应用密码');
  const client = new WebdavClient(resolved);
  await client.test();
}

async function syncSubscriptions(client: WebdavClient): Promise<number> {
  const state = useAppStore.getState();
  const localSubs = state.subscriptions;
  const localDeleted = state.subscriptionTombstones;
  const localOrderUpdatedAt = state.subscriptionOrderUpdatedAt;
  const remoteSubs = await client.getJson<SubscriptionsFile>('subscriptions.json');
  const remoteFile = remoteSubs.data;
  const merged = mergeSubscriptions(
    localSubs,
    remoteFile?.items ?? [],
    localDeleted,
    remoteFile?.deleted ?? {},
    localOrderUpdatedAt,
    remoteFile?.orderUpdatedAt ?? remoteFile?.updatedAt ?? 0
  );
  let finalMerged = merged;
  const payload: SubscriptionsFile = {
    version: 2,
    updatedAt: Date.now(),
    orderUpdatedAt: merged.orderUpdatedAt,
    items: merged.items,
    deleted: merged.tombstones,
  };
  const needsUpload = !remoteFile || subscriptionPayloadChanged(merged, remoteFile);

  if (needsUpload) {
    try {
      await client.putJson('subscriptions.json', payload, remoteSubs.etag);
    } catch (error) {
      if (isWebdavConflictError(error)) {
        const retry = await client.getJson<SubscriptionsFile>(
          'subscriptions.json'
        );
        // Re-read the store instead of reusing the snapshot taken before the
        // network round-trip: the user may have added or deleted a channel
        // while the sync was in flight.
        const latest = useAppStore.getState();
        const retryMerged = mergeSubscriptions(
          latest.subscriptions,
          retry.data?.items ?? [],
          latest.subscriptionTombstones,
          retry.data?.deleted ?? {},
          latest.subscriptionOrderUpdatedAt,
          retry.data?.orderUpdatedAt ?? retry.data?.updatedAt ?? 0
        );
        finalMerged = retryMerged;
        await client.putJson(
          'subscriptions.json',
          {
            version: 2,
            updatedAt: Date.now(),
            orderUpdatedAt: retryMerged.orderUpdatedAt,
            items: retryMerged.items,
            deleted: retryMerged.tombstones,
          },
          retry.etag
        );
      } else {
        throw error;
      }
    }
  }

  // The server copy is the baseline; the latest local state may contain edits
  // made after the initial snapshot. Merge once more before replacing local
  // so a concurrent add/delete is never dropped.
  const latestLocal = useAppStore.getState();
  const applied = mergeSubscriptions(
    latestLocal.subscriptions,
    finalMerged.items,
    latestLocal.subscriptionTombstones,
    finalMerged.tombstones,
    latestLocal.subscriptionOrderUpdatedAt,
    finalMerged.orderUpdatedAt
  );
  const shouldReplaceLocal = localSubscriptionChanged(
    latestLocal.subscriptions,
    latestLocal.subscriptionTombstones,
    latestLocal.subscriptionOrderUpdatedAt,
    applied
  );
  if (shouldReplaceLocal) {
    useAppStore
      .getState()
      .replaceSubscriptionSync(
        applied.items,
        applied.tombstones,
        applied.orderUpdatedAt
      );
  }
  return applied.items.length;
}

async function syncFavoriteCollection(client: WebdavClient): Promise<number> {
  const snapshot = useAppStore.getState();
  const remote = await client.getJson<FavoritesFile>('favorites.json');
  const merged = mergeFavorites(
    snapshot.favorites,
    remote.data?.items,
    snapshot.favoriteTombstones,
    remote.data?.deleted
  );
  let finalMerged = merged;

  if (!remote.data || favoritesPayloadChanged(merged, remote.data)) {
    try {
      await client.putJson(
        'favorites.json',
        favoritesPayload(finalMerged, Date.now()),
        remote.etag
      );
    } catch (error) {
      if (!isWebdavConflictError(error)) throw error;
      const retry = await client.getJson<FavoritesFile>('favorites.json');
      const latest = useAppStore.getState();
      finalMerged = mergeFavorites(
        latest.favorites,
        retry.data?.items,
        latest.favoriteTombstones,
        retry.data?.deleted
      );
      await client.putJson(
        'favorites.json',
        favoritesPayload(finalMerged, Date.now()),
        retry.etag
      );
    }
  }

  const latest = useAppStore.getState();
  const applied = mergeFavorites(
    latest.favorites,
    finalMerged.items,
    latest.favoriteTombstones,
    finalMerged.tombstones
  );
  if (
    favoritesLocalChanged(
      latest.favorites,
      latest.favoriteTombstones,
      applied
    )
  ) {
    useAppStore
      .getState()
      .replaceFavoriteSync(applied.items, applied.tombstones);
  }
  return applied.items.length;
}

async function syncSentenceCollection(client: WebdavClient): Promise<number> {
  const snapshot = useAppStore.getState();
  const remote = await client.getJson<SentencesFile>('sentences.json');
  const merged = mergeSentences(
    snapshot.sentenceFavorites,
    remote.data?.items,
    snapshot.sentenceTombstones,
    remote.data?.deleted
  );
  let finalMerged = merged;

  if (!remote.data || sentencesPayloadChanged(merged, remote.data)) {
    try {
      await client.putJson(
        'sentences.json',
        sentencesPayload(finalMerged, Date.now()),
        remote.etag
      );
    } catch (error) {
      if (!isWebdavConflictError(error)) throw error;
      const retry = await client.getJson<SentencesFile>('sentences.json');
      const latest = useAppStore.getState();
      finalMerged = mergeSentences(
        latest.sentenceFavorites,
        retry.data?.items,
        latest.sentenceTombstones,
        retry.data?.deleted
      );
      await client.putJson(
        'sentences.json',
        sentencesPayload(finalMerged, Date.now()),
        retry.etag
      );
    }
  }

  const latest = useAppStore.getState();
  const applied = mergeSentences(
    latest.sentenceFavorites,
    finalMerged.items,
    latest.sentenceTombstones,
    finalMerged.tombstones
  );
  if (
    sentencesLocalChanged(
      latest.sentenceFavorites,
      latest.sentenceTombstones,
      applied
    )
  ) {
    useAppStore
      .getState()
      .replaceSentenceSync(applied.items, applied.tombstones);
  }
  return applied.items.length;
}

/**
 * Resume points only. Everything else about a watch (title, author, thumbnail,
 * when it was first opened) stays local, and only the newest 60 entries travel
 * so a single PUT stays in the low kilobytes.
 */
async function syncProgressFile(client: WebdavClient): Promise<number> {
  const snapshot = useAppStore.getState();
  const remote = await client.getJson<ProgressFile>('progress.json');
  const merged = mergeProgress(
    progressFromHistory(snapshot.history),
    remote.data?.items,
    snapshot.historyTombstones,
    remote.data?.deleted
  );
  let finalMerged = merged;

  if (!remote.data || progressPayloadChanged(merged, remote.data)) {
    try {
      await client.putJson(
        'progress.json',
        progressPayload(finalMerged, Date.now()),
        remote.etag
      );
    } catch (error) {
      if (!isWebdavConflictError(error)) throw error;
      const retry = await client.getJson<ProgressFile>('progress.json');
      const latest = useAppStore.getState();
      finalMerged = mergeProgress(
        progressFromHistory(latest.history),
        retry.data?.items,
        latest.historyTombstones,
        retry.data?.deleted
      );
      await client.putJson(
        'progress.json',
        progressPayload(finalMerged, Date.now()),
        retry.etag
      );
    }
  }

  const latest = useAppStore.getState();
  const applied = mergeProgress(
    progressFromHistory(latest.history),
    finalMerged.items,
    latest.historyTombstones,
    finalMerged.tombstones
  );
  if (
    progressLocalChanged(latest.history, latest.historyTombstones, applied)
  ) {
    const history = applyProgressToHistory(
      latest.history,
      applied,
      Date.now(),
      HISTORY_LIMIT
    );
    useAppStore.getState().replaceHistorySync(history, applied.tombstones);
  }
  return applied.items.length;
}

async function syncSettingsFile(client: WebdavClient): Promise<void> {
  const remoteSettings = await client.getJson<SettingsFile>('settings.json');
  const remoteSettingsFile = remoteSettings.data;
  // Read the store again: settings can change while the two GETs are in flight,
  // and replacing them with the startup snapshot would lose the edit.
  const latestSettingsState = useAppStore.getState();
  const mergedSettings = mergeSettings(
    latestSettingsState.settings,
    latestSettingsState.settingsStamps,
    latestSettingsState.settingsUpdatedAt,
    remoteSettingsFile?.settings,
    remoteSettingsFile?.stamps,
    Number(remoteSettingsFile?.updatedAt) || 0
  );
  // Keep the union locally even if the upload below fails: the next sync can
  // still push it, and the user sees the newest of both devices right away.
  useAppStore
    .getState()
    .replaceSettings(
      mergedSettings.settings,
      mergedSettings.updatedAt,
      mergedSettings.stamps
    );

  const settingsPayload: SettingsFile = {
    version: 2,
    updatedAt: mergedSettings.updatedAt || Date.now(),
    stamps: mergedSettings.stamps,
    settings: pickSyncedSettings(mergedSettings.settings),
  };

  if (!remoteSettingsFile || settingsFileChanged(settingsPayload, remoteSettingsFile)) {
    try {
      await client.putJson('settings.json', settingsPayload, remoteSettings.etag);
    } catch (error) {
      if (!isWebdavConflictError(error)) throw error;
      // Another device wrote between our GET and PUT. Re-merge both sides
      // instead of overwriting its newer keys with our stale snapshot.
      const retry = await client.getJson<SettingsFile>('settings.json');
      const latestRetryState = useAppStore.getState();
      const retryMerged = mergeSettings(
        latestRetryState.settings,
        latestRetryState.settingsStamps,
        latestRetryState.settingsUpdatedAt,
        retry.data?.settings,
        retry.data?.stamps,
        Number(retry.data?.updatedAt) || 0
      );
      useAppStore
        .getState()
        .replaceSettings(
          retryMerged.settings,
          retryMerged.updatedAt,
          retryMerged.stamps
        );
      await client.putJson(
        'settings.json',
        {
          version: 2,
          updatedAt: retryMerged.updatedAt || Date.now(),
          stamps: retryMerged.stamps,
          settings: pickSyncedSettings(retryMerged.settings),
        },
        retry.etag
      );
    }
  }
}

export async function syncNow(): Promise<string> {
  const config = await getWebdavConfig();
  if (!config.enabled) throw new Error('WebDAV 同步未启用');
  if (!config.url.trim() || !config.username.trim() || !config.password) {
    throw new Error('请先填写完整的 WebDAV 配置');
  }
  const state = useAppStore.getState();
  state.setSync('syncing', '正在同步…');

  try {
    const client = new WebdavClient(config);
    await client.ensureFolder();

    const subscriptions = await syncSubscriptions(client);
    const favorites = await syncFavoriteCollection(client);
    const sentences = await syncSentenceCollection(client);
    let progress = 0;
    try {
      progress = await syncProgressFile(client);
      lastProgressSyncAt = Date.now();
      progressDirty = false;
    } catch {
      // Progress is best effort: it is written on a session boundary and a
      // failure must not fail the whole sync or block the settings merge.
    }
    await syncSettingsFile(client);

    const now = Date.now();
    const summary = `同步完成 · ${subscriptions} 订阅 · ${favorites} 收藏 · ${sentences} 句子${
      progress ? ` · ${progress} 条进度` : ''
    }`;
    useAppStore.getState().setSync('ok', summary, now);
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useAppStore.getState().setSync('error', message);
    throw error;
  }
}

/** Minimum gap between two progress-only uploads. */
const PROGRESS_MIN_INTERVAL = 3 * 60 * 1000;

let lastProgressSyncAt = 0;
let progressDirty = false;
let progressTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Called whenever the history list changes. The actual PUT is deferred so a
 * video watched for an hour produces a handful of writes instead of thousands.
 */
export function markProgressDirty(): void {
  progressDirty = true;
  if (progressTimer) return;
  const wait = Math.max(
    0,
    PROGRESS_MIN_INTERVAL - (Date.now() - lastProgressSyncAt)
  );
  progressTimer = setTimeout(() => {
    progressTimer = null;
    void flushProgressNow();
  }, wait);
}

/**
 * Upload resume points right now, bypassing the throttle. Used when the app
 * goes to the background, where a pending timer may never fire.
 */
export async function flushProgressNow(): Promise<void> {
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }
  if (!progressDirty) return;
  progressDirty = false;
  lastProgressSyncAt = Date.now();

  const settings = getSettings();
  if (!settings.webdav.enabled) return;
  const config = await getWebdavConfig();
  if (!config.url.trim() || !config.username.trim() || !config.password) {
    return;
  }
  try {
    const client = new WebdavClient(config);
    await client.ensureFolder();
    await syncProgressFile(client);
  } catch {
    // Keep the dirty flag so the next session boundary retries the write.
    progressDirty = true;
  }
}

let lastAutoSync = 0;

export async function maybeAutoSync(): Promise<void> {
  const settings = getSettings();
  if (!settings.webdav.enabled) return;
  if (Date.now() - lastAutoSync < 10 * 60 * 1000) return;
  lastAutoSync = Date.now();
  try {
    await syncNow();
  } catch {
    // Silent background sync: the settings page exposes the error.
  }
}
