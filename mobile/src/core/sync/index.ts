import { getSecret } from '../secrets';
import { getSettings, useAppStore } from '../store';
import { Settings, Subscription, WebDavConfig } from '../types';
import { WebdavClient } from './webdav';

type SubscriptionTombstones = Record<string, number>;

type SubscriptionsFile = {
  version: 2;
  updatedAt: number;
  orderUpdatedAt: number;
  items: Subscription[];
  deleted: SubscriptionTombstones;
};

type SettingsFile = {
  version: 1;
  updatedAt: number;
  settings: Omit<Settings, 'webdav'>;
};

type MergedSubscriptions = {
  items: Subscription[];
  tombstones: SubscriptionTombstones;
  orderUpdatedAt: number;
};

function normalizedItem(item: Subscription): Subscription {
  return {
    channelId: item.channelId,
    title: item.title,
    handle: item.handle,
    avatar: item.avatar,
    group: item.group,
    addedAt: Number(item.addedAt) || 0,
    order: typeof item.order === 'number' ? item.order : undefined,
  };
}

function ordered(items: Subscription[]): Subscription[] {
  const allHaveOrder = items.every((item) => typeof item.order === 'number');
  return [...items].sort((a, b) => {
    if (allHaveOrder) return Number(a.order) - Number(b.order);
    return b.addedAt - a.addedAt;
  });
}

export function mergeSubscriptions(
  local: Subscription[],
  remote: Subscription[],
  localDeleted: SubscriptionTombstones = {},
  remoteDeleted: SubscriptionTombstones = {},
  localOrderUpdatedAt = 0,
  remoteOrderUpdatedAt = 0
): MergedSubscriptions {
  const tombstones: SubscriptionTombstones = { ...remoteDeleted };
  for (const [channelId, at] of Object.entries(localDeleted)) {
    tombstones[channelId] = Math.max(tombstones[channelId] ?? 0, Number(at) || 0);
  }

  const candidates = new Map<string, Subscription>();
  for (const item of remote) candidates.set(item.channelId, normalizedItem(item));
  for (const item of local) candidates.set(item.channelId, normalizedItem(item));

  const surviving = Array.from(candidates.values()).filter((item) => {
    const deletedAt = tombstones[item.channelId];
    return !deletedAt || item.addedAt > deletedAt;
  });
  for (const item of surviving) {
    const deletedAt = tombstones[item.channelId];
    if (deletedAt && item.addedAt > deletedAt) delete tombstones[item.channelId];
  }

  const orderSource =
    localOrderUpdatedAt >= remoteOrderUpdatedAt ? local : remote;
  const orderIds = ordered(orderSource).map((item) => item.channelId);
  const byId = new Map(surviving.map((item) => [item.channelId, item]));
  const finalIds: string[] = [];
  for (const channelId of orderIds) {
    if (byId.has(channelId) && !finalIds.includes(channelId)) {
      finalIds.push(channelId);
      byId.delete(channelId);
    }
  }
  const rest = Array.from(byId.values()).sort((a, b) => b.addedAt - a.addedAt);
  for (const item of rest) finalIds.push(item.channelId);

  return {
    items: finalIds.map((channelId, index) => ({
      ...(candidates.get(channelId) as Subscription),
      order: index,
    })),
    tombstones,
    orderUpdatedAt: Math.max(localOrderUpdatedAt, remoteOrderUpdatedAt),
  };
}

