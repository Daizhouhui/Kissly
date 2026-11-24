import { mergeHistoryEntry } from '../watchProgress';
import type { HistoryItem } from '../types';
import { tombstonesChanged } from './collection';
import type { CollectionTombstones, MergedCollection } from './collection';

/**
 * Resume points are written on a session boundary, never on every playback
 * tick: WebDAV rewrites the whole file per PUT and providers keep a version
 * history, so a chatty progress file would burn quota and look like abuse.
 */
export const PROGRESS_LIMIT = 60;
export const PROGRESS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type ProgressItem = {
  videoId: string;
  title?: string;
  author?: string;
  thumbnail?: string;
  resumeAt?: number;
  duration?: number;
  progress: number;
  lastWatchedAt: number;
};

export type ProgressFile = {
  version: 1;
  updatedAt: number;
  items: ProgressItem[];
  deleted: CollectionTombstones;
};

export type MergedProgress = MergedCollection<ProgressItem>;

function clamp01(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function positive(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function mergeDeleted(
  local: CollectionTombstones = {},
  remote: CollectionTombstones = {}
): CollectionTombstones {
  const result: CollectionTombstones = { ...remote };
  for (const [videoId, at] of Object.entries(local)) {
    result[videoId] = Math.max(result[videoId] ?? 0, Number(at) || 0);
  }
  return result;
}

export function normalizeProgressItem(value: unknown): ProgressItem | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const videoId =
    typeof raw.videoId === 'string' ? raw.videoId.trim() : '';
  const lastWatchedAt = Number(raw.lastWatchedAt) || 0;
  if (!videoId || lastWatchedAt <= 0) return null;
  return {
    videoId,
    title:
      typeof raw.title === 'string' && raw.title ? raw.title : undefined,
    author:
      typeof raw.author === 'string' && raw.author ? raw.author : undefined,
    thumbnail:
      typeof raw.thumbnail === 'string' && raw.thumbnail
        ? raw.thumbnail
        : undefined,
    resumeAt: positive(raw.resumeAt),
    duration: positive(raw.duration),
    progress: clamp01(raw.progress),
    lastWatchedAt,
  };
}

function normalizeList(items: unknown): ProgressItem[] {
  if (!Array.isArray(items)) return [];
  const result: ProgressItem[] = [];
  const seen = new Set<string>();
  for (const value of items) {
    const item = normalizeProgressItem(value);
    if (!item || seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    result.push(item);
  }
  return result;
}

/** Only the resume half of a history entry leaves the device. */
export function progressFromHistory(
  history: HistoryItem[],
  now = Date.now()
): ProgressItem[] {
  const cutoff = now - PROGRESS_MAX_AGE_MS;
  return history
    .filter((item) => Number(item.lastWatchedAt) >= cutoff)
    .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt)
    .slice(0, PROGRESS_LIMIT)
    .map((item) => ({
      videoId: item.videoId,
      title: item.title,
      author: item.author,
      thumbnail: item.thumbnail,
      resumeAt: positive(item.resumeAt),
      duration: positive(item.duration),
      progress: clamp01(item.progress),
      lastWatchedAt: Number(item.lastWatchedAt) || 0,
    }));
}

/**
 * Newest lastWatchedAt wins for the position; progress stays monotonic so a
 * device that watched further is never rolled back. A genuine rewind still
 * moves resumeAt because the newer entry carries it.
 */
function mergeEntry(a: ProgressItem, b: ProgressItem): ProgressItem {
  const newer = a.lastWatchedAt >= b.lastWatchedAt ? a : b;
  const older = newer === a ? b : a;
  return {
    videoId: newer.videoId,
    title: newer.title || older.title,
    author: newer.author || older.author,
    thumbnail: newer.thumbnail || older.thumbnail,
    resumeAt: newer.resumeAt ?? older.resumeAt,
    duration: newer.duration ?? older.duration,
    progress: Math.max(clamp01(a.progress), clamp01(b.progress)),
    lastWatchedAt: Math.max(a.lastWatchedAt, b.lastWatchedAt),
  };
}

export function mergeProgress(
  local: ProgressItem[],
  remote: unknown,
  localDeleted: CollectionTombstones = {},
  remoteDeleted: CollectionTombstones = {}
): MergedProgress {
  const tombstones = mergeDeleted(localDeleted, remoteDeleted);

  const candidates = new Map<string, ProgressItem>();
  for (const item of normalizeList(remote)) {
    candidates.set(item.videoId, item);
  }
  for (const item of local) {
    const previous = candidates.get(item.videoId);
    candidates.set(
      item.videoId,
      previous ? mergeEntry(item, previous) : item
    );
  }

  const surviving = Array.from(candidates.values()).filter((item) => {
    const deletedAt = tombstones[item.videoId];
    return !deletedAt || item.lastWatchedAt > deletedAt;
  });

  for (const item of surviving) {
    if (tombstones[item.videoId]) delete tombstones[item.videoId];
  }

  return {
    items: surviving
      .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt)
      .slice(0, PROGRESS_LIMIT),
    tombstones,
  };
}

