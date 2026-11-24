import type { SentenceFavorite } from '../types';
import {
  collectionPayloadChanged,
  mergeCollection,
  tombstonesChanged,
} from './collection';
import type { CollectionTombstones, MergedCollection } from './collection';

/** Same hard cap the local store enforces for sentence favorites. */
export const SENTENCE_SYNC_LIMIT = 500;

export type SentencesFile = {
  version: 2;
  updatedAt: number;
  items: SentenceFavorite[];
  deleted: CollectionTombstones;
};

export function normalizeSentence(value: unknown): SentenceFavorite | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const videoId = typeof raw.videoId === 'string' ? raw.videoId.trim() : '';
  const text = typeof raw.text === 'string' ? raw.text : '';
  if (!id || !videoId || !text) return null;
  return {
    id,
    videoId,
    videoTitle:
      typeof raw.videoTitle === 'string' && raw.videoTitle
        ? raw.videoTitle
        : videoId,
    videoAuthor: typeof raw.videoAuthor === 'string' ? raw.videoAuthor : '',
    thumbnail:
      typeof raw.thumbnail === 'string' && raw.thumbnail
        ? raw.thumbnail
        : undefined,
    start: Number(raw.start) || 0,
    end: Number(raw.end) || 0,
    text,
    translation:
      typeof raw.translation === 'string' && raw.translation
        ? raw.translation
        : undefined,
    savedAt: Number(raw.savedAt) || 0,
  };
}

function normalizeList(items: unknown): SentenceFavorite[] {
  if (!Array.isArray(items)) return [];
  const result: SentenceFavorite[] = [];
  const seen = new Set<string>();
  for (const value of items) {
    const item = normalizeSentence(value);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

export function mergeSentences(
  local: SentenceFavorite[],
  remote: unknown,
  localDeleted: CollectionTombstones = {},
  remoteDeleted: CollectionTombstones = {}
): MergedCollection<SentenceFavorite> {
  return mergeCollection<SentenceFavorite>({
    local,
    remote: normalizeList(remote),
    localDeleted,
    remoteDeleted,
    idOf: (item) => item.id,
    timeOf: (item) => item.savedAt,
    limit: SENTENCE_SYNC_LIMIT,
  });
}

function shapeOf(item: SentenceFavorite) {
  return {
    id: item.id,
    videoId: item.videoId,
    videoTitle: item.videoTitle,
    videoAuthor: item.videoAuthor,
    thumbnail: item.thumbnail ?? '',
    start: item.start,
    end: item.end,
    text: item.text,
    translation: item.translation ?? '',
    savedAt: item.savedAt,
  };
}

export function sentencesPayloadChanged(
  merged: MergedCollection<SentenceFavorite>,
  remote: SentencesFile | undefined | null
): boolean {
  return collectionPayloadChanged(merged, remote, shapeOf);
}

/** True when the on-device list has to adopt the merged result. */
export function sentencesLocalChanged(
  local: SentenceFavorite[],
  localDeleted: CollectionTombstones,
  merged: MergedCollection<SentenceFavorite>
): boolean {
  if (
    JSON.stringify(local.map(shapeOf)) !==
    JSON.stringify(merged.items.map(shapeOf))
  ) {
    return true;
  }
  return tombstonesChanged(localDeleted, merged.tombstones);
}

export function sentencesPayload(
  merged: MergedCollection<SentenceFavorite>,
  updatedAt: number
): SentencesFile {
  return {
    version: 2,
    updatedAt,
    items: merged.items,
    deleted: merged.tombstones,
  };
}
