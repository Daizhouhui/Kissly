import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_SETTINGS } from './defaults';
import { migrateSettingsForDesign } from './settingsMigration';
import {
  changedSettingKeys,
  isSyncedSettingKey,
  stampsForAllKeys,
} from './settingsSync';
import type { SettingsStamps } from './settingsSync';
import { normalizeSettings } from './settingsNormalize';
import { HistoryItem, FavoriteItem, SentenceFavorite, Settings, Subscription } from './types';
import { HistoryPatch, mergeHistoryEntry } from './watchProgress';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMerge(current, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Order arrays arrive from AsyncStorage and WebDAV. Always repair them before
 * they reach the translator or the reorder controls.
 */

export type SyncState = 'idle' | 'syncing' | 'ok' | 'error';

export type ToggleSentenceFavoriteResult = 'added' | 'removed' | 'limit';

export const SENTENCE_FAVORITE_LIMIT = 500;

/** Keeps AsyncStorage and the history list bounded; surfaced in the UI. */
export const HISTORY_LIMIT = 120;

export type YoutubeLoginStatus = 'unknown' | 'loggedIn' | 'loggedOut';

type SubscriptionTombstones = Record<string, number>;
type UserTombstones = Record<string, number>;

function withOrder(items: Subscription[]): Subscription[] {
  return items.map((item, index) => ({ ...item, order: index }));
}

function sortByOrder(items: Subscription[]): Subscription[] {
  const hasOrder = items.every((item) => typeof item.order === 'number');
  if (hasOrder) {
    return [...items].sort(
      (a, b) => Number(a.order) - Number(b.order) || b.addedAt - a.addedAt
    );
  }
  return [...items].sort((a, b) => b.addedAt - a.addedAt);
}

type AppState = {
  hydrated: boolean;
  settings: Settings;
  /** Per-key write time for WebDAV settings merge. */
  settingsStamps: SettingsStamps;
  settingsUpdatedAt: number;
  subscriptions: Subscription[];
  subscriptionTombstones: SubscriptionTombstones;
  subscriptionOrderUpdatedAt: number;
  favorites: FavoriteItem[];
  sentenceFavorites: SentenceFavorite[];
  history: HistoryItem[];
  /** Delete markers so a removal on one device is not undone by the other. */
  favoriteTombstones: UserTombstones;
  sentenceTombstones: UserTombstones;
  historyTombstones: UserTombstones;
  lastSyncAt: number;
  syncState: SyncState;
  syncMessage: string;
  youtubeLoginStatus: YoutubeLoginStatus;
  youtubeLoginCheckedAt: number;
  /** Avatar URL of the signed-in YouTube account; empty when signed out. */
  youtubeAvatar: string;
  setHydrated: (value: boolean) => void;
  patchSettings: (patch: DeepPartial<Settings>) => void;
  resetSettings: () => void;
  replaceSettings: (
    settings: Settings,
    updatedAt?: number,
    stamps?: SettingsStamps
  ) => void;
  addSubscription: (item: Subscription) => void;
  addSubscriptions: (items: Subscription[]) => void;
  updateSubscription: (channelId: string, patch: Partial<Subscription>) => void;
  removeSubscription: (channelId: string) => void;
  removeSubscriptions: (channelIds: string[]) => void;
  setSubscriptions: (items: Subscription[]) => void;
  reorderSubscriptions: (items: Subscription[]) => void;
  replaceSubscriptionSync: (
    items: Subscription[],
    tombstones: SubscriptionTombstones,
    orderUpdatedAt: number
  ) => void;
  toggleFavorite: (item: FavoriteItem) => boolean;
  removeFavorite: (videoId: string) => void;
  removeFavorites: (videoIds: string[]) => void;
  replaceFavoriteSync: (items: FavoriteItem[], tombstones: UserTombstones) => void;
  toggleSentenceFavorite: (item: SentenceFavorite) => ToggleSentenceFavoriteResult;
  removeSentenceFavorite: (id: string) => void;
  removeSentenceFavorites: (ids: string[]) => void;
  replaceSentenceSync: (
    items: SentenceFavorite[],
    tombstones: UserTombstones
  ) => void;
  recordHistory: (item: HistoryPatch) => void;
  removeHistory: (videoIds: string[]) => void;
  clearHistory: () => void;
  replaceHistorySync: (items: HistoryItem[], tombstones: UserTombstones) => void;
  setSync: (state: SyncState, message?: string, at?: number) => void;
  setYoutubeLoginStatus: (status: YoutubeLoginStatus, checkedAt?: number) => void;
  setYoutubeAvatar: (avatar: string) => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      settings: DEFAULT_SETTINGS,
      settingsStamps: {},
      settingsUpdatedAt: 0,
      subscriptions: [],
      subscriptionTombstones: {},
      subscriptionOrderUpdatedAt: 0,
      favorites: [],
      sentenceFavorites: [],
      history: [],
      favoriteTombstones: {},
      sentenceTombstones: {},
      historyTombstones: {},
      lastSyncAt: 0,
      syncState: 'idle',
      syncMessage: '',
      youtubeLoginStatus: 'unknown',
      youtubeLoginCheckedAt: 0,
      youtubeAvatar: '',
      setHydrated: (value) => set({ hydrated: value }),
      patchSettings: (patch) =>
        set((state) => {
          const next = normalizeSettings(deepMerge(state.settings, patch));
          const now = Date.now();
          const stamps = { ...state.settingsStamps };
          let touchedSyncedKey = false;
          for (const key of changedSettingKeys(state.settings, next)) {
            if (typeof key !== 'string' || !isSyncedSettingKey(key)) continue;
            stamps[key] = now;
            touchedSyncedKey = true;
          }
          return {
            settings: next,
            settingsStamps: stamps,
            // A theme or WebDAV edit is device-local and must not make the
            // whole settings file look newer than the other device's copy.
            settingsUpdatedAt: touchedSyncedKey
              ? now
              : state.settingsUpdatedAt,
          };
        }),
      resetSettings: () => {
        const now = Date.now();
        const current = get().settings;
        // "Reset preferences" must not sign the user out of WebDAV. Keep the
        // whole connection block (URL, username, folder, enabled) so a reset
        // of language/translation/subtitle settings does not wipe credentials.
        const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
        set({
          settings: {
            ...defaults,
            webdav: { ...(current.webdav ?? defaults.webdav) },
          },
          settingsStamps: stampsForAllKeys(now),
          settingsUpdatedAt: now,
        });
      },
      replaceSettings: (settings, updatedAt, stamps) => {
        const at = updatedAt ?? Date.now();
        set({
          settings: normalizeSettings(deepMerge(DEFAULT_SETTINGS, settings)),
          settingsStamps: stamps ? { ...stamps } : stampsForAllKeys(at),
          settingsUpdatedAt: at,
        });
      },
      addSubscription: (item) => {
        const exists = get().subscriptions.some(
          (sub) => sub.channelId === item.channelId
        );
        if (exists) return;
        set((state) => {
          const tombstones = { ...state.subscriptionTombstones };
          delete tombstones[item.channelId];
          return {
            subscriptions: withOrder([{ ...item, order: 0 }, ...state.subscriptions]),
            subscriptionTombstones: tombstones,
            subscriptionOrderUpdatedAt: Date.now(),
          };
        });
      },
      addSubscriptions: (items) => {
        const map = new Map(get().subscriptions.map((sub) => [sub.channelId, sub]));
        for (const item of items) {
          if (!map.has(item.channelId)) map.set(item.channelId, item);
        }
        set((state) => {
          const tombstones = { ...state.subscriptionTombstones };
          for (const item of items) delete tombstones[item.channelId];
          return {
            subscriptions: withOrder(Array.from(map.values())),
            subscriptionTombstones: tombstones,
            subscriptionOrderUpdatedAt: Date.now(),
          };
        });
      },
      updateSubscription: (channelId, patch) =>
        set((state) => ({
          subscriptions: state.subscriptions.map((sub) =>
            sub.channelId === channelId ? { ...sub, ...patch } : sub
          ),
        })),
      removeSubscription: (channelId) => {
        set((state) => ({
          subscriptions: withOrder(
            state.subscriptions.filter((sub) => sub.channelId !== channelId)
          ),
          subscriptionTombstones: {
            ...state.subscriptionTombstones,
            [channelId]: Date.now(),
          },
          subscriptionOrderUpdatedAt: Date.now(),
        }));
      },
      removeSubscriptions: (channelIds) => {
        const ids = new Set(channelIds);
        set((state) => {
          const tombstones = { ...state.subscriptionTombstones };
          const now = Date.now();
          for (const channelId of ids) tombstones[channelId] = now;
          return {
            subscriptions: withOrder(
              state.subscriptions.filter((sub) => !ids.has(sub.channelId))
            ),
            subscriptionTombstones: tombstones,
            subscriptionOrderUpdatedAt: now,
          };
        });
      },
      setSubscriptions: (items) => set({ subscriptions: withOrder(sortByOrder(items)) }),
      reorderSubscriptions: (items) =>
        set({
          subscriptions: withOrder(items),
          subscriptionOrderUpdatedAt: Date.now(),
        }),
      replaceSubscriptionSync: (items, tombstones, orderUpdatedAt) =>
        set({
          subscriptions: withOrder(sortByOrder(items)),
          subscriptionTombstones: tombstones,
          subscriptionOrderUpdatedAt: orderUpdatedAt,
        }),
      toggleFavorite: (item) => {
        const exists = get().favorites.some((fav) => fav.videoId === item.videoId);
        if (exists) {
          const deletedAt = Date.now();
          set((state) => ({
            favorites: state.favorites.filter((fav) => fav.videoId !== item.videoId),
            favoriteTombstones: {
              ...state.favoriteTombstones,
              [item.videoId]: deletedAt,
            },
          }));
          return false;
        }
        set((state) => {
          const tombstones = { ...state.favoriteTombstones };
          delete tombstones[item.videoId];
          return {
            favorites: [item, ...state.favorites],
            favoriteTombstones: tombstones,
          };
        });
        return true;
      },
      removeFavorite: (videoId) => {
        const deletedAt = Date.now();
        set((state) => ({
          favorites: state.favorites.filter((fav) => fav.videoId !== videoId),
          favoriteTombstones: {
            ...state.favoriteTombstones,
            [videoId]: deletedAt,
          },
        }));
      },
      removeFavorites: (videoIds) => {
        const targets = new Set(videoIds);
        const deletedAt = Date.now();
        set((state) => {
          const tombstones = { ...state.favoriteTombstones };
          for (const videoId of targets) tombstones[videoId] = deletedAt;
          return {
            favorites: state.favorites.filter((fav) => !targets.has(fav.videoId)),
            favoriteTombstones: tombstones,
          };
        });
      },
      replaceFavoriteSync: (items, tombstones) =>
        set({
          favorites: items.map((item) => ({ ...item })),
          favoriteTombstones: { ...tombstones },
        }),
      toggleSentenceFavorite: (item) => {
        const exists = get().sentenceFavorites.some((fav) => fav.id === item.id);
        if (exists) {
          const deletedAt = Date.now();
          set((state) => ({
            sentenceFavorites: state.sentenceFavorites.filter(
              (fav) => fav.id !== item.id
            ),
            sentenceTombstones: {
              ...state.sentenceTombstones,
              [item.id]: deletedAt,
            },
          }));
          return 'removed';
        }
        if (get().sentenceFavorites.length >= SENTENCE_FAVORITE_LIMIT) {
          return 'limit';
        }
        set((state) => {
          const tombstones = { ...state.sentenceTombstones };
          delete tombstones[item.id];
          return {
            sentenceFavorites: [item, ...state.sentenceFavorites].slice(
              0,
              SENTENCE_FAVORITE_LIMIT
            ),
            sentenceTombstones: tombstones,
          };
        });
        return 'added';
      },
      removeSentenceFavorite: (id) => {
        const deletedAt = Date.now();
        set((state) => ({
          sentenceFavorites: state.sentenceFavorites.filter((fav) => fav.id !== id),
          sentenceTombstones: { ...state.sentenceTombstones, [id]: deletedAt },
        }));
      },
      removeSentenceFavorites: (ids) => {
        const targets = new Set(ids);
        const deletedAt = Date.now();
        set((state) => {
          const tombstones = { ...state.sentenceTombstones };
          for (const id of targets) tombstones[id] = deletedAt;
          return {
            sentenceFavorites: state.sentenceFavorites.filter(
              (fav) => !targets.has(fav.id)
            ),
            sentenceTombstones: tombstones,
          };
        });
      },
      replaceSentenceSync: (items, tombstones) =>
        set({
          sentenceFavorites: items
            .map((item) => ({ ...item }))
            .slice(0, SENTENCE_FAVORITE_LIMIT),
          sentenceTombstones: { ...tombstones },
        }),
      recordHistory: (item) =>
        set((state) => {
          const previous = state.history.find(
            (entry) => entry.videoId === item.videoId
          );
          const merged = mergeHistoryEntry(previous, item, Date.now());
          const others = state.history.filter(
            (entry) => entry.videoId !== item.videoId
          );
          // Watching again cancels a pending delete for this video.
          const tombstones = { ...state.historyTombstones };
          delete tombstones[item.videoId];
          return {
            history: [merged, ...others].slice(0, HISTORY_LIMIT),
            historyTombstones: tombstones,
          };
        }),
      removeHistory: (videoIds) => {
        const targets = new Set(videoIds);
        const deletedAt = Date.now();
        set((state) => {
          const tombstones = { ...state.historyTombstones };
          for (const videoId of targets) tombstones[videoId] = deletedAt;
          return {
            history: state.history.filter((entry) => !targets.has(entry.videoId)),
            historyTombstones: tombstones,
          };
        });
      },
      clearHistory: () => {
        const deletedAt = Date.now();
        set((state) => {
          const tombstones = { ...state.historyTombstones };
          for (const entry of state.history) tombstones[entry.videoId] = deletedAt;
          return { history: [], historyTombstones: tombstones };
        });
      },
      replaceHistorySync: (items, tombstones) =>
        set({
          history: items.slice(0, HISTORY_LIMIT),
          historyTombstones: { ...tombstones },
        }),
      setSync: (syncState, syncMessage = '', at) =>
        set((state) => ({
          syncState,
          syncMessage,
          lastSyncAt: at ?? state.lastSyncAt,
        })),
      setYoutubeLoginStatus: (status, checkedAt) =>
        set({
          youtubeLoginStatus: status,
          youtubeLoginCheckedAt: checkedAt ?? Date.now(),
        }),
      setYoutubeAvatar: (avatar) => set({ youtubeAvatar: avatar }),
    }),
    {
      name: 'kissmobile.app',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        settings: {
          ...state.settings,
          webdav: { ...state.settings.webdav, password: '' },
        },
        subscriptions: state.subscriptions,
        subscriptionTombstones: state.subscriptionTombstones,
        subscriptionOrderUpdatedAt: state.subscriptionOrderUpdatedAt,
        favorites: state.favorites,
        sentenceFavorites: state.sentenceFavorites,
        history: state.history,
        favoriteTombstones: state.favoriteTombstones,
        sentenceTombstones: state.sentenceTombstones,
        historyTombstones: state.historyTombstones,
        lastSyncAt: state.lastSyncAt,
        settingsStamps: state.settingsStamps,
        settingsUpdatedAt: state.settingsUpdatedAt,
        youtubeLoginStatus: state.youtubeLoginStatus,
        youtubeLoginCheckedAt: state.youtubeLoginCheckedAt,
        youtubeAvatar: state.youtubeAvatar,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AppState> | undefined;
        const previousDesign =
          Number(
            (saved?.settings as { designVersion?: number } | undefined)
              ?.designVersion ?? 0
          ) || 0;
        const mergedSettings = migrateSettingsForDesign(
          previousDesign,
          normalizeSettings(deepMerge(DEFAULT_SETTINGS, saved?.settings))
        );
        const settingsUpdatedAt = saved?.settingsUpdatedAt ?? 0;
        const savedStamps = saved?.settingsStamps;
        return {
          ...current,
          settings: mergedSettings,
          settingsStamps:
            savedStamps && Object.keys(savedStamps).length
              ? savedStamps
              : stampsForAllKeys(settingsUpdatedAt),
          subscriptions: withOrder(sortByOrder(saved?.subscriptions ?? [])),
          subscriptionTombstones: saved?.subscriptionTombstones ?? {},
          subscriptionOrderUpdatedAt: saved?.subscriptionOrderUpdatedAt ?? 0,
          favorites: saved?.favorites ?? [],
          sentenceFavorites: saved?.sentenceFavorites ?? [],
          history: saved?.history ?? [],
          favoriteTombstones: saved?.favoriteTombstones ?? {},
          sentenceTombstones: saved?.sentenceTombstones ?? {},
          historyTombstones: saved?.historyTombstones ?? {},
          lastSyncAt: saved?.lastSyncAt ?? 0,
          settingsUpdatedAt,
          youtubeLoginStatus: saved?.youtubeLoginStatus ?? 'unknown',
          youtubeLoginCheckedAt: saved?.youtubeLoginCheckedAt ?? 0,
          youtubeAvatar: saved?.youtubeAvatar ?? '',
        };
      },
      onRehydrateStorage: (currentState) => (state, error) => {
        if (error) {
          console.error('Kissly storage rehydrate failed', error);
        }
        // A corrupt AsyncStorage entry can make `state` undefined. Without this
        // fallback the splash screen would stay up and the app would look dead.
        (state ?? currentState).setHydrated(true);
      },
    }
  )
);

export function getSettings(): Settings {
  return useAppStore.getState().settings;
}

export function getSubscriptions(): Subscription[] {
  return useAppStore.getState().subscriptions;
}
