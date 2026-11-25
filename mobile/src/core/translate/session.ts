import { findCueIndexAt } from '../cueIndex';
import { getSettings } from '../store';
import type { Cue, ProviderId } from '../types';
import { loadCachedEntry, saveCached } from '../storage';
import { autoCacheProviders } from './autoOrder';
import {
  collectPendingCueIndices,
  planBackgroundTask,
  planForegroundTasks,
  shouldStartAutoFill,
  translationCoverage,
  type CueTranslationTask,
} from './batching';
import { cueCacheKeyForProvider } from './cacheKey';
import { pickBestCueCache, type CueCachePayload } from './cacheSelection';
import {
  ANCHOR_THROTTLE_MS,
  AUTO_COMPLETE_COVERAGE,
  AUTO_COMPLETE_ENABLED,
  AUTO_COMPLETE_CONCURRENCY,
  CACHE_WRITE_THROTTLE_MS,
  CUE_CACHE_TTL_MS,
  PROGRESS_THROTTLE_MS,
  TRANSLATE_CONCURRENCY,
  TRANSLATE_RETRY_DELAY_MS,
  WINDOW_REFILL_AHEAD_SEC,
  batchSizeForProvider,
} from './config';
import { translateTexts } from './index';
import {
  computeWindow,
  extendWindow,
  isAnchorOutsideWindow,
  isSeekJump,
  needsWindowRefill,
  videoEndSeconds,
  type CueWindow,
} from './window';

export type TranslationPhase = 'idle' | 'window' | 'auto-fill' | 'done';

export type SubtitleProgress = {
  cues: Cue[];
  provider: ProviderId;
  phase: TranslationPhase;
  /** Only the foreground window keeps the player's "translating" state. */
  pending: boolean;
  translated: number;
  total: number;
};

export type PlaybackState = {
  playing: boolean;
  foreground: boolean;
  ad: boolean;
  seeking: boolean;
};

export type SubtitleSessionOptions = {
  videoId: string;
  cues: Cue[];
  trackKey: string;
  contextTitle?: string;
  from?: string;
  to?: string;
  ignoreCache?: boolean;
  initialAnchorTime?: number;
  durationSeconds?: number;
  onProgress?: (progress: SubtitleProgress) => void;
  onError?: (error: unknown, scope: 'window' | 'auto-fill') => void;
};

