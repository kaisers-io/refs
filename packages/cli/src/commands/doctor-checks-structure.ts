import type { Config, RefsHome } from '@kaisers-io/refs-core';
import { RefsError, withLock } from '@kaisers-io/refs-core';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { StructureIssue, StructureReport } from './drift-report.ts';
import type { CheckResult } from './doctor-types.ts';
import type { ExistingCheckout } from './doctor-checks-checkouts.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { RepairCommands } from './drift-commands.ts';
import { driftLines } from './drift-lines.ts';
import { existingCheckouts } from './doctor-checks-checkouts.ts';
import { probeRefStructure } from './drift-probe.ts';
import { refLockName } from './add-source.ts';
import { repairCommandsFor } from './drift-commands.ts';

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

/** The health line, which is about the CONFIGURED entries and nothing else. */
const healthDetail = (found: ProbeFindings, checkoutCount: number): string =>
  found.unhealthy.length === 0
    ? `every configured package path resolves in ${checkoutCount} checkout(s)`
    : found.unhealthy.join(SEPARATOR);

const buildResult = (found: ProbeFindings, checkoutCount: number): CheckResult => {
  const { declined, discovery, findings } = found;
  // `warn` follows the configured entries alone. An unregistered candidate is not a defect in this
  // configuration: nothing in it points anywhere for that package, so there is nothing to be
  // wrong. Reporting them as drift made the check assert that every package a repository declares
  // must have been decided about — which nothing justifies, and which a repository declaring 554
  // of them turns into a permanent warning nobody can read.
  //
  // `warn`, not `fail`, where there IS drift: nothing in refs is broken. The configuration has
  // fallen behind the upstream repository, which is a thing to fix, not a thing that stops
  // working — and a `warn` keeps `doctor`'s exit code at 0, so drift never breaks a script that
  // runs `refs doctor` as a gate.
  const detail = [healthDetail(found, checkoutCount) + declinedNote(declined), ...discovery].join(
    SEPARATOR,
  );
  // `findings` is UNCAPPED where `detail` is not, and carries the discovery candidates too: a
  // grouped line names a count, and the caller that wants the members has to be able to get them.
  return {
    detail,
    ...(findings.length === 0 ? {} : { findings }),
    name: CHECK_NAME,
    status: found.unhealthy.length === 0 ? 'ok' : 'warn',
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
type ProbeFindings = {
  declined: number;
  /** Lines about what the checkouts declare and the configuration does not have. Reported, never
   * counted towards health. */
  discovery: string[];
  findings: RefFindings[];
  /** Lines about configured entries that are wrong or could not be checked. These decide the
   * check's status. */
  unhealthy: string[];
};

const probeInOrder = async (
  home: RefsHome,
  config: Config,
  checkouts: readonly ExistingCheckout[],
): Promise<ProbeFindings> => {
  const [item, ...rest] = checkouts;
  if (item === undefined) {
    return { declined: 0, discovery: [], findings: [], unhealthy: [] };
  }
  const report = await probeUnderLock(home, config, item);
  const remaining = await probeInOrder(home, config, rest);
  return mergeFindings(remaining, { key: item.key, report });
};

/** One ref's report, folded into the ones after it. The split is by WHICH REPORT a line came out
 * of, not by reading the line: `driftLines` is asked twice, once with only the configured half of
 * the report and once with only the discovery half, so neither has to be recognised by its text. */
/** A finding with the repair commands it can offer, already quoted for a shell.
 *
 * The raw `name` and `path` stay — a caller that wants the values still gets them — but nothing has
 * to ASSEMBLE a command from them any more. That mattered most where the human `detail` gives no
 * command at all: once a directory holds enough unregistered packages, the per-package line is
 * replaced by a single count line, which is exactly the large-monorepo case the skill routes an
 * agent to `findings` for. A finding that can offer no command honestly carries none.
 *
 * `register` carries a `"<what it is>"` placeholder deliberately: a description is written from the
 * package's own source, never copied out of a manifest, so refs cannot fill it in. */
const withCommands = (issue: StructureIssue, key: string): StructureIssue & RepairCommands => ({
  ...issue,
  ...repairCommandsFor(issue, key),
});

const mergeFindings = (
  rest: ProbeFindings,
  item: { key: string; report: StructureReport },
): ProbeFindings => {
  const { key, report } = item;
  const prefixed = (lines: readonly string[]): string[] => lines.map((line) => `${key}: ${line}`);
  const candidates = report.discovery ?? [];
  const configured = report.packages ?? [];
  const found = [...configured, ...candidates];
  return {
    declined: (report.declined ?? []).length + rest.declined,
    discovery: [
      ...prefixed(driftLines({ discovery: candidates, status: 'ok' }, key)),
      ...rest.discovery,
    ],
    findings:
      found.length === 0
        ? rest.findings
        : [{ key, packages: found.map((issue) => withCommands(issue, key)) }, ...rest.findings],
    unhealthy: [
      ...prefixed(
        driftLines(
          {
            ...(report.discovery_incomplete === undefined
              ? {}
              : { discovery_incomplete: report.discovery_incomplete }),
            ...(report.reason === undefined ? {} : { reason: report.reason }),
            packages: configured,
            status: report.status,
          },
          key,
        ),
      ),
      ...rest.unhealthy,
    ],
  };
};

const checkConfigDrift = async (home: RefsHome, config: Config): Promise<CheckResult> => {
  const checkouts = existingCheckouts(home, config);
  return buildResult(await probeInOrder(home, config, checkouts), checkouts.length);
};

export { checkConfigDrift };
