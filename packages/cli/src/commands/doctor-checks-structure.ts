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

// Deliberately NOT `withLock`'s 10s default. Contention here means a `sync` is holding the ref
// right now, and "a sync is in progress" is a perfectly good answer to report — far better than
// a `doctor` run that stalls ten seconds per contended ref. One retry interval is enough to ride
// out the brief holds `resolve`'s own verification takes.
const DOCTOR_LOCK_TIMEOUT_MS = 100;

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
      return { reason: 'a sync is in progress', status: 'unknown' };
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

const checkConfigDrift = async (home: RefsHome, config: Config): Promise<CheckResult> => {
  const checkouts = existingCheckouts(home, config);
  const probed = await Promise.all(
    checkouts.map(async (item) => ({ item, report: await probeUnderLock(home, config, item) })),
  );
  const lines = probed.flatMap((entry) =>
    driftLines(entry.report).map((line) => `${entry.item.key}: ${line}`),
  );
  return buildResult(lines, checkouts.length);
};

export { checkConfigDrift };
