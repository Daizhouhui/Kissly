// Layout-epoch handshake for the player WebView.
//
// The old code guessed when a rotation had finished: it held all play
// commands for a fixed 650 ms and then fired reconciles at 800 ms and 1800 ms
// from JavaScript. On a real device the resize sequence is:
//
//   lockAsync() -> React re-render -> native layout pass -> Chromium surface
//   resize -> YouTube may pause the <video> shortly after
//
// Those steps are neither ordered the same way nor reliably inside 650 ms,
// so a fixed timer could send "play" straight into the surface recreation
// (stutter) or after YouTube had already paused again (frozen picture).
//
// This module replaces the guess with an observation: a transition starts
// when React knows one is coming, and ends only after the video stage has
// reported a stable size for the current epoch. Every transition carries a
// monotonically increasing epoch so a late "stable" message from an older
// rotation can be dropped instead of resuming the wrong layout.
export type TransitionTrigger =
  | 'orientation-lock'
  | 'rotation'
  | 'app-active'
  | 'focus'
  | 'webview-reload';

export type SettleReason = 'layout' | 'quiet' | 'guard';

export type TransitionGateOptions = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  onStart?: (epoch: number, trigger: TransitionTrigger) => void;
  onSettle: (epoch: number, trigger: TransitionTrigger, reason: SettleReason) => void;
  /** How long the stage must keep one size before we call it stable. */
  quietMs?: number;
  /** Hard cap: a transition never outlives this, even if layout never arrives. */
  guardMs?: number;
};

export type BeginOptions = {
  /**
   * `true`  - the caller expects the stage to be re-laid out (rotation,
   *           fullscreen toggle): wait for a layout report.
   * `false` - no resize expected (app foreground): close after quietMs.
   */
  expectLayout?: boolean;
  /**
   * `true` - a fullscreen toggle first changes the React layout and only
   *           later the physical rotation resizes the surface. In that case
   *           a layout quiet window alone is not enough: the gate also waits
   *           for the window dimensions to change, otherwise it would resume
   *           playback just before the real resize and produce the stutter.
   */
  expectRotation?: boolean;
};

export type TransitionGate = {
  begin(trigger: TransitionTrigger, options?: BeginOptions): number;
  observeLayout(width: number, height: number): void;
  /** The window dimensions changed: the device really rotated. */
  observeRotation(): void;
  isActive(): boolean;
  epoch(): number;
  dispose(): void;
};

const DEFAULT_QUIET_MS = 140;
const DEFAULT_GUARD_MS = 1200;

export function createTransitionGate(options: TransitionGateOptions): TransitionGate {
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
  const guardMs = options.guardMs ?? DEFAULT_GUARD_MS;

  let currentEpoch = 0;
  let active = false;
  let trigger: TransitionTrigger = 'rotation';
  let lastSize: { width: number; height: number } | null = null;
  let quietTimer: unknown = null;
  let guardTimer: unknown = null;
  let expectLayout = false;
  let expectRotation = false;
  let layoutSeen = false;
  let rotationSeen = false;

  const clearTimers = () => {
    if (quietTimer != null) {
      options.clearTimeout(quietTimer);
      quietTimer = null;
    }
    if (guardTimer != null) {
      options.clearTimeout(guardTimer);
      guardTimer = null;
    }
  };

  const readyToSettle = () => {
    if (expectLayout && !layoutSeen) return false;
    if (expectRotation && !rotationSeen) return false;
    return true;
  };

  const settle = (reason: SettleReason, epoch: number, source: TransitionTrigger) => {
    clearTimers();
    if (!active || epoch !== currentEpoch) return;
    active = false;
    options.onSettle(epoch, source, reason);
  };

  const armQuiet = (epoch: number, source: TransitionTrigger) => {
    if (quietTimer != null) options.clearTimeout(quietTimer);
    quietTimer = options.setTimeout(() => {
      quietTimer = null;
      if (!readyToSettle()) return;
      settle('quiet', epoch, source);
    }, quietMs);
  };

  return {
    begin(nextTrigger, beginOptions) {
      clearTimers();
      currentEpoch += 1;
      active = true;
      trigger = nextTrigger;
      expectLayout = beginOptions?.expectLayout ?? true;
      expectRotation = beginOptions?.expectRotation ?? false;
      layoutSeen = false;
      rotationSeen = false;
      // A layout report after begin must extend the quiet window, even if the
      // numbers happen to match the previous rotation's.
      lastSize = null;
      guardTimer = options.setTimeout(() => {
        guardTimer = null;
        settle('guard', currentEpoch, trigger);
      }, guardMs);
      if (!expectLayout && !expectRotation) armQuiet(currentEpoch, trigger);
      options.onStart?.(currentEpoch, trigger);
      return currentEpoch;
    },

    observeLayout(width, height) {
      if (!active) return;
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      if (width <= 0 || height <= 0) return;
      if (lastSize && lastSize.width === width && lastSize.height === height) {
        return;
      }
      lastSize = { width, height };
      layoutSeen = true;
      if (readyToSettle()) armQuiet(currentEpoch, trigger);
    },

    observeRotation() {
      if (!active) return;
      rotationSeen = true;
      // The rotation may arrive after the React layout change, in which case
      // the surface still has one more layout pass to report.
      if (layoutSeen || !expectLayout) armQuiet(currentEpoch, trigger);
    },

    isActive: () => active,
    epoch: () => currentEpoch,
    dispose() {
      clearTimers();
      active = false;
    },
  };
}
