import type { Config, RefsHome } from '@kaisers-io/refs-core';
import { RefsError, withLock } from '@kaisers-io/refs-core';
import { driftLines, probeRefStructure } from './drift-probe.ts';
import type { CheckResult } from './doctor-types.ts';
import type { ExistingCheckout } from './doctor-checks-checkouts.ts';
import type { StructureReport } from './drift-probe.ts';
import { existingCheckouts } from './doctor-checks-checkouts.ts';
import { refLockName } from './add-source.ts';

// The `config-drift` check: does every configured package still live where the config says it
// does, across every checkout that exists?
//
// `sync` probes the same thing, but only for refs it actually syncs — `--stale-only` filters
// fresh refs out before the batch even starts, and `refs sync <one-ref>` inspects that one ref.
// So the sync-side probe is opportunistic by construction, and this is the deliberate "check
// everything now" entry point. `refs list` deliberately stays blind: without persisted state it
// would have to run this same locking filesystem sweep, and a cheap inventory command must stay
// cheap.

// Deliberately NOT `withLock`'s 10s default. Contention means another refs process holds the ref
// right now, and saying so is a perfectly good answer — far better than a `doctor` run that stalls
// ten seconds per contended ref. One retry interval is enough to ride out the brief holds
// `resolve`'s own verification takes.
const DOCTOR_LOCK_TIMEOUT_MS = 100;

// Deliberately does not name `sync`. The per-ref lock is also held by `add`, `remove` and
// `resolve`'s verification, and nothing in the lock records which command took it — so naming one
// would be a diagnosis the check cannot make. This mirrors `lock.ts`'s own contention wording.
const CONTENDED_REASON = 'another refs process is holding this ref';

/** Takes the per-ref lock so a concurrent `sync` cannot `reset --hard` the tree between two
 * package reads and produce a report describing two different states. Nothing is written, so no
 * home lock is involved.
 *
 * Only the lock CONFLICT becomes a reported `unknown`; any other failure propagates to `doctor`'s
 * own step wrapper, which reports this one check as `fail` while every other check still runs.
 * Swallowing those here would dress a defect up as "could not check". */
const probeUnderLock = async (
  home: RefsHome,
  config: Config,
  item: ExistingCheckout,
): Promise<StructureReport> => {
  try {
    return await withLock(
      home,
      refLockName(item.key),
      () => probeRefStructure(item.dest, config.refs[item.key]?.packages),
      { timeoutMs: DOCTOR_LOCK_TIMEOUT_MS },
    );
  } catch (error) {
    if (error instanceof RefsError && error.code === 'conflict') {
      return { reason: CONTENDED_REASON, status: 'unknown' };
    }
    throw error;
  }
};

const CHECK_NAME = 'config-drift';
const SEPARATOR = '; ';

const buildResult = (lines: readonly string[], checkoutCount: number): CheckResult => {
  const [first] = lines;
  if (first === undefined) {
    return {
      detail: `every configured package path resolves in ${checkoutCount} checkout(s)`,
      name: CHECK_NAME,
      status: 'ok',
    };
  }
  // `warn`, not `fail`: nothing in refs is broken. The configuration has fallen behind the
  // upstream repository, which is a thing to fix, not a thing that stops working — the same
  // reading `orphans` applies to its own findings. A `warn` also keeps `doctor`'s exit code at 0,
  // so drift never breaks a script that runs `refs doctor` as a gate.
  return { detail: lines.join(SEPARATOR), name: CHECK_NAME, status: 'warn' };
};

/** One ref at a time, never `Promise.all` — the same rule `doctor.ts` applies to its own steps.
 * It was once load-bearing here too, because `refLockName` could derive one lock name from two
 * legal ref keys and a single `doctor` run could then contend with itself; `refLockName` is
 * injective since #79, so this is now consistency rather than correctness. Each probe is a handful
 * of milliseconds, so serializing costs nothing worth having either way.
 *
 * Recursive rather than a loop, mirroring `doctor.ts#runStepsInOrder`: every await stays a plain
 * sequential step, and async recursion does not grow the stack. */
const probeInOrder = async (
  home: RefsHome,
  config: Config,
  checkouts: readonly ExistingCheckout[],
): Promise<string[]> => {
  const [item, ...rest] = checkouts;
  if (item === undefined) {
    return [];
  }
  const report = await probeUnderLock(home, config, item);
  const remaining = await probeInOrder(home, config, rest);
  return [...driftLines(report).map((line) => `${item.key}: ${line}`), ...remaining];
};

const checkConfigDrift = async (home: RefsHome, config: Config): Promise<CheckResult> => {
  const checkouts = existingCheckouts(home, config);
  return buildResult(await probeInOrder(home, config, checkouts), checkouts.length);
};

export { checkConfigDrift };