function subscriptionPayloadChanged(
  local: MergedSubscriptions,
  remote: SubscriptionsFile
): boolean {
  if (remote.version !== 2) return true;
  if (remote.orderUpdatedAt !== local.orderUpdatedAt) return true;
  if (remote.items.length !== local.items.length) return true;
  for (let index = 0; index < local.items.length; index += 1) {
    const a = normalizedItem(local.items[index]);
    const b = normalizedItem(remote.items[index]);
    if (
      a.channelId !== b.channelId ||
      a.title !== b.title ||
      a.handle !== b.handle ||
      a.avatar !== b.avatar ||
      a.group !== b.group ||
      a.addedAt !== b.addedAt ||
      a.order !== b.order
    ) {
      return true;
    }
  }
  const localDeleted = Object.entries(local.tombstones).sort(([a], [b]) => a.localeCompare(b));
  const remoteDeleted = Object.entries(remote.deleted ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (localDeleted.length !== remoteDeleted.length) return true;
  return localDeleted.some(
    ([channelId, at], index) =>
      remoteDeleted[index]?.[0] !== channelId ||
      Number(remoteDeleted[index]?.[1]) !== Number(at)
  );
}

function localSubscriptionChanged(
  localItems: Subscription[],
  localDeleted: SubscriptionTombstones,
  localOrderUpdatedAt: number,
  merged: MergedSubscriptions
): boolean {
  if (localOrderUpdatedAt !== merged.orderUpdatedAt) return true;
  const localDeletedEntries = Object.entries(localDeleted).sort(([a], [b]) => a.localeCompare(b));
  const mergedDeletedEntries = Object.entries(merged.tombstones).sort(([a], [b]) => a.localeCompare(b));
  if (localDeletedEntries.length !== mergedDeletedEntries.length) return true;
  for (let index = 0; index < localDeletedEntries.length; index += 1) {
    if (
      localDeletedEntries[index][0] !== mergedDeletedEntries[index]?.[0] ||
      Number(localDeletedEntries[index][1]) !== Number(mergedDeletedEntries[index]?.[1])
    ) {
      return true;
    }
  }
  if (localItems.length !== merged.items.length) return true;
  return localItems.some((item, index) => {
    const next = merged.items[index];
    const a = normalizedItem(item);
    const b = normalizedItem(next);
    return (
      a.channelId !== b.channelId ||
      a.title !== b.title ||
      a.handle !== b.handle ||
      a.avatar !== b.avatar ||
      a.group !== b.group ||
      a.addedAt !== b.addedAt ||
      a.order !== b.order
    );
  });
}

export async function getWebdavConfig(): Promise<WebDavConfig> {
  const settings = getSettings();
  const storedPassword = await getSecret('webdavPassword');
  return {
    ...settings.webdav,
    password: settings.webdav.password || storedPassword,
  };
}

function syncableSettings(settings: Settings): Omit<Settings, 'webdav'> {
  const { webdav, ...rest } = settings;
  return rest;
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
          const retryMerged = mergeSubscriptions(
            merged.items,
            retry.data?.items ?? [],
            merged.tombstones,
            retry.data?.deleted ?? {},
            merged.orderUpdatedAt,
            retry.data?.orderUpdatedAt ?? retry.data?.updatedAt ?? 0
          );
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

    const shouldReplaceLocal = localSubscriptionChanged(
      localSubs,
      localDeleted,
      localOrderUpdatedAt,
      merged
    );
    if (shouldReplaceLocal || needsUpload) {
      useAppStore
        .getState()
        .replaceSubscriptionSync(
          merged.items,
          merged.tombstones,
          merged.orderUpdatedAt
        );
    }

    const settings = useAppStore.getState().settings;
    const remoteSettings = await client.getJson<SettingsFile>('settings.json');
    const localUpdatedAt = state.settingsUpdatedAt || 0;
    if (
      remoteSettings.data?.settings &&
      Number(remoteSettings.data.updatedAt) > localUpdatedAt
    ) {
      useAppStore.getState().replaceSettings(
        {
          ...(remoteSettings.data.settings as Settings),
          webdav: settings.webdav,
        },
        Number(remoteSettings.data.updatedAt)
      );
    } else {
      const payload: SettingsFile = {
        version: 1,
        updatedAt: localUpdatedAt || Date.now(),
        settings: syncableSettings(settings),
      };
      try {
        await client.putJson('settings.json', payload, remoteSettings.etag);
      } catch (error) {
        if (!String(error).includes('412')) throw error;
        const retry = await client.getJson<SettingsFile>('settings.json');
        await client.putJson(
          'settings.json',
          {
            version: 1,
            updatedAt: Date.now(),
            settings: syncableSettings(settings),
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