export type SubtitleTranslationSession = {
  start(): void;
  /** Playback position; internally throttled, safe to call on every tick. */
  setAnchor(time: number): void;
  setPlaybackState(state: PlaybackState): void;
  /** Pause, background, unmount: stop new work, flush the cache. */
  stop(): Promise<void>;
  /** Optional manual full-video entry; no UI calls this today. */
  translateAll(): Promise<void>;
  getProgress(): SubtitleProgress;
};

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function timeoutLike(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  if (
    name === 'AbortError' ||
    name === 'HttpTimeoutError' ||
    name === 'TimeoutError'
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /timeout|timed out|aborted|超时/i.test(message);
}

function retryableBatchError(error: unknown): boolean {
  // The AI layer already splits timed-out batches; replaying the whole batch
  // here would double the worst-case wait. 429 and 5xx deserve one delayed retry.
  if (timeoutLike(error)) return false;
  const status = (error as { status?: unknown })?.status;
  if (typeof status !== 'number') return true;
  return status === 429 || status >= 500;
}

/**
 * A translation session follows the playback position instead of translating
 * the whole video up-front.
 *
 * - The foreground window (≈15s back / 120s ahead, max 40 lines) is translated
 *   by two workers, current line first.
 * - Above 90% coverage the remaining lines are filled by one background task.
 * - Results are merged by original cue index, so a seek never scrambles order.
 * - Cache keys and payload format stay `cues:v4:…` compatible with older builds.
 */
export function createSubtitleSession(
  options: SubtitleSessionOptions
): SubtitleTranslationSession {
  const settings = getSettings();
  const from = options.from ?? settings.sourceLang;
  const to = options.to ?? settings.targetLang;
  const autoMode = settings.provider === 'auto';
  const cues = options.cues;
  const duration = videoEndSeconds(cues, options.durationSeconds);

  const translations: string[] = cues.map(() => '');
  const completed = new Set<number>();
  const inFlight = new Set<number>();
  const failed = new Set<number>();
  const misses = new Map<number, number>();

  let cueWindow: CueWindow | null = null;
  let anchorTime =
    typeof options.initialAnchorTime === 'number' &&
    Number.isFinite(options.initialAnchorTime)
      ? Math.max(0, options.initialAnchorTime)
      : 0;
  let playback: PlaybackState = {
    playing: false,
    foreground: true,
    ad: false,
    seeking: false,
  };
  let provider: ProviderId | null = null;
  let started = false;
  let ready = false;
  let stopped = false;
  let workers = 0;
  let backgroundInFlight = 0;
  let dirty = false;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let anchorTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEmitAt = 0;
  let lastAnchorAt = 0;
  let writeChain: Promise<void> = Promise.resolve();
  const idleWaiters: Array<() => void> = [];

  const currentProvider = (): ProviderId => provider ?? settings.provider;

  const isCueDone = (index: number): boolean =>
    Boolean((translations[index] ?? '').trim());

  const allDone = (): boolean =>
    cues.every((cue, index) => !cue.text?.trim() || isCueDone(index));

  const hasForegroundPending = (): boolean => {
    if (!cueWindow) return false;
    for (let index = cueWindow.startIndex; index <= cueWindow.endIndex; index += 1) {
      if (!cues[index]?.text?.trim()) continue;
      if (isCueDone(index)) continue;
      if (failed.has(index)) continue;
      return true;
    }
    return false;
  };

  const stats = () => translationCoverage(cues, translations);

  const canStartNewTask = (): boolean =>
    !stopped && playback.foreground && !playback.ad && !playback.seeking;

  const canAutoFill = (): boolean =>
    AUTO_COMPLETE_ENABLED &&
    shouldStartAutoFill(
      {
        coverage: stats().coverage,
        foregroundPending: hasForegroundPending(),
        foreground: playback.foreground,
        ad: playback.ad,
        seeking: playback.seeking,
        backgroundInFlight,
        concurrency: AUTO_COMPLETE_CONCURRENCY,
      },
      AUTO_COMPLETE_COVERAGE
    );

  const currentPhase = (): TranslationPhase => {
    if (!ready) return 'idle';
    if (hasForegroundPending()) return 'window';
    if (allDone()) return 'done';
    if (backgroundInFlight > 0 || canAutoFill()) return 'auto-fill';
    return 'idle';
  };

  const buildProgress = (): SubtitleProgress => {
    const summary = stats();
    return {
      cues: cues.map((cue, index) => ({
        ...cue,
        translation: translations[index] ?? '',
      })),
      provider: currentProvider(),
      phase: currentPhase(),
      pending: hasForegroundPending(),
      translated: summary.translated,
      total: summary.total,
    };
  };

  const emitProgress = (force = false) => {
    if (stopped) return;
    const now = Date.now();
    const remaining = PROGRESS_THROTTLE_MS - (now - lastEmitAt);
    if (!force && remaining > 0) {
      if (!emitTimer) {
        emitTimer = setTimeout(() => {
          emitTimer = null;
          emitProgress(true);
        }, remaining);
      }
      return;
    }
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    lastEmitAt = now;
    options.onProgress?.(buildProgress());
  };

  const cacheKeyList = (target: ProviderId): string[] => {
    if (!autoMode) {
      return [cueCacheKeyForProvider(options.videoId, options.trackKey, from, to, settings, target)];
    }
    return [
      cueCacheKeyForProvider(options.videoId, options.trackKey, from, to, settings, 'auto'),
      cueCacheKeyForProvider(options.videoId, options.trackKey, from, to, settings, target),
    ];
  };

  const loadCacheKeys = (): string[] => {
    const providers: ProviderId[] = autoMode
      ? autoCacheProviders()
      : [settings.provider];
    const keys = providers.map((item) =>
      cueCacheKeyForProvider(options.videoId, options.trackKey, from, to, settings, item)
    );
    // Auto mode reuses a translation made with any saved OpenAI-compatible
    // profile, even when another profile is selected now.
    if (autoMode) {
      for (const profile of settings.openaiProfiles) {
        keys.push(
          cueCacheKeyForProvider(
            options.videoId,
            options.trackKey,
            from,
            to,
            {
              ...settings,
              openaiBaseUrl: profile.baseUrl,
              openaiModel: profile.model,
            },
            'openai'
          )
        );
      }
    }
    return Array.from(new Set(keys));
  };

  const loadCache = async () => {
    if (options.ignoreCache) return;
    const entries = await Promise.all(
      loadCacheKeys().map((key) =>
        loadCachedEntry<CueCachePayload>(key, CUE_CACHE_TTL_MS)
      )
    );
    const cached = pickBestCueCache(cues, entries);
    if (!cached) return;
    for (let index = 0; index < cues.length; index += 1) {
      const value = cached.translations[index];
      if (!cues[index]?.text?.trim() || !value?.trim()) continue;
      translations[index] = value;
      completed.add(index);
    }
    provider = cached.provider;
  };

  const saveSnapshot = async (values: string[], actualProvider: ProviderId) => {
    const payload: CueCachePayload = {
      cues: cues.map((cue, index) => ({
        ...cue,
        translation: values[index] ?? '',
      })),
      provider: actualProvider,
    };
    const targets = Array.from(new Set(cacheKeyList(actualProvider)));
    await Promise.all(targets.map((key) => saveCached(key, payload)));
  };

  const flush = (): Promise<void> => {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    if (!dirty) return writeChain;
    dirty = false;
    const snapshot = translations.slice();
    const actualProvider = currentProvider();
    writeChain = writeChain
      .catch(() => {})
      .then(() => saveSnapshot(snapshot, actualProvider))
      .catch(() => {
        // A cache failure only affects the next open; subtitles already shown stay.
      });
    return writeChain;
  };

  const scheduleWrite = () => {
    if (writeTimer || stopped) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      void flush();
    }, CACHE_WRITE_THROTTLE_MS);
  };

  const recordMiss = (index: number) => {
    const count = (misses.get(index) ?? 0) + 1;
    misses.set(index, count);
    // Two empty results mean this line is not going to work this session.
    if (count >= 2) failed.add(index);
  };

  const applyResult = (
    indices: number[],
    texts: string[],
    actualProvider: ProviderId
  ) => {
    indices.forEach((cueIndex, offset) => {
      const value = texts[offset];
      if (typeof value === 'string' && value.trim()) {
        translations[cueIndex] = value;
        completed.add(cueIndex);
        failed.delete(cueIndex);
        misses.delete(cueIndex);
      } else {
        recordMiss(cueIndex);
      }
    });
    provider = actualProvider;
    dirty = true;
    scheduleWrite();
  };

  const pickForegroundTask = (): CueTranslationTask | null => {
    if (!cueWindow) return null;
    // In-flight lines are filtered per task below, not from the whole list: the
    // anchor task's ordering must stay intact for the second worker, otherwise
    // it would jump ahead of the "rewind" batch.
    const pending = collectPendingCueIndices(
      cues,
      translations,
      failed,
      cueWindow.startIndex,
      cueWindow.endIndex
    );
    if (!pending.length) return null;
    const anchorIndex = findCueIndexAt(cues, anchorTime);
    const batchSize = batchSizeForProvider(currentProvider(), false);
    const tasks = planForegroundTasks(pending, anchorIndex, batchSize);
    for (const task of tasks) {
      const free = task.indices.filter((index) => !inFlight.has(index));
      if (free.length) return { indices: free };
    }
    return null;
  };

  const pickBackgroundTask = (): CueTranslationTask | null => {
    if (!canAutoFill()) return null;
    const excluded = new Set<number>(failed);
    inFlight.forEach((index) => excluded.add(index));
    const pending = collectPendingCueIndices(
      cues,
      translations,
      excluded,
      0,
      cues.length - 1
    );
    if (!pending.length) return null;
    return planBackgroundTask(pending, batchSizeForProvider(currentProvider(), true));
  };

  const runTask = async (
    task: CueTranslationTask,
    background: boolean
  ): Promise<void> => {
    const indices = task.indices.filter(
      (index) => !completed.has(index) && !inFlight.has(index) && !failed.has(index)
    );
    if (!indices.length) return;
    indices.forEach((index) => inFlight.add(index));
    if (background) backgroundInFlight += 1;
    const wasPending = hasForegroundPending();

    try {
      const texts = indices.map((index) => cues[index].text);
      let result: { texts: string[]; provider: ProviderId };
      try {
        result = await translateTexts(texts, {
          from,
          to,
          contextTitle: options.contextTitle,
        });
      } catch (error) {
        if (stopped || !retryableBatchError(error)) throw error;
        await wait(TRANSLATE_RETRY_DELAY_MS);
        if (stopped) throw error;
        result = await translateTexts(texts, {
          from,
          to,
          contextTitle: options.contextTitle,
        });
      }
      if (stopped) return;
      applyResult(indices, result.texts, result.provider);
      emitProgress(hasForegroundPending() !== wasPending);
    } catch (error) {
      if (stopped) return;
      indices.forEach((index) => recordMiss(index));
      options.onError?.(error, background ? 'auto-fill' : 'window');
      emitProgress(true);
    } finally {
      indices.forEach((index) => inFlight.delete(index));
      if (background) backgroundInFlight -= 1;
      if (!stopped) {
        // A finished foreground window is a natural checkpoint: flush here, but
        // do not defeat the throttle on every background batch.
        if ((wasPending && !hasForegroundPending()) || allDone()) void flush();
        queueMicrotask(pump);
      }
    }
  };

  const startWorker = () => {
    workers += 1;
    void (async () => {
      try {
        while (!stopped) {
          if (!canStartNewTask()) break;
          const foreground = pickForegroundTask();
          if (foreground) {
            await runTask(foreground, false);
            continue;
          }
          const background = pickBackgroundTask();
          if (background) {
            await runTask(background, true);
            continue;
          }
          break;
        }
      } finally {
        workers -= 1;
        if (!stopped) {
          if (workers === 0) idleWaiters.splice(0).forEach((resolve) => resolve());
          queueMicrotask(pump);
        }
      }
    })();
  };

  function pump() {
    if (stopped || !ready) return;
    if (!canStartNewTask()) return;
    while (workers < TRANSLATE_CONCURRENCY) {
      const hasWork = Boolean(pickForegroundTask() ?? pickBackgroundTask());
      if (!hasWork) return;
      startWorker();
    }
  }

  const applyWindow = () => {
    const next = computeWindow(cues, anchorTime, duration);
    if (!next) return;
    if (!cueWindow) {
      cueWindow = next;
      return;
    }
    if (isSeekJump(cueWindow, anchorTime)) {
      // Old in-flight requests finish and merge by cue index; the new window
      // is picked first by the other worker.
      cueWindow = next;
      return;
    }
    if (isAnchorOutsideWindow(cueWindow, anchorTime)) {
      cueWindow = next;
      return;
    }
    // The window is capped by cue count, so for dense captions the index range
    // can end long before its nominal `endTime`. When playback passes the last
    // translated cue, rebuild around the anchor instead of sitting on a window
    // that no longer contains the current line.
    const anchorIndex = findCueIndexAt(cues, anchorTime);
    if (
      anchorIndex >= 0 &&
      (anchorIndex < cueWindow.startIndex || anchorIndex > cueWindow.endIndex)
    ) {
      cueWindow = next;
      return;
    }
    if (
      needsWindowRefill(cueWindow, anchorTime, duration) &&
      anchorTime + WINDOW_REFILL_AHEAD_SEC > cueWindow.endTime
    ) {
      cueWindow = extendWindow(cueWindow, cues, anchorTime, duration);
    }
  };

  const applyAnchorNow = () => {
    lastAnchorAt = Date.now();
    if (stopped || !ready) return;
    applyWindow();
    emitProgress(false);
    pump();
  };

  const setAnchor = (time: number) => {
    if (stopped || !Number.isFinite(time)) return;
    anchorTime = Math.max(0, time);
    const now = Date.now();
    const remaining = ANCHOR_THROTTLE_MS - (now - lastAnchorAt);
    if (remaining <= 0) {
      applyAnchorNow();
      return;
    }
    if (!anchorTimer) {
      anchorTimer = setTimeout(() => {
        anchorTimer = null;
        applyAnchorNow();
      }, remaining);
    }
  };

  const setPlaybackState = (next: PlaybackState) => {
    if (stopped) return;
    const previous = playback;
    playback = {
      playing: Boolean(next.playing),
      foreground: Boolean(next.foreground),
      ad: Boolean(next.ad),
      seeking: Boolean(next.seeking),
    };
    if ((previous.playing && !playback.playing) || !playback.foreground) {
      void flush();
    }
    if (
      previous.foreground !== playback.foreground ||
      previous.ad !== playback.ad ||
      previous.seeking !== playback.seeking
    ) {
      emitProgress(true);
    }
    pump();
  };

  const waitForIdle = (): Promise<void> => {
    if (workers <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => idleWaiters.push(resolve));
  };

  const start = () => {
    if (started || stopped) return;
    started = true;
    const readyPromise = loadCache()
      .catch(() => {})
      .then(() => {
        if (stopped) return;
        ready = true;
        if (!cueWindow) cueWindow = computeWindow(cues, anchorTime, duration);
        emitProgress(true);
        if (allDone()) {
          void flush();
          return;
        }
        pump();
      });
    void readyPromise;
  };

  const stop = async (): Promise<void> => {
    if (stopped) return flush();
    stopped = true;
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    if (anchorTimer) {
      clearTimeout(anchorTimer);
      anchorTimer = null;
    }
    await Promise.race([waitForIdle(), wait(TRANSLATE_RETRY_DELAY_MS)]);
    await flush();
  };

  const translateAll = async (): Promise<void> => {
    if (stopped) return;
    const pending = collectPendingCueIndices(
      cues,
      translations,
      inFlight,
      0,
      cues.length - 1
    );
    if (!pending.length) {
      await flush();
      return;
    }
    while (!stopped) {
      const batch = collectPendingCueIndices(
        cues,
        translations,
        inFlight,
        0,
        cues.length - 1
      );
      if (!batch.length) break;
      await runTask(
        { indices: batch.slice(0, batchSizeForProvider(currentProvider(), true)) },
        true
      );
    }
    await flush();
  };

  return {
    start,
    setAnchor,
    setPlaybackState,
    stop,
    translateAll,
    getProgress: () => buildProgress(),
  };
}
