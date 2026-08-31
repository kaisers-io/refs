import { canonicalizeGitUrl, resolveInside } from '@kaisers-io/refs-core';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readGitConfigValues } from './git-config-read.ts';

// Establishing that the path `refs resolve` is about to hand back really is the checkout it claims.
//
// Until now `resolve` reported presence from `existsSync(dir/.git)` alone, while `add` and `sync`
// both ran the stronger managed-checkout guard. So the one command whose result goes straight to a
// consumer as "read here" was the one that did not check what was there. The realistic failure is
// mundane — a manual clone at the derived path, a half-finished `remove`, a restored backup, a
// symlinked second home — and its shape is a confused deputy: source is read, `path:line` is cited,
// and nothing reports an error.
//
// The check is spawn-free on purpose. `resolve` runs on the hot path of every source question and
// starts no subprocess today; both identifying values are read out of `.git/config` directly
// (`git-config-read.ts`).

const MARKER_KEY = 'core.hookspath';
const ORIGIN_KEY = 'remote.origin.url';
const WANTED = [MARKER_KEY, ORIGIN_KEY];
const ONE = 1;

type CheckoutStatus = 'managed' | 'missing' | 'unmanaged' | 'unverifiable';

type CheckoutInfo = {
  /** Short, stable slug — never free prose, and never the origin url, which can carry credentials.
   * Callers branch on `status`; this says which of its several causes applied. */
  reason?: string;
  status: CheckoutStatus;
};

const managed: CheckoutInfo = { status: 'managed' };
const missing: CheckoutInfo = { status: 'missing' };
const unmanaged = (reason: string): CheckoutInfo => ({ reason, status: 'unmanaged' });
const unverifiable = (reason: string): CheckoutInfo => ({ reason, status: 'unverifiable' });

type InspectOpts = {
  allowFileUrls: boolean;
  dest: string;
  expectedUrl: string;
  /** This home's hooks directory — the exact value `cloneRepo` stamps into a checkout it creates. */
  hooksDir: string;
  sourcesDir: string;
};

/** The `.git` entry's shape, or a verdict when it is not a usable directory.
 *
 * A `.git` FILE is how git records a worktree or submodule, and a symlink is not something refs
 * ever creates — neither can hold the config this check needs, and neither is a checkout refs
 * produced. Both are reported rather than followed. */
// Absence and "could not look" are different answers, and only the first is evidence. Collapsing
// them lets a permissions fault read as an empty home — and, worse, lets `--sync-if-stale` past the
// preflight that exists to refuse a path whose state is unknown.
const NOT_THERE = new Set(['ENOENT', 'ENOTDIR']);

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

const probe = async (path: string): Promise<'absent' | 'present' | 'unreadable'> => {
  try {
    await lstat(path);
    return 'present';
  } catch (error) {
    const code = errorCode(error);
    return code !== undefined && NOT_THERE.has(code) ? 'absent' : 'unreadable';
  }
};

const gitDirVerdict = async (dest: string): Promise<CheckoutInfo | undefined> => {
  try {
    const info = await lstat(join(dest, '.git'));
    if (info.isSymbolicLink()) {
      return unmanaged('git_is_symlink');
    }
    if (!info.isDirectory()) {
      return unmanaged('git_is_file');
    }
    return undefined;
  } catch (error) {
    // Containment already established that `dest` itself resolves, so reaching here means the
    // DIRECTORY exists and `.git` does not. That is not a missing checkout — it is an occupied
    // path, and calling it `missing` would both let package verification run against whatever it
    // contains and invite a clone into a directory that is not empty.
    const code = errorCode(error);
    return code !== undefined && NOT_THERE.has(code)
      ? unmanaged('no_git')
      : unverifiable('git_unreadable');
  }
};

/** The single value recorded for `key`, or `undefined` when it is absent, empty, or set more than
 * once. A duplicate fails closed rather than picking first-or-last: refs-created checkouts carry
 * exactly one of each, so two means something else wrote this config and guessing which one git
 * would honour is not a safe basis for handing out a path. */
const singleValue = (values: ReadonlyMap<string, string[]>, key: string): string | undefined => {
  const found = values.get(key);
  if (found === undefined || found.length !== ONE) {
    return undefined;
  }
  const [only] = found;
  return only === undefined || only === '' ? undefined : only;
};

/** Whether the recorded origin denotes the same repository as `expectedUrl`, compared through
 * `canonicalizeGitUrl`'s canonical key rather than by byte equality — the same comparison
 * `add`'s origin guard makes, so the two commands cannot disagree about repository identity.
 *
 * A url that fails to canonicalize counts as a mismatch: failing closed on something unparseable is
 * the point of the check. */
