import type { FavoriteItem } from '../types';
import {
  collectionPayloadChanged,
  mergeCollection,
  tombstonesChanged,
} from './collection';
import type { CollectionTombstones, MergedCollection } from './collection';

/**
 * Video favorites travel as their identity only. Playback position lives in
 * progress.json so a single write path owns the resume point; keeping a copy
 * here would let the two files disagree.
 */
export type SyncedFavorite = {
  videoId: string;
  title: string;
  author: string;
  thumbnail?: string;
  savedAt: number;
};

export type FavoritesFile = {
  version: 2;
  updatedAt: number;
  items: SyncedFavorite[];
  deleted: CollectionTombstones;
};

export function normalizeFavorite(value: unknown): SyncedFavorite | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const videoId =
    typeof raw.videoId === 'string' ? raw.videoId.trim() : '';
  if (!videoId) return null;
  return {
    videoId,
    title:
      typeof raw.title === 'string' && raw.title ? raw.title : videoId,
    author: typeof raw.author === 'string' ? raw.author : '',
    thumbnail:
      typeof raw.thumbnail === 'string' && raw.thumbnail
        ? raw.thumbnail
        : undefined,
    savedAt: Number(raw.savedAt) || 0,
  };
}

export function toSyncedFavorite(item: FavoriteItem): SyncedFavorite {
  return normalizeFavorite(item) as SyncedFavorite;
}

function normalizeList(items: unknown): SyncedFavorite[] {
  if (!Array.isArray(items)) return [];
  const result: SyncedFavorite[] = [];
  const seen = new Set<string>();
  for (const value of items) {
    const item = normalizeFavorite(value);
    if (!item || seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    result.push(item);
  }
  return result;
}

export function mergeFavorites(
  local: FavoriteItem[],
  remote: unknown,
  localDeleted: CollectionTombstones = {},
  remoteDeleted: CollectionTombstones = {}
): MergedCollection<SyncedFavorite> {
  return mergeCollection<SyncedFavorite>({
    local: local.map(toSyncedFavorite),
    remote: normalizeList(remote),
    localDeleted,
    remoteDeleted,
    idOf: (item) => item.videoId,
    timeOf: (item) => item.savedAt,
  });
}

function shapeOf(item: SyncedFavorite) {
  return {
    videoId: item.videoId,
    title: item.title,
    author: item.author,
    thumbnail: item.thumbnail ?? '',
    savedAt: item.savedAt,
  };
}

export function favoritesPayloadChanged(
  merged: MergedCollection<SyncedFavorite>,
  remote: FavoritesFile | undefined | null
): boolean {
  return collectionPayloadChanged(merged, remote, shapeOf);
}

/** True when the on-device list has to adopt the merged result. */
export function favoritesLocalChanged(
  local: FavoriteItem[],
  localDeleted: CollectionTombstones,
  merged: MergedCollection<SyncedFavorite>
): boolean {
  const localItems = local.map(toSyncedFavorite);
  if (
    JSON.stringify(localItems.map(shapeOf)) !==
    JSON.stringify(merged.items.map(shapeOf))
  ) {
    return true;
  }
  return tombstonesChanged(localDeleted, merged.tombstones);
}

export function favoritesPayload(
  merged: MergedCollection<SyncedFavorite>,
  updatedAt: number
): FavoritesFile {
  return {
    version: 2,
    updatedAt,
    items: merged.items,
    deleted: merged.tombstones,
  };
}
