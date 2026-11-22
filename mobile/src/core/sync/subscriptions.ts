import type { Subscription } from '../types';

export type SubscriptionTombstones = Record<string, number>;

export type MergedSubscriptions = {
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

export function subscriptionPayloadChanged(
  local: MergedSubscriptions,
  remote: {
    version: number;
    orderUpdatedAt: number;
    items: Subscription[];
    deleted?: SubscriptionTombstones;
  }
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
  const localDeleted = Object.entries(local.tombstones).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const remoteDeleted = Object.entries(remote.deleted ?? {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  if (localDeleted.length !== remoteDeleted.length) return true;
  return localDeleted.some(
    ([channelId, at], index) =>
      remoteDeleted[index]?.[0] !== channelId ||
      Number(remoteDeleted[index]?.[1]) !== Number(at)
  );
}

export function localSubscriptionChanged(
  localItems: Subscription[],
  localDeleted: SubscriptionTombstones,
  localOrderUpdatedAt: number,
  merged: MergedSubscriptions
): boolean {
  if (localOrderUpdatedAt !== merged.orderUpdatedAt) return true;
  const localDeletedEntries = Object.entries(localDeleted).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const mergedDeletedEntries = Object.entries(merged.tombstones).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  if (localDeletedEntries.length !== mergedDeletedEntries.length) return true;
  for (let index = 0; index < localDeletedEntries.length; index += 1) {
    if (
      localDeletedEntries[index][0] !== mergedDeletedEntries[index]?.[0] ||
      Number(localDeletedEntries[index][1]) !==
        Number(mergedDeletedEntries[index]?.[1])
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
