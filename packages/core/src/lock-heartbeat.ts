// The lease heartbeat behind `lock.ts`'s advisory lock: while a holder runs its critical section,
// this keeps stamping the lease so a live holder is never mistaken for an abandoned one, however
// long the work takes. Deliberately knows nothing about locks — it takes an injected `renew` and an
// interval, which is what makes it testable on its own without any timing seam on the public
// `withLock`.
//
// Three properties this exists to guarantee:
//
//   1. **Single-flight.** The next attempt is scheduled only after the previous one has SETTLED, so
//      two renewals can never overlap and stamp out of order. A plain `setInterval` would allow
//      exactly that whenever one renewal outlives the interval.
//   2. **Awaited shutdown.** `stop()` cancels future scheduling AND waits for an attempt already in
//      flight. Without the wait, a renewal begun just before release could still be running while
//      the lock is released and re-acquired by someone else.
//   3. **Unref'd.** The timer must never be the reason a finished CLI process stays alive.

// Outcome of one renewal attempt. `'lost'` means ownership is confirmed gone (someone else holds
// this lock now) — a terminal answer. A transient failure is a THROW, not a `'lost'`, so the two
// are never conflated: the first stops the heartbeat for good, the second is retried next tick.
type RenewOutcome = 'lost' | 'renewed';

type Heartbeat = {
  /** True once a renewal confirmed the lock is no longer ours. Latches — it never goes back. */
  ownershipLost: () => boolean;
  /** Cancels further renewals and resolves once any in-flight attempt has settled. Idempotent. */
  stop: () => Promise<void>;
};

type HeartbeatOptions = {
  intervalMs: number;
  renew: () => Promise<RenewOutcome>;
};

// Mutable state as one object rather than a handful of closure `let`s: `inFlight` starts as an
// already-resolved promise so `stop()` can await it unconditionally, and `timer` is simply absent
// until the first arm.
type HeartbeatState = {
  inFlight: Promise<void>;
  lost: boolean;
  stopped: boolean;
  timer?: NodeJS.Timeout;
};

// Mutually recursive with `runTick` below: each completed attempt re-arms the next one. Both are
// plain module-level arrows, so the forward reference resolves at call time, never at definition.
const armTimer = (opts: HeartbeatOptions, state: HeartbeatState): void => {
  if (state.stopped) {
    return;
  }
  const timer = setTimeout(() => {
    // Belt to `stop`'s braces: `stop` sets the flag and clears this timer synchronously, before it
    // awaits anything, so a cleared callback cannot reach here — this guard makes that independent
    // of `clearTimeout`'s timing rather than reliant on it.
    if (state.stopped) {
      return;
    }
    // eslint-disable-next-line no-use-before-define -- mutually recursive with `runTick`; see above
    state.inFlight = runTick(opts, state);
  }, opts.intervalMs);
  // An unref'd timer may not fire when nothing else keeps the loop alive — the right trade: in that
  // situation the process is finished, and holding it open to renew a lock nobody waits on would be
  // the actual bug.
  timer.unref();
  state.timer = timer;
};

const runTick = async (opts: HeartbeatOptions, state: HeartbeatState): Promise<void> => {
  try {
    if ((await opts.renew()) === 'lost') {
      state.lost = true;
      state.stopped = true;
      return;
    }
  } catch {
    // Transient fs failure. Swallowed on purpose: there is still lease margin (the interval is a
    // fraction of the lease), the next tick retries, and an escaping rejection here would surface
    // as an unhandled rejection with no caller to catch it. Confirmed ownership loss travels the
    // `'lost'` branch above instead, and is never inferred from an error.
  }
  armTimer(opts, state);
};

const startHeartbeat = (opts: HeartbeatOptions): Heartbeat => {
  const state: HeartbeatState = { inFlight: Promise.resolve(), lost: false, stopped: false };
  armTimer(opts, state);
  return {
    ownershipLost: () => state.lost,
    stop: async () => {
      state.stopped = true;
      if (state.timer !== undefined) {
        clearTimeout(state.timer);
      }
      await state.inFlight;
    },
  };
};

export { startHeartbeat };
export type { Heartbeat, RenewOutcome };
