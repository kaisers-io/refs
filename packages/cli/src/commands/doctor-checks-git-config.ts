import { surfaceDetail, surfaceKeys } from './git-exec-surfaces.ts';
import type { CheckResult } from './doctor-types.ts';
import type { CliContext } from '../context.ts';

// `git-exec-surfaces` — the git configuration that decides what a git invocation runs, beyond the
// hooks directory refs pins.
//
// `core.hooksPath` is the project's stated code-execution boundary for checkouts, and within its
// own terms it holds: it governs hooks-DIRECTORY discovery, so a hook file inside a checkout never
// runs. Other mechanisms do not route through it. Measured on git 2.54 against a real clone with
// `core.hooksPath` correctly pinned at a refs-owned directory:
//
//   [hook "x"] event = post-checkout ; command = ./evil.sh
//     -> ran during `refs add` and during `refs sync`
//   [filter "y"] smudge = ./filter.sh   (selected by the checkout's own .gitattributes)
//     -> ran during the checkout `refs sync` performs
//
// Since #194 refs switches two of these off for its own invocations — fsmonitor on every git, and
// configured hooks on git 2.55 and later (core's `git-exec-policy.ts`) — so what is left to report
// is filters, and configured hooks on git 2.54. `git-exec-surfaces.ts` holds that reading.
//
// Each needs a definition already in the invoking user's own git configuration. A tracked
// repository cannot create one; its `.gitattributes` can only choose when an existing filter
// applies. So this reports rather than refuses, and refs does not discard the ambient
// configuration — the same configuration carries the credential helpers, proxies and `insteadOf`
// rules a private clone needs.

const SUCCESS_EXIT_CODE = 0;
const NAME = 'git-exec-surfaces';

// `RunResult.stdoutTruncated`: a listing cut at the runner's byte cap keeps the FIRST entries, so
// it reads as a complete, shorter configuration — and the entry that matters may be past the cut.
const unverifiable = (why: string): CheckResult => ({
  detail: `${why}, so this could not be checked`,
  name: NAME,
  status: 'warn',
});

/** Reads the configuration refs' own git invocations inherit and reports what in it git can be
 * made to run. Read from a fixed directory, so the answer does not depend on where `doctor` was
 * invoked — which also makes it a BASELINE: an `includeIf "gitdir:…"` section can add entries
 * inside a managed checkout that this listing does not show.
 *
 * `versionLine` is `git --version`'s output, which decides whether a configured hook can still
 * fire; `doctor` passes the one its `git` check already read. */
const checkGitExecSurfaces = async (
  ctx: CliContext,
  cwd: string,
  versionLine: string | undefined,
): Promise<CheckResult> => {
  const result = await ctx.runner.run('git', ['config', '--list', '-z', '--show-scope'], { cwd });
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    return unverifiable('the git configuration could not be read');
  }
  if (result.stdoutTruncated === true) {
    return unverifiable('the git configuration was too large to read whole');
  }
  const keys = surfaceKeys(result.stdout, versionLine);
  return keys.length === 0
    ? {
        detail: 'no configured hook, filter or fsmonitor command that refs leaves enabled',
        name: NAME,
        status: 'ok',
      }
    : { detail: surfaceDetail(keys), name: NAME, status: 'warn' };
};

/** The same check, as the warning `add` gives before it clones — `undefined` when it is `ok`.
 *
 * A warning, not protection: it names what will run, it does not stop it. It is read before the
 * clone, so it describes the configuration that clone runs under, but a `--json` reader sees it in
 * the final envelope, after the clone. */
const execSurfacesWarning = async (ctx: CliContext, cwd: string): Promise<string | undefined> => {
  const version = await ctx.runner.run('git', ['--version'], { cwd });
  const versionLine = version.exitCode === SUCCESS_EXIT_CODE ? version.stdout : undefined;
  const check = await checkGitExecSurfaces(ctx, cwd, versionLine);
  return check.status === 'ok' ? undefined : `${NAME}: ${check.detail}`;
};

export { checkGitExecSurfaces, execSurfacesWarning };
