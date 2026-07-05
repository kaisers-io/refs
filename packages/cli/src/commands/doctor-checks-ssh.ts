import type { CheckResult } from './doctor-types.ts';
import type { CliContext } from '../context.ts';
import type { Config } from '@kaisers-io/refs-core';

// `ssh-auth` — only present in the check list at all when at least one configured ref uses an ssh
// transport url (task brief). Split out of `doctor.ts` purely to keep that file under the repo's
// 300-line oxlint cap.

const EMPTY_LENGTH = 0;
const SCP_HOST_PATTERN = /^(?<user>[^/\s@]+)@(?<host>[^:/\s]+):/u;
const SSH_PROTOCOL = 'ssh:';
const DEFAULT_SSH_USER = 'git';

interface SshTarget {
  host: string;
  port?: string;
  user?: string;
}

// Present only when `parsed.username`/`parsed.port` actually carried a value — spread into the
// `SshTarget` literal below so an absent one is genuinely omitted (never an explicit `undefined`)
// for `SshTarget`'s optional fields.
const usernameOpt = (username: string): { user?: string } => {
  if (username === '') {
    return {};
  }
  return { user: username };
};

const portOpt = (port: string): { port?: string } => {
  if (port === '') {
    return {};
  }
  return { port };
};

/** The `ssh://[user@]host[:port]/path` form only — split out of `sshTargetFor` (below) purely to
 * keep that function's own statement count under the repo's `max-statements` cap. `new URL(...)`
 * throwing (a genuinely malformed url) reports the same `undefined` as "not an ssh url". An absent
 * `url.username` leaves `user` unset (`undefined`) rather than defaulting to `git`: a real
 * `ssh <host>`/clone with no explicit user lets the LOCAL ssh config decide who connects, and
 * forcing `git@` here would probe a different principal than the one the actual clone uses. Only
 * the scp form (below) and an explicit `ssh://user@` carry a user. */
const sshTargetFromUrl = (url: string): SshTarget | undefined => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== SSH_PROTOCOL) {
      return undefined;
    }
    return { host: parsed.hostname, ...usernameOpt(parsed.username), ...portOpt(parsed.port) };
  } catch {
    return undefined;
  }
};

/** Extracts the ssh user+host (and, for an explicit `ssh://` port, that port too) from `url`, or
 * `undefined` when `url` isn't an ssh-transport git url. Checks the scp-style `user@host:path`
 * shorthand FIRST (mirroring core's own `git-url.ts#SCP_URL`): `new URL(...)` throws on that form
 * rather than parsing it, so it must be tried before falling back to `sshTargetFromUrl`. The scp
 * form never carries a port of its own (`host:port` there would be ambiguous with the path
 * separator — core's own `git-url.ts` rejects it outright). */
const sshTargetFor = (url: string): SshTarget | undefined => {
  const scp = SCP_HOST_PATTERN.exec(url);
  const scpHost = scp?.groups?.['host'];
  if (scpHost !== undefined) {
    return { host: scpHost, user: scp?.groups?.['user'] ?? DEFAULT_SSH_USER };
  }
  return sshTargetFromUrl(url);
};

/** The label used both to dedupe targets and to display them in a check's `detail`, covering the
 * FULL probe identity — `user@` whenever `target.user` is actually known (finding: host-only
 * dedupe collapsed two same-host refs with different users into one probe, reporting one ref's
 * auth from another ref's user; a second finding required a bare, userless `ssh://` target to
 * stay visibly distinct from an explicit `git@host` one, since the two can probe different
 * principals), `:port` only when an `ssh://` url actually carried a non-default one (finding: a
 * dropped port silently probed 22). Hostnames can never contain `@` or `:` in the url forms core
 * accepts, so distinct identities always yield distinct labels. */
const hostPartFor = (target: SshTarget): string => {
  if (target.port === undefined) {
    return target.host;
  }
  return `${target.host}:${target.port}`;
};

const displayFor = (target: SshTarget): string => {
  if (target.user === undefined) {
    return hostPartFor(target);
  }
  return `${target.user}@${hostPartFor(target)}`;
};

const uniqueSshTargets = (config: Config): SshTarget[] => {
  const targets = Object.values(config.refs)
    .map((ref) => sshTargetFor(ref.url))
    .filter((target): target is SshTarget => target !== undefined);
  const byDisplay = new Map<string, SshTarget>();
  for (const target of targets) {
    byDisplay.set(displayFor(target), target);
  }
  return [...byDisplay.values()].toSorted((left, right) =>
    displayFor(left).localeCompare(displayFor(right)),
  );
};

const SSH_CONNECT_TIMEOUT_SECONDS = 5;
const SSH_PROBE_TIMEOUT_MS = 10_000;
const MS_PER_SECOND = 1000;
const PERMISSION_DENIED_PATTERN = /Permission denied/u;

// Clear connection-level failures — the remote never got far enough to even weigh in on auth —
// distinct from both a hard `Permission denied` (a real credential problem, still `fail`) and an
// exec-level timeout (this process's own watchdog killed the child, still `fail`). These are
// treated as `warn`, not `fail`: a transient DNS hiccup, a firewalled port, or a host key that
// legitimately rotated must not flip an otherwise-healthy `doctor` run to CI-style red — they are
// worth surfacing, not worth blocking on.
const CONNECTION_WARN_PATTERNS: readonly RegExp[] = [
  /Could not resolve hostname/u,
  /Connection refused/u,
  /Host key verification failed/u,
  /timed out/u,
];

type SshProbeOutcome = 'connection-warn' | 'denied' | 'ok' | 'timeout';

interface SshProbe {
  detail?: string;
  host: string;
  outcome: SshProbeOutcome;
}

