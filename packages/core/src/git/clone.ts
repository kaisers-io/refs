import type { RunResult, Runner } from '../proc/runner.ts';
import { gitSpec, runOrThrow } from './run-step.ts';
import { rm, stat } from 'node:fs/promises';
import type { CloneMode } from '../schemas/primitives.ts';
import { withCloneArgs } from './clone-args.ts';

// `git clone` for a managed checkout, and what happens to `dest` when it fails. Split out of
// `repo.ts` when cleanup after a failed clone took it past the 300-line cap.

type CloneOpts = {
  cloneUrl: string;
  dest: string;
  mode: CloneMode;
  hooksDir: string;
  /** Deadline for the clone itself; absent means none. See `REFS_NETWORK_TIMEOUT`. */
  networkTimeoutMs?: number;
};

type CloneResult = {
  effectiveMode: CloneMode;
  warning?: string;
};

// Git's wording (git 2.50.1 / Apple Git-155, verified against a plain `file://` remote —
// see repo.test.ts) when the server ignores `--filter=...` and performs a full clone instead.
const FILTER_NOT_HONOURED_PATTERN = /filtering not recognized/iu;

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

// A clone that fails — including one refs stopped at its deadline — can leave `dest` behind with
// `.git` and the managed `core.hooksPath` already written by `clone -c`, which `refs add`'s reuse
// path would then adopt as a finished checkout. So a `dest` this clone created is removed again.
// Only after the runner has returned, which is after the child and every descendant holding its
// output have exited, so nothing is still writing into it; and never a `dest` that existed before,
// so a failure can never delete a checkout refs did not just start.
const cloneOrCleanUp = async (runner: Runner, opts: CloneOpts): Promise<RunResult> => {
  const existed = await exists(opts.dest);
  try {
    return await withCloneArgs(opts, (args) =>
      runOrThrow(runner, {
        ...gitSpec('git clone', args),
        ...(opts.networkTimeoutMs === undefined ? {} : { timeoutMs: opts.networkTimeoutMs }),
      }),
    );
  } catch (error) {
    if (!existed) {
      await rm(opts.dest, { force: true, recursive: true });
    }
    throw error;
  }
};

// `git clone` into `opts.dest` (`--filter=blob:none` when blobless). Some servers (verified: a
// plain `file://` remote without `uploadpack.allowFilter=true`) ignore the filter and warn — that
// downgrades to `effectiveMode: 'full'` + warning.
const cloneRepo = async (runner: Runner, opts: CloneOpts): Promise<CloneResult> => {
  const cloneResult = await cloneOrCleanUp(runner, opts);
  // Kept deliberately, though the clone's own `-c` already wrote it: an older git that does not
  // apply a clone `-c` before checkout would still leave the marker every later guard compares
  // against. Re-writing the same value is idempotent.
  await runOrThrow(
    runner,
    gitSpec('git config core.hooksPath', ['config', 'core.hooksPath', opts.hooksDir], opts.dest),
  );

  const filterIgnored =
    opts.mode === 'blobless' && FILTER_NOT_HONOURED_PATTERN.test(cloneResult.stderr);
  if (!filterIgnored) {
    return { effectiveMode: opts.mode };
  }
  return {
    effectiveMode: 'full',
    warning:
      'server did not honour the partial-clone filter (blob:none); fell back to a full clone',
  };
};

export { cloneRepo };
export type { CloneOpts, CloneResult };
