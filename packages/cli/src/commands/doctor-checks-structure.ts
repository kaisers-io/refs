import type { Config, RefsHome } from '@kaisers-io/refs-core';
import { RefsError, withLock } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { StructureIssue, StructureReport } from './drift-report.ts';
import type { CheckResult } from './doctor-types.ts';
import type { ExistingCheckout } from './doctor-checks-checkouts.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { driftLines } from './drift-report.ts';
import { existingCheckouts } from './doctor-checks-checkouts.ts';
import { probeRefStructure } from './drift-probe.ts';
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
      () => probeRefStructure(item.dest, config.refs[item.key] ?? {}, { kind: 'all' }),
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

/** What the decisions add to the line, when there were any.
 *
 * Quiet is not the same as hidden: a check that reports `ok` on a repository with ten declined
 * packages should say that ten findings were answered, not imply there was nothing to find. It
 * stays a count rather than a list — the entries are in `config.toml` and in `refs show`, and
 * repeating them here would rebuild the noise the decisions removed. */
const declinedNote = (declined: number): string =>
  declined === 0 ? '' : ` (${declined} declined package(s) not reported)`;

const buildResult = (found: ProbeFindings, checkoutCount: number): CheckResult => {
  const { declined, findings, lines } = found;
  const [first] = lines;
  if (first === undefined) {
    return {
      detail: `every configured package path resolves in ${checkoutCount} checkout(s)${declinedNote(declined)}`,
      name: CHECK_NAME,
      status: 'ok',
    };
  }
  // `warn`, not `fail`: nothing in refs is broken. The configuration has fallen behind the
  // upstream repository, which is a thing to fix, not a thing that stops working — the same
  // reading `orphans` applies to its own findings. A `warn` also keeps `doctor`'s exit code at 0,
  // so drift never breaks a script that runs `refs doctor` as a gate.
  // `findings` is UNCAPPED where `detail` is not. A finding no command can repair is never
  // cleared by acting on the ones printed before it, so a capped list would put it permanently
  // out of reach of the one caller that wants the list rather than the message.
  return {
    detail: `${lines.join(SEPARATOR)}${declinedNote(declined)}`,
    findings,
    name: CHECK_NAME,
    status: 'warn',
  };
};

/** One ref at a time, never `Promise.all` — the same rule `doctor.ts` applies to its own steps.
 * It was once load-bearing here too, because `refLockName` could derive one lock name from two
 * legal ref keys and a single `doctor` run could then contend with itself; `refLockName` is
 * injective since #79, so this is now consistency rather than correctness. Each probe is a handful
 * of milliseconds, so serializing costs nothing worth having either way.
 *
 * Recursive rather than a loop, mirroring `doctor.ts#runStepsInOrder`: every await stays a plain
 * sequential step, and async recursion does not grow the stack. */
type RefFindings = { key: string; packages: StructureIssue[] };
type ProbeFindings = { declined: number; findings: RefFindings[]; lines: string[] };

const probeInOrder = async (
  home: RefsHome,
  config: Config,
  checkouts: readonly ExistingCheckout[],
): Promise<ProbeFindings> => {
  const [item, ...rest] = checkouts;
  if (item === undefined) {
    return { declined: 0, findings: [], lines: [] };
  }
  const report = await probeUnderLock(home, config, item);
  const remaining = await probeInOrder(home, config, rest);
  const packages = report.packages ?? [];
  return {
    declined: (report.declined ?? []).length + remaining.declined,
    findings:
      packages.length === 0
        ? remaining.findings
        : [{ key: item.key, packages }, ...remaining.findings],
    lines: [
      ...driftLines(report, item.key).map((line) => `${item.key}: ${line}`),
      ...remaining.lines,
    ],
  };
};

const checkConfigDrift = async (home: RefsHome, config: Config): Promise<CheckResult> => {
  const checkouts = existingCheckouts(home, config);
  return buildResult(await probeInOrder(home, config, checkouts), checkouts.length);
};

export { checkConfigDrift };
