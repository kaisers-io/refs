import type { ChildProcess } from 'node:child_process';

// Parent-death cleanup for `SpawnRunner`'s children (runner.ts): ensures no spawned git/ssh
// process outlives the CLI itself.
//
// When `refs`'s own process is killed mid-command (Ctrl-C, `kill`, a terminal hangup), whatever
// git/ssh child a `run()` call is waiting on must not become an orphan that keeps a partial clone
// or lock alive after the CLI itself is gone — process-cleanup libraries in the wider ecosystem
// solve this with a `signal-exit`-style shared hook; this is a hand-rolled, much narrower version
// of the same idea, scoped to exactly what `SpawnRunner` needs:
//
// - `activeChildren` is a process-wide, module-level `Set` (NOT scoped to a `SpawnRunner`
//   instance) — every live child gets added right after `spawn()` and removed once its `close`
//   event fires. The cleanup below iterates this one set regardless of which `Runner` instance
//   started which child.
// - Signal handlers for `SIGINT`/`SIGTERM`/`SIGHUP`/`SIGBREAK` are installed exactly once,
//   lazily, on the first `run()` call ever made — never at module-load time, so merely importing
//   this module never changes a host process's signal behavior for a process that never actually
//   runs a command.
// - Windows mapping: Node emulates `SIGINT` (Ctrl-C) and `SIGHUP` (console close, short grace
//   window); `SIGBREAK` is Ctrl-Break (Windows-only — on POSIX the listener simply never fires);
//   a `SIGTERM` listener installs fine but never fires there (kept for POSIX). The re-raise below
//   terminates the process directly on Windows instead of restoring a default disposition — same
//   observable outcome (children killed, process ends), different numeric exit code. A hard kill
//   (`taskkill /F`) bypasses this cleanup exactly like `kill -9` does on POSIX.
// - On any of those signals: `SIGKILL` every active child (best-effort — a child that
//   already exited just no-ops), remove OUR OWN listener for that exact signal, then re-raise it
//   against this same process (`process.kill(process.pid, signal)`). With our listener gone,
//   Node's default disposition for that signal applies next — the process terminates exactly as
//   it would have if this module had never installed anything. This is the crux of "preserve
//   default exit codes/behavior": the only observable side effect this adds is the child cleanup,
//   never a change to how the CLI process itself exits.
// - `process.on('exit', ...)` is also wired, for the plain synchronous-shutdown case (e.g. an
//   uncaught throw unwinds normally to `process.exit`) — `ChildProcess#kill()` is a synchronous
//   syscall, safe to call from an `'exit'` handler.
// - Deliberately NOT hooking `uncaughtException`/`unhandledRejection`: either would change crash
//   semantics (Node's default is to print and exit 1), which is outside this seam's job. Leaking a
//   child on a bug this module doesn't otherwise handle is an acceptable trade for never turning a
//   silent crash into a different one.

const activeChildren = new Set<ChildProcess>();
let cleanupInstalled = false;

const killActiveChildren = (): void => {
  for (const child of activeChildren) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already dead (or never really started) — nothing left to clean up.
    }
  }
};

const CLEANUP_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'];

const installCleanupSignal = (signal: NodeJS.Signals): void => {
  const handler = (): void => {
    killActiveChildren();
    process.removeListener(signal, handler);
    process.kill(process.pid, signal);
  };
  process.on(signal, handler);
};

const installCleanupOnce = (): void => {
  if (cleanupInstalled) {
    return;
  }
  cleanupInstalled = true;
  CLEANUP_SIGNALS.forEach((signal) => {
    installCleanupSignal(signal);
  });
  process.on('exit', killActiveChildren);
};

export { activeChildren, installCleanupOnce };
