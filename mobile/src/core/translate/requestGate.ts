import type { ProviderId } from '../types';
import { REQUEST_GATE_ENABLED } from './config';

/**
 * Per-provider throttle for translation HTTP calls only. Captions, covers and
 * video metadata requests must never queue behind a subtitle batch.
 *
 * maxInFlight / minIntervalMs are global per provider (not per session), so
 * switching videos cannot reset the limiter.
 */
export type ProviderGateConfig = {
  maxInFlight: number;
  minIntervalMs: number;
  cooldownMs: number;
};

const GATE_CONFIG: Record<ProviderId, ProviderGateConfig> = {
  auto: { maxInFlight: 2, minIntervalMs: 150, cooldownMs: 5000 },
  google: { maxInFlight: 2, minIntervalMs: 200, cooldownMs: 5000 },
  google2: { maxInFlight: 2, minIntervalMs: 150, cooldownMs: 5000 },
  microsoft: { maxInFlight: 2, minIntervalMs: 100, cooldownMs: 3000 },
  deepseek: { maxInFlight: 2, minIntervalMs: 100, cooldownMs: 2000 },
  siliconflow: { maxInFlight: 2, minIntervalMs: 100, cooldownMs: 2000 },
  openrouter: { maxInFlight: 2, minIntervalMs: 100, cooldownMs: 2000 },
  openai: { maxInFlight: 2, minIntervalMs: 100, cooldownMs: 2000 },
  system: { maxInFlight: 2, minIntervalMs: 0, cooldownMs: 0 },
};

export const MAX_COOLDOWN_MS = 30000;

export function providerGateConfig(provider: ProviderId): ProviderGateConfig {
  return GATE_CONFIG[provider] ?? GATE_CONFIG.google2;
}

type GateState = {
  inFlight: number;
  lastStartAt: number;
  cooldownUntil: number;
  waiters: Array<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
};

const gateStates = new Map<ProviderId, GateState>();

function stateFor(provider: ProviderId): GateState {
  let state = gateStates.get(provider);
  if (!state) {
    state = {
      inFlight: 0,
      lastStartAt: 0,
      cooldownUntil: 0,
      waiters: [],
      timer: null,
    };
    gateStates.set(provider, state);
  }
  return state;
}

function pump(provider: ProviderId) {
  const state = stateFor(provider);
  const config = providerGateConfig(provider);
  if (state.timer || !state.waiters.length) return;

  const now = Date.now();
  const readyAt = Math.max(
    state.cooldownUntil,
    state.lastStartAt + config.minIntervalMs
  );
  if (now < readyAt) {
    state.timer = setTimeout(() => {
      state.timer = null;
      pump(provider);
    }, Math.max(1, readyAt - now));
    return;
  }
  if (state.inFlight >= config.maxInFlight) {
    // A finishing request calls pump() again on release.
    return;
  }

  const waiter = state.waiters.shift();
  if (!waiter) return;
  state.inFlight += 1;
  state.lastStartAt = now;
  waiter();
  // Fill the next slot after the minimum interval.
  pump(provider);
}

function acquire(provider: ProviderId): Promise<void> {
  return new Promise<void>((resolve) => {
    stateFor(provider).waiters.push(resolve);
    pump(provider);
  });
}

function release(provider: ProviderId) {
  const state = stateFor(provider);
  state.inFlight = Math.max(0, state.inFlight - 1);
  pump(provider);
}

/** Parse `Retry-After` (seconds or an HTTP date). Returns milliseconds. */
export function parseRetryAfterMs(
  value: unknown,
  now = Date.now()
): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Number(trimmed) * 1000);
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return null;
}

function cooldownFromResult(
  result: unknown,
  config: ProviderGateConfig
): number | null {
  const response = result as
    | { status?: number; headers?: { get?: (name: string) => string | null } }
    | null
    | undefined;
  if (!response || response.status !== 429) return null;
  const headerValue =
    typeof response.headers?.get === 'function'
      ? response.headers.get('retry-after')
      : null;
  return parseRetryAfterMs(headerValue) ?? config.cooldownMs;
}

function cooldownFromError(
  error: unknown,
  config: ProviderGateConfig
): number | null {
  const status = (error as { status?: unknown })?.status;
  if (status !== 429) return null;
  const retryAfter = (error as { retryAfterMs?: unknown })?.retryAfterMs;
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
    return retryAfter;
  }
  return config.cooldownMs;
}

function setCooldown(provider: ProviderId, ms: number | null) {
  if (ms == null) return;
  const state = stateFor(provider);
  const delay = Math.min(MAX_COOLDOWN_MS, Math.max(0, ms));
  if (!delay) return;
  state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + delay);
  pump(provider);
}

/**
 * Wrap a single provider HTTP call. Queueing happens before the call, so the
 * provider's own request timeout starts only once the slot is granted.
 */
export async function withProviderGate<T>(
  provider: ProviderId,
  fn: () => Promise<T>
): Promise<T> {
  if (!REQUEST_GATE_ENABLED) return fn();
  const config = providerGateConfig(provider);
  await acquire(provider);
  try {
    const result = await fn();
    if (typeof result === 'object' && result !== null) {
      setCooldown(provider, cooldownFromResult(result, config));
    }
    return result;
  } catch (error) {
    setCooldown(provider, cooldownFromError(error, config));
    throw error;
  } finally {
    release(provider);
  }
}

/** Test/debug helper: current counters for one engine. */
export function providerGateSnapshot(provider: ProviderId): {
  inFlight: number;
  waiting: number;
  lastStartAt: number;
  cooldownUntil: number;
} {
  const state = stateFor(provider);
  return {
    inFlight: state.inFlight,
    waiting: state.waiters.length,
    lastStartAt: state.lastStartAt,
    cooldownUntil: state.cooldownUntil,
  };
}

/** Test helper: forget every in-flight count and waiting promise. */
export function resetProviderGate() {
  for (const state of gateStates.values()) {
    if (state.timer) clearTimeout(state.timer);
  }
  gateStates.clear();
}