const sameRepository = (actual: string, expected: string, allowFileUrls: boolean): boolean => {
  try {
    return (
      canonicalizeGitUrl(actual, { allowFileUrls }).key ===
      canonicalizeGitUrl(expected, { allowFileUrls }).key
    );
  } catch {
    return false;
  }
};

const hasDuplicates = (values: ReadonlyMap<string, string[]>): boolean =>
  (values.get(MARKER_KEY)?.length ?? 0) > ONE || (values.get(ORIGIN_KEY)?.length ?? 0) > ONE;

const verdictFromConfig = (text: string, opts: InspectOpts): CheckoutInfo => {
  const values = readGitConfigValues(text, WANTED);
  if (values === undefined) {
    // A file git itself would reject is not evidence of anything, least of all identity. Accepting
    // it would let a corrupt or crafted config still produce the marker and origin, and so still be
    // reported as a managed checkout.
    return unverifiable('config_malformed');
  }
  return hasDuplicates(values)
    ? unverifiable('duplicate_config_values')
    : verdictFromValues(values, opts);
};

/** The identity decision itself, once the config has been read and accepted. */
const verdictFromValues = (
  values: ReadonlyMap<string, string[]>,
  opts: InspectOpts,
): CheckoutInfo => {
  // The marker must be THIS home's hooks directory, not merely present. `add` compares it exactly
  // for the same reason: a manual clone that sets `core.hooksPath` for its own purposes (Husky,
  // say) would otherwise pass as refs-managed, and `sync` would hard-reset it.
  if (singleValue(values, MARKER_KEY) !== opts.hooksDir) {
    return unmanaged('no_refs_marker');
  }
  const origin = singleValue(values, ORIGIN_KEY);
  if (origin === undefined) {
    return unmanaged('no_origin');
  }
  // The url itself never reaches the caller: it can carry credentials, which `add`'s own guard
  // redacts for the same reason.
  return sameRepository(origin, opts.expectedUrl, opts.allowFileUrls)
    ? managed
    : unmanaged('origin_mismatch');
};

// Containment comes before any read: a symlinked ancestor can point outside the managed tree
// entirely, and `sync` refuses such a path for exactly that reason. Here it is a status rather than
// a failure — `resolve` reports, it does not mutate.
const CONTAINMENT_VERDICT: Record<'missing' | 'outside' | 'unreadable', CheckoutInfo> = {
  missing,
  outside: unmanaged('outside_sources'),
  unreadable: unverifiable('path_unreadable'),
};

/** What is actually at `dest`. Never throws and never mutates: every outcome, including "could not
 * tell", is a status the caller reports rather than an error that aborts the command. */
/** Containment, plus the one correction `resolveInside` cannot make on its own: it reports an
 * unresolvable ROOT as unreadable, which is right for callers that guard mutations, but a sources
 * directory that does not exist yet is simply a home nothing has been cloned into. That is an
 * absence, not a failure to look. */
const containmentVerdict = async (opts: InspectOpts): Promise<CheckoutInfo | undefined> => {
  const contained = await resolveInside(opts.sourcesDir, opts.dest);
  if (contained.kind === 'inside') {
    return undefined;
  }
  if (contained.kind === 'unreadable') {
    // `resolveInside` cannot tell an absent root from an unreadable one, and the difference matters:
    // a sources directory that does not exist yet is a home nothing has been cloned into, while one
    // that cannot be read is a fault we must not report as emptiness.
    return (await probe(opts.sourcesDir)) === 'absent' ? missing : CONTAINMENT_VERDICT.unreadable;
  }
  return CONTAINMENT_VERDICT[contained.kind];
};

const inspectCheckout = async (opts: InspectOpts): Promise<CheckoutInfo> => {
  const contained = await containmentVerdict(opts);
  if (contained !== undefined) {
    return contained;
  }
  const shape = await gitDirVerdict(opts.dest);
  if (shape !== undefined) {
    return shape;
  }
  try {
    return verdictFromConfig(await readFile(join(opts.dest, '.git', 'config'), 'utf8'), opts);
  } catch {
    // `.git` is a directory but its config cannot be read — permissions, or a truncated repository.
    // Either way nothing about this checkout's identity can be established.
    return unverifiable('config_unreadable');
  }
};

export { inspectCheckout };
export type { CheckoutInfo, CheckoutStatus };
