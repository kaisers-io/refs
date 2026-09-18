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
// Each needs a definition already in the invoking user's own git configuration. A tracked
// repository cannot create one; its `.gitattributes` can only choose when an existing filter
// applies. So this reports rather than refuses, and refs does not discard the ambient
// configuration — the same configuration carries the credential helpers, proxies and `insteadOf`
// rules a private clone needs.
//
// What this does NOT do is judge whether a particular command is dangerous. An earlier version
// reported only commands that looked repository-relative, which is unsound in both directions and
// was measured to be: `/bin/sh ./evil.sh` has an absolute first token and runs the checkout's
// script anyway, while `"/usr/local/bin/linter"` is absolute and would have been reported because
// of the quote. Deciding safety would mean proving an arbitrary interpreter never loads checkout
// content. Presence is decidable; safety is not — so presence is what this reports, and `ok` means
// the configuration defines none of these at all.

const SUCCESS_EXIT_CODE = 0;
const NAME = 'git-exec-surfaces';
const NOT_FOUND = -1;
// One entry is two NUL-separated fields: the scope, then `<key>\n<value>`.
const FIELDS_PER_ENTRY = 2;

// A subsection name may itself contain dots — `[hook "company.checkout"]` is valid — so the
// subsection is everything between the section and the final property. A narrower `[^.]+` missed
// exactly that shape, which was measured to run.
const HOOK_COMMAND = /^hook\.(?<label>.+)\.command$/u;
const HOOK_ENABLED = /^hook\.(?<label>.+)\.enabled$/u;
const FILTER_COMMAND = /^filter\..+\.(?:clean|smudge|process)$/u;
const FSMONITOR = 'core.fsmonitor';

// `core.fsmonitor` takes a boolean OR a command, and git runs the command form with its working
// directory set to the worktree. Only the command form is an execution surface.
const FSMONITOR_BOOLEAN = new Set(['', '0', '1', 'false', 'no', 'off', 'on', 'true', 'yes']);

type ConfigEntry = { key: string; scope: string; value: string };

/** `git config --list -z --show-scope` records: `<scope>\0<key>\n<value>\0`, so the NUL-separated
 * fields alternate between a scope and a key/value pair.
 *
 * `-z` is not optional. A configured hook's value is a command line, and a command line can carry
 * a newline — which a line-oriented parse would turn into a second, bogus key. `--show-scope` is
 * how `local` is excluded without depending on where this ran: `--global --system` together is not
 * something git accepts (`error: only one config file at a time`), and `--system` alone fails
 * outright on a machine with no `/etc/gitconfig`. Both measured. */
const parseScopedConfig = (stdout: string): ConfigEntry[] => {
  const fields = stdout.split('\0');
  const entries: ConfigEntry[] = [];
  for (let index = 0; index + 1 < fields.length; index += FIELDS_PER_ENTRY) {
    /* v8 ignore next 2 -- the loop guard already proves both indices are in range; the fallbacks
       exist only because `noUncheckedIndexedAccess` cannot see that. */
    const record = fields[index + 1] ?? '';
    const scope = fields[index] ?? '';
    // A record with no newline is a key git wrote with no value — `[core]` then a bare `bare`.
    const at = record.indexOf('\n');
    const key = at === NOT_FOUND ? record : record.slice(0, at);
    const value = at === NOT_FOUND ? '' : record.slice(at + 1);
    entries.push({ key, scope, value });
  }
  return entries;
};

/** Hook labels git will not run. A later value wins, so the last `enabled` for a label decides. */
const disabledHooks = (entries: readonly ConfigEntry[]): Set<string> => {
  const enabled = new Map<string, boolean>();
  for (const entry of entries) {
    const label = HOOK_ENABLED.exec(entry.key)?.groups?.['label'];
    if (label !== undefined) {
      enabled.set(label, entry.value !== 'false');
    }
  }
  return new Set([...enabled].filter(([, isOn]) => !isOn).map(([label]) => label));
};

const isExecutionSurface = (entry: ConfigEntry, disabled: ReadonlySet<string>): boolean => {
  if (entry.key === FSMONITOR) {
    return !FSMONITOR_BOOLEAN.has(entry.value.trim().toLowerCase());
  }
  const label = HOOK_COMMAND.exec(entry.key)?.groups?.['label'];
  if (label !== undefined) {
    return !disabled.has(label);
  }
  return FILTER_COMMAND.test(entry.key);
};

/** A checkout's own `.git/config` is excluded: refs clones the repository itself, a tracked
 * repository cannot write there, and refs pins `core.hooksPath` in exactly that file. */
const surfaceKeys = (stdout: string): string[] => {
  const entries = parseScopedConfig(stdout).filter((entry) => entry.scope !== 'local');
  const disabled = disabledHooks(entries);
  const keys = entries
    .filter((entry) => isExecutionSurface(entry, disabled))
    .map((entry) => entry.key);
  return [...new Set(keys)];
};

// `RunResult.stdoutTruncated`: a listing cut at the runner's byte cap keeps the FIRST entries, so
// it reads as a complete, shorter configuration — and the entry that matters may be past the cut.
const unverifiable = (why: string): CheckResult => ({
  detail: `${why}, so this could not be checked`,
  name: NAME,
  status: 'warn',
});

const foundSurfaces = (keys: readonly string[]): CheckResult => ({
  detail:
    `${keys.join(', ')}: git runs these itself, and the managed hooks path does not cover them — ` +
    `a configured hook fires on the events refs causes, a filter is selected by a checkout's own ` +
    `.gitattributes, and fsmonitor runs in the worktree. Whether one of them reaches a checkout's ` +
    `content depends on the command, which refs cannot decide for you`,
  name: NAME,
  status: 'warn',
});

/** Reads the configuration refs' own git invocations inherit and reports what in it git can be
 * made to run. Read from a fixed directory, so the answer does not depend on where `doctor` was
 * invoked — which also makes it a BASELINE: an `includeIf "gitdir:…"` section can add entries
 * inside a managed checkout that this listing does not show. */
const checkGitExecSurfaces = async (ctx: CliContext, cwd: string): Promise<CheckResult> => {
  const result = await ctx.runner.run('git', ['config', '--list', '-z', '--show-scope'], { cwd });
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    return unverifiable('the git configuration could not be read');
  }
  if (result.stdoutTruncated === true) {
    return unverifiable('the git configuration was too large to read whole');
  }
  const keys = surfaceKeys(result.stdout);
  return keys.length === 0
    ? {
        detail: 'no configured hook, filter or fsmonitor command outside a checkout',
        name: NAME,
        status: 'ok',
      }
    : foundSurfaces(keys);
};

export { checkGitExecSurfaces };
