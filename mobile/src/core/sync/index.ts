import { getSecret } from '../secrets';
import {
  mergeSettings,
  pickSyncedSettings,
  settingsFileChanged,
} from '../settingsSync';
import type { SettingsStamps, SyncSettings } from '../settingsSync';
import { getSettings, useAppStore } from '../store';
import { Subscription, WebDavConfig } from '../types';
import {
  localSubscriptionChanged,
  mergeSubscriptions,
  subscriptionPayloadChanged,
} from './subscriptions';
import type { SubscriptionTombstones } from './subscriptions';
import { WebdavClient } from './webdav';

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

    const localSubs = state.subscriptions;
    const localDeleted = state.subscriptionTombstones;
    const localOrderUpdatedAt = state.subscriptionOrderUpdatedAt;
    const remoteSubs = await client.getJson<SubscriptionsFile>(
      'subscriptions.json'
    );
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
    const needsUpload =
      !remoteFile || subscriptionPayloadChanged(merged, remoteFile);

    if (needsUpload) {
      try {
        await client.putJson('subscriptions.json', payload, remoteSubs.etag);
      } catch (error) {
        if (String(error).includes('412')) {
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

    // The server copy is the baseline; the latest local state may contain
    // edits made after the initial snapshot. Merge once more before replacing
    // local so a concurrent add/delete is never dropped.
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

    const remoteSettings = await client.getJson<SettingsFile>('settings.json');
    const remoteSettingsFile = remoteSettings.data;
    // Read the store again: settings can change while the two GETs are in
    // flight, and replacing them with the startup snapshot would lose the edit.
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
        if (!String(error).includes('412')) throw error;
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

    const now = Date.now();
    useAppStore
      .getState()
      .setSync('ok', `同步完成 · ${merged.items.length} 个订阅`, now);
    return `同步完成，共 ${merged.items.length} 个订阅`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useAppStore.getState().setSync('error', message);
    throw error;
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