/**
 * Merge remote resume points into the local history list. Existing entries keep
 * their local titles; a video only seen on the other device is recreated when
 * the remote file still carries enough metadata to render a card.
 */
export function applyProgressToHistory(
  history: HistoryItem[],
  merged: MergedProgress,
  now = Date.now(),
  limit = 120
): HistoryItem[] {
  const pending = new Map<string, ProgressItem>();
  for (const item of merged.items) pending.set(item.videoId, item);

  const kept: HistoryItem[] = [];
  for (const entry of history) {
    const deletedAt = merged.tombstones[entry.videoId];
    if (deletedAt && entry.lastWatchedAt <= deletedAt) continue;
    const incoming = pending.get(entry.videoId);
    if (!incoming) {
      kept.push(entry);
      continue;
    }
    pending.delete(entry.videoId);
    // Only the resume fields are taken from the other device: the local entry
    // already owns its title, author and thumbnail, and those never travel.
    kept.push(
      mergeHistoryEntry(
        entry,
        {
          videoId: entry.videoId,
          resumeAt: incoming.resumeAt,
          duration: incoming.duration,
          progress: incoming.progress,
          lastWatchedAt: incoming.lastWatchedAt,
        },
        now
      )
    );
  }

  for (const [videoId, item] of pending) {
    const deletedAt = merged.tombstones[videoId];
    if (deletedAt && item.lastWatchedAt <= deletedAt) continue;
    if (!item.title) continue;
    kept.push({
      videoId,
      title: item.title,
      author: item.author ?? '',
      thumbnail: item.thumbnail,
      savedAt: item.lastWatchedAt,
      lastWatchedAt: item.lastWatchedAt,
      progress: clamp01(item.progress),
      resumeAt: item.resumeAt,
      duration: item.duration,
    });
  }

  return kept
    .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt)
    .slice(0, limit);
}

function shapeOf(item: ProgressItem) {
  return {
    videoId: item.videoId,
    title: item.title ?? '',
    author: item.author ?? '',
    thumbnail: item.thumbnail ?? '',
    resumeAt: item.resumeAt ?? 0,
    duration: item.duration ?? 0,
    progress: item.progress,
    lastWatchedAt: item.lastWatchedAt,
  };
}

/** True when the local history list has to adopt the merged resume points. */
export function progressLocalChanged(
  history: HistoryItem[],
  localDeleted: CollectionTombstones,
  merged: MergedProgress
): boolean {
  // Compare only the fields applyProgressToHistory can change. A remote title
  // difference does not modify an existing local entry, and comparing it here
  // would schedule a pointless rewrite after every sync.
  const localItems = progressFromHistory(history);
  const resumeShape = (item: ProgressItem) => ({
    videoId: item.videoId,
    resumeAt: item.resumeAt ?? 0,
    duration: item.duration ?? 0,
    progress: item.progress,
    lastWatchedAt: item.lastWatchedAt,
  });
  if (
    JSON.stringify(localItems.map(resumeShape)) !==
    JSON.stringify(merged.items.map(resumeShape))
  ) {
    return true;
  }
  return tombstonesChanged(localDeleted, merged.tombstones);
}

export function progressPayloadChanged(
  merged: MergedProgress,
  remote: ProgressFile | undefined | null
): boolean {
  if (!remote || remote.version !== 1) return true;
  const remoteItems = remote.items ?? [];
  if (remoteItems.length !== merged.items.length) return true;
  if (
    JSON.stringify(merged.items.map(shapeOf)) !==
    JSON.stringify(remoteItems.map(shapeOf))
  ) {
    return true;
  }
  return tombstonesChanged(merged.tombstones, remote.deleted);
}

export function progressPayload(
  merged: MergedProgress,
  updatedAt: number
): ProgressFile {
  return {
    version: 1,
    updatedAt,
    items: merged.items,
    deleted: merged.tombstones,
  };
}