// A userless target (no `user@` prefix) is probed as the bare host — matching a real
// `ssh <host>`/clone with no explicit user, which lets the LOCAL ssh config pick the principal
// rather than this check forcing one.
const destinationFor = (target: SshTarget): string => {
  if (target.user === undefined) {
    return target.host;
  }
  return `${target.user}@${target.host}`;
};

const buildSshArgs = (target: SshTarget): string[] => {
  const base = ['-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`, '-o', 'BatchMode=yes'];
  const destination = destinationFor(target);
  if (target.port === undefined) {
    return [...base, '-T', destination];
  }
  return [...base, '-p', target.port, '-T', destination];
};

/** `-o BatchMode=yes` prevents an interactive password/passphrase prompt from ever blocking this
 * probe; `-o ConnectTimeout=<n>` is the task brief's "5s timeout" for the connection phase only —
 * `timeoutMs` (passed straight to the injected `Runner`, which `SpawnRunner` wires to its own
 * SIGTERM/SIGKILL escalation) bounds the whole probe, including anything after the connection
 * succeeds, AND
 * — unlike a hand-rolled race — actually kills the underlying `ssh` child on expiry rather than
 * abandoning it to keep running (and keep this short-lived CLI process alive) after doctor has
 * already reported. Any exit code is accepted: GitHub's own successful `ssh -T` documented
 * behaviour actually exits 1 — including, genuinely, `124`, so the timeout branch below must key
 * off `result.timedOut` (set only by an actual `Runner`-level timeout), never `exitCode` alone, or
 * a real exit-124 child would be misreported as "probe timed out". Only `stderr` containing
 * "Permission denied" counts as an auth failure; a handful of other clear connection-level
 * failures are tiered to `warn` instead (see `CONNECTION_WARN_PATTERNS` above) — checked in this
 * order so an actual exec-level timeout is never miscategorized as a "connection timed out"
 * warning. */
const probeSshHost = async (
  ctx: CliContext,
  target: SshTarget,
  timeoutMs: number,
): Promise<SshProbe> => {
  const host = displayFor(target);
  const result = await ctx.runner.run('ssh', buildSshArgs(target), { timeoutMs });
  if (result.timedOut === true) {
    return { host, outcome: 'timeout' };
  }
  if (PERMISSION_DENIED_PATTERN.test(result.stderr)) {
    return { host, outcome: 'denied' };
  }
  const warnMatch = CONNECTION_WARN_PATTERNS.some((pattern) => pattern.test(result.stderr));
  if (warnMatch) {
    return { detail: result.stderr.trim(), host, outcome: 'connection-warn' };
  }
  return { host, outcome: 'ok' };
};

/** Each of the four `*Result` helpers below (timeout/denied/connection-warn/ok) owns exactly one
 * outcome tier, checked in that priority order — split out of a single `buildSshAuthResult` purely
 * to keep it (and each helper) under the repo's `max-statements` cap. */
const timeoutResult = (probes: readonly SshProbe[], timeoutMs: number): CheckResult | undefined => {
  const timedOutHosts = probes
    .filter((probe) => probe.outcome === 'timeout')
    .map((probe) => probe.host);
  if (timedOutHosts.length === EMPTY_LENGTH) {
    return undefined;
  }
  const seconds = timeoutMs / MS_PER_SECOND;
  return {
    detail: `ssh probe timed out after ${seconds}s: ${timedOutHosts.join(', ')}`,
    name: 'ssh-auth',
    status: 'fail',
  };
};

const deniedResult = (probes: readonly SshProbe[]): CheckResult | undefined => {
  const deniedHosts = probes
    .filter((probe) => probe.outcome === 'denied')
    .map((probe) => probe.host);
  if (deniedHosts.length === EMPTY_LENGTH) {
    return undefined;
  }
  return {
    detail: `ssh permission denied for: ${deniedHosts.join(', ')}`,
    name: 'ssh-auth',
    status: 'fail',
  };
};

const connectionWarnResult = (probes: readonly SshProbe[]): CheckResult | undefined => {
  const warnProbes = probes.filter((probe) => probe.outcome === 'connection-warn');
  if (warnProbes.length === EMPTY_LENGTH) {
    return undefined;
  }
  const detail = warnProbes.map((probe) => `${probe.host} (${probe.detail ?? ''})`).join('; ');
  return {
    detail: `ssh connection issue, treated as warn: ${detail}`,
    name: 'ssh-auth',
    status: 'warn',
  };
};

const okResult = (probes: readonly SshProbe[]): CheckResult => ({
  detail: `ssh auth ok for: ${probes.map((probe) => probe.host).join(', ')}`,
  name: 'ssh-auth',
  status: 'ok',
});

const buildSshAuthResult = (probes: readonly SshProbe[], timeoutMs: number): CheckResult =>
  timeoutResult(probes, timeoutMs) ??
  deniedResult(probes) ??
  connectionWarnResult(probes) ??
  okResult(probes);

interface CheckSshAuthOptions {
  timeoutMs?: number;
}

const checkSshAuth = async (
  ctx: CliContext,
  config: Config,
  opts?: CheckSshAuthOptions,
): Promise<CheckResult | undefined> => {
  const targets = uniqueSshTargets(config);
  if (targets.length === EMPTY_LENGTH) {
    return undefined;
  }
  const timeoutMs = opts?.timeoutMs ?? SSH_PROBE_TIMEOUT_MS;
  const probes = await Promise.all(targets.map((target) => probeSshHost(ctx, target, timeoutMs)));
  return buildSshAuthResult(probes, timeoutMs);
};

export { checkSshAuth };
