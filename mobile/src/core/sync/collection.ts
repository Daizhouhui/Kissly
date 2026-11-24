/**
 * Shared merge for id-keyed user collections (favorites, sentence favorites).
 *
 * A collection is a set of independent items, not a document: two devices that
 * each added something must keep both, and a delete must travel to the other
 * device instead of being undone by the next union. Deletions therefore use
 * tombstones keyed by item id, exactly like subscriptions do.
 */

export type CollectionTombstones = Record<string, number>;

export type MergedCollection<T> = {
  items: T[];
  tombstones: CollectionTombstones;
};

type RemoteCollection<T> = {
  version?: number;
  items?: T[];
  deleted?: CollectionTombstones;
};

export type MergeCollectionOptions<T extends object> = {
  local: T[];
  remote: T[];
  localDeleted?: CollectionTombstones;
  remoteDeleted?: CollectionTombstones;
  idOf: (item: T) => string;
  timeOf: (item: T) => number;
  /** Upper bound for the merged result, newest items win. */
  limit?: number;
};

function mergeTombstones(
  local: CollectionTombstones = {},
  remote: CollectionTombstones = {}
): CollectionTombstones {
  const result: CollectionTombstones = { ...remote };
  for (const [id, at] of Object.entries(local)) {
    result[id] = Math.max(result[id] ?? 0, Number(at) || 0);
  }
  return result;
}

/**
 * The local copy is the live one, so its non-empty fields win. Remote fields
 * only fill gaps (for example a thumbnail the local device never stored).
 */
function mergeItem<T extends object>(local: T, remote: T): T {
  const merged: Record<string, unknown> = {
    ...(remote as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(local as Record<string, unknown>)) {
    if (value !== undefined && value !== null && value !== '') {
      merged[key] = value;
    }
  }
  return merged as T;
}

export function mergeCollection<T extends object>(
  options: MergeCollectionOptions<T>
): MergedCollection<T> {
  const {
    local,
    remote,
    localDeleted,
    remoteDeleted,
    idOf,
    timeOf,
    limit,
  } = options;

  const tombstones = mergeTombstones(localDeleted, remoteDeleted);

  const candidates = new Map<string, T>();
  for (const item of remote) candidates.set(idOf(item), item);
  for (const item of local) {
    const id = idOf(item);
    const previous = candidates.get(id);
    candidates.set(id, previous ? mergeItem(item, previous) : item);
  }

  const surviving = Array.from(candidates.values()).filter((item) => {
    const deletedAt = tombstones[idOf(item)];
    // An item saved after its tombstone was written is a re-add, not a delete.
    return !deletedAt || timeOf(item) > deletedAt;
  });

  for (const item of surviving) {
    const deletedAt = tombstones[idOf(item)];
    if (deletedAt) delete tombstones[idOf(item)];
  }

  const sorted = surviving.sort((a, b) => {
    const delta = timeOf(b) - timeOf(a);
    return delta || idOf(a).localeCompare(idOf(b));
  });
  const items = limit && sorted.length > limit ? sorted.slice(0, limit) : sorted;

  return { items, tombstones };
}

/** True when two tombstone maps differ in ids or timestamps. */
export function tombstonesChanged(
  a: CollectionTombstones = {},
  b: CollectionTombstones = {}
): boolean {
  const sortEntries = (value: CollectionTombstones) =>
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(sortEntries(a)) !== JSON.stringify(sortEntries(b));
}

/** True when the merged state differs from the file already on the server. */
export function collectionPayloadChanged<T>(
  merged: MergedCollection<T>,
  remote: RemoteCollection<T> | undefined | null,
  normalize: (item: T) => unknown
): boolean {
  if (!remote || remote.version !== 2) return true;
  const remoteItems = remote.items ?? [];
  if (remoteItems.length !== merged.items.length) return true;
  const localShape = merged.items.map(normalize);
  const remoteShape = remoteItems.map(normalize);
  if (JSON.stringify(localShape) !== JSON.stringify(remoteShape)) return true;

  return tombstonesChanged(merged.tombstones, remote.deleted);
}
