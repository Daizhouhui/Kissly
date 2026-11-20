import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_SETTINGS } from './defaults';
import { FavoriteItem, Settings, Subscription } from './types';

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

export type SyncState = 'idle' | 'syncing' | 'ok' | 'error';

type SubscriptionTombstones = Record<string, number>;

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
  settingsUpdatedAt: number;
  subscriptions: Subscription[];
  subscriptionTombstones: SubscriptionTombstones;
  subscriptionOrderUpdatedAt: number;
  favorites: FavoriteItem[];
  history: FavoriteItem[];
  lastSyncAt: number;
  syncState: SyncState;
  syncMessage: string;
  setHydrated: (value: boolean) => void;
  patchSettings: (patch: DeepPartial<Settings>) => void;
  replaceSettings: (settings: Settings, updatedAt?: number) => void;
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
  recordHistory: (item: FavoriteItem) => void;
  clearHistory: () => void;
  setSync: (state: SyncState, message?: string, at?: number) => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      settings: DEFAULT_SETTINGS,
      settingsUpdatedAt: 0,
      subscriptions: [],
      subscriptionTombstones: {},
      subscriptionOrderUpdatedAt: 0,
      favorites: [],
      history: [],
      lastSyncAt: 0,
      syncState: 'idle',
      syncMessage: '',
      setHydrated: (value) => set({ hydrated: value }),
      patchSettings: (patch) =>
        set((state) => ({
          settings: deepMerge(state.settings, patch),
          settingsUpdatedAt: Date.now(),
        })),
      replaceSettings: (settings, updatedAt) =>
        set({
          settings: deepMerge(DEFAULT_SETTINGS, settings),
          settingsUpdatedAt: updatedAt ?? Date.now(),
        }),
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
          set((state) => ({
            favorites: state.favorites.filter((fav) => fav.videoId !== item.videoId),
          }));
          return false;
        }
        set((state) => ({ favorites: [item, ...state.favorites] }));
        return true;
      },
      removeFavorite: (videoId) =>
        set((state) => ({
          favorites: state.favorites.filter((fav) => fav.videoId !== videoId),
        })),
      recordHistory: (item) =>
        set((state) => {
          const others = state.history.filter((entry) => entry.videoId !== item.videoId);
          return { history: [item, ...others].slice(0, 120) };
        }),
      clearHistory: () => set({ history: [] }),
      setSync: (syncState, syncMessage = '', at) =>
        set((state) => ({
          syncState,
          syncMessage,
          lastSyncAt: at ?? state.lastSyncAt,
        })),
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
        history: state.history,
        lastSyncAt: state.lastSyncAt,
        settingsUpdatedAt: state.settingsUpdatedAt,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AppState> | undefined;
        const legacyDesign =
          !saved?.settings ||
          !(saved.settings as { designVersion?: number }).designVersion;
        const mergedSettings = deepMerge(DEFAULT_SETTINGS, saved?.settings);
        // 1.x shipped with a blue iOS-like palette. Move existing installs onto
        // the Android-reference violet palette exactly once, while still
        // letting the user pick blue later.
        if (legacyDesign && mergedSettings.themeAccent === 'blue') {
          mergedSettings.themeAccent = 'violet';
        }
        mergedSettings.designVersion = 2;
        return {
          ...current,
          settings: mergedSettings,
          subscriptions: withOrder(sortByOrder(saved?.subscriptions ?? [])),
          subscriptionTombstones: saved?.subscriptionTombstones ?? {},
          subscriptionOrderUpdatedAt: saved?.subscriptionOrderUpdatedAt ?? 0,
          favorites: saved?.favorites ?? [],
          history: saved?.history ?? [],
          lastSyncAt: saved?.lastSyncAt ?? 0,
          settingsUpdatedAt: saved?.settingsUpdatedAt ?? 0,
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
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
