import { activeChildren, installCleanupOnce } from '../../src/proc/spawn-cleanup.ts';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';

// In-process companion to `spawn-runner-cleanup.test.ts`: that suite proves the OS-level effect
// (the real child dies with its parent) across a real three-process chain, but the handler bodies
// themselves execute in the middle process there — outside this runner. Here the installed handler
// is invoked directly in-process to pin its exact mechanics: SIGKILL every active child (even past
// one whose `kill` throws), remove its own listener for that signal, then re-raise the same signal
// so Node's default disposition applies.

type SignalListener = (signal: NodeJS.Signals) => void;

const CLEANUP_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

const listenersFor = (signal: NodeJS.Signals): SignalListener[] =>
  process.listeners(signal) as SignalListener[];

// Install once at module scope and capture the listeners it added by diffing around the call —
// the module deliberately does not export its handlers, and invoking them via a real signal (or
// `process.emit`) would also fire the test runner's own handlers. No teardown: the listeners die
// with this file's isolated worker process.
const installAndDiff = (): Map<NodeJS.Signals, SignalListener[]> => {
  const preInstall = new Map(CLEANUP_SIGNALS.map((signal) => [signal, listenersFor(signal)]));
  installCleanupOnce();
  return new Map(
    CLEANUP_SIGNALS.map((signal) => {
      const known = preInstall.get(signal) ?? [];
      return [signal, listenersFor(signal).filter((listener) => !known.includes(listener))];
    }),
  );
};

const addedListeners = installAndDiff();

const installedHandler = (signal: NodeJS.Signals): SignalListener => {
  const [handler, ...rest] = addedListeners.get(signal) ?? [];
  if (handler === undefined || rest.length > 0) {
    throw new Error(`expected exactly one installed handler for ${signal}`);
  }
  return handler;
};

// A stand-in for a live `ChildProcess`: records every signal its `kill` receives; optionally
// throws afterwards, mimicking a child that already exited (the real `ChildProcess#kill` can
// throw in ESRCH/EPERM edge cases the cleanup must shrug off).
const fakeChild = (received: string[], failure?: Error): ChildProcess =>
  ({
    kill: (signal?: string): boolean => {
      received.push(signal ?? 'none');
      if (failure !== undefined) {
        throw failure;
      }
      return true;
    },
  }) as unknown as ChildProcess;

type FiredScenario = {
  deadChildSignals: string[];
  handlerStillInstalled: boolean;
  liveChildSignals: string[];
  reRaised: readonly unknown[][];
};

// Arms two fake children — the throwing one first, so iteration order proves the loop continues
// past the throw.
const armChildren = (): { deadChildSignals: string[]; liveChildSignals: string[] } => {
  const deadChildSignals: string[] = [];
  const liveChildSignals: string[] = [];
  activeChildren.add(fakeChild(deadChildSignals, new Error('already exited')));
  activeChildren.add(fakeChild(liveChildSignals));
  return { deadChildSignals, liveChildSignals };
};

// Fires the installed SIGTERM handler with `process.kill` stubbed out and reports everything the
// handler did.
const fireSigterm = (): FiredScenario => {
  const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
  const { deadChildSignals, liveChildSignals } = armChildren();
  const handler = installedHandler('SIGTERM');
  try {
    handler('SIGTERM');
    return {
      deadChildSignals,
      handlerStillInstalled: listenersFor('SIGTERM').includes(handler),
      liveChildSignals,
      reRaised: killSpy.mock.calls,
    };
  } finally {
    killSpy.mockRestore();
    activeChildren.clear();
  }
};

describe('spawn-cleanup signal handlers', () => {
  it('sends SIGKILL to every active child, surviving a throwing kill, then re-raises the signal', () => {
    expect.hasAssertions();
    const fired = fireSigterm();
    expect(fired.deadChildSignals).toStrictEqual(['SIGKILL']);
    expect(fired.liveChildSignals).toStrictEqual(['SIGKILL']);
    expect(fired.handlerStillInstalled).toBe(false);
    expect(fired.reRaised).toStrictEqual([[process.pid, 'SIGTERM']]);
  });

  it('leaves the other signals installed after one fires', () => {
    expect.hasAssertions();
    // `fireSigterm` consumed the SIGTERM handler (it removes itself on fire) — SIGINT and SIGHUP
    // must still be armed, each with exactly the one handler the install added.
    expect(listenersFor('SIGINT')).toContain(installedHandler('SIGINT'));
    expect(listenersFor('SIGHUP')).toContain(installedHandler('SIGHUP'));
  });

  it('adds no further listeners when installCleanupOnce is called again', () => {
    expect.hasAssertions();
    const countsBefore = CLEANUP_SIGNALS.map((signal) => process.listenerCount(signal));
    installCleanupOnce();
    expect(CLEANUP_SIGNALS.map((signal) => process.listenerCount(signal))).toStrictEqual(
      countsBefore,
    );
  });
});
