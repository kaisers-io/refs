import type { Config, RefsHome } from '@kaisers-io/refs-core';
import { SCHEMA_VERSION, readConfig, zConfig } from '@kaisers-io/refs-core';
import type { CheckResult } from './doctor-types.ts';
import type { CliContext } from '../context.ts';
import { errorMessageOf } from '../output.ts';

// The three checks that touch neither the filesystem, a per-checkout `Runner` loop, nor the
// `sources/` directory walk: `git`/`node` are environment probes and `config` wraps `readConfig`'s
// own typed errors. Sibling modules own the rest: doctor-checks-checkouts.ts (per-checkout git
// iteration), doctor-checks-orphans.ts (sources/ directory walk), doctor-checks-skill.ts (the
// installed skill's version pin, split out of this file in 0.6.1 when its location table outgrew
// what the two could share under the repo's 300-line cap), doctor-checks-ssh.ts (ssh auth probing);
// doctor.ts only orders and collects them.

const SUCCESS_EXIT_CODE = 0;

const checkGit = async (ctx: CliContext): Promise<CheckResult> => {
  const result = await ctx.runner.run('git', ['--version']);
  if (result.exitCode === SUCCESS_EXIT_CODE) {
    return { detail: result.stdout.trim(), name: 'git', status: 'ok' };
  }
  const detail = result.stderr.trim() || `git --version exited with code ${result.exitCode}`;
  return { detail, name: 'git', status: 'fail' };
};

const NODE_VERSION_PATTERN = /^v(?<major>\d+)\.(?<minor>\d+)/u;
const MIN_SUPPORTED_MAJOR = 24;
const MIN_SUPPORTED_MINOR = 2;

type ParsedNodeVersion = {
  major: number;
  minor: number;
};

// Parses only the major/minor out of `process.version` (e.g. `v24.2.0`) — deliberately without a
// `semver` dependency: the supported range (`>=24.2`, open-ended — see the rationale comment in
// packages/cli/bin/refs.mjs) only ever needs major/minor comparison, never patch or prerelease
// handling.
const parseNodeVersion = (version: string): ParsedNodeVersion | undefined => {
  const match = NODE_VERSION_PATTERN.exec(version);
  const majorText = match?.groups?.['major'];
  const minorText = match?.groups?.['minor'];
  if (majorText === undefined || minorText === undefined) {
    return undefined;
  }
  return { major: Number(majorText), minor: Number(minorText) };
};

// `>=24.2` is open-ended: any major above 24 is accepted outright, major 24 needs minor >= 2,
// and anything below that (older 24.x minors, or any earlier major) is rejected.
const satisfiesSupportedRange = (parsed: ParsedNodeVersion | undefined): boolean => {
  if (parsed === undefined) {
    return false;
  }
  if (parsed.major > MIN_SUPPORTED_MAJOR) {
    return true;
  }
  return parsed.major === MIN_SUPPORTED_MAJOR && parsed.minor >= MIN_SUPPORTED_MINOR;
};

// Reads `ctx.nodeVersion` — never `process.version` directly — per `context.ts`'s own invariant
// that `realContext()` is the ONLY place touching real globals; this is what lets the fail
// branch below (a too-old Node) be exercised with an arbitrary version string instead of only
// ever observing whatever interpreter the test happens to run under.
const checkNode = (ctx: CliContext): CheckResult => {
  const { nodeVersion: version } = ctx;
  if (satisfiesSupportedRange(parseNodeVersion(version))) {
    return { detail: version, name: 'node', status: 'ok' };
  }
  return {
    detail: `${version} does not satisfy the required range >=24.2`,
    name: 'node',
    status: 'fail',
  };
};

type ConfigLoad = {
  config: Config;
  errorMessage?: string;
};

// A placeholder `meta` — never written to disk, only held in memory so the OTHER checks (which
// all need `config.refs`/`config.settings` to iterate refs) still have something to iterate over
// when the real config is unreadable/mismatched. The `config` check itself reports the real
// failure separately, from `errorMessage` below.
const buildEmptyConfig = (): Config =>
  zConfig.parse({
    meta: { cli_version: '0.0.0', schema_version: SCHEMA_VERSION },
    refs: {},
    settings: {},
  });

/** Never throws: `readConfig` throws a typed `RefsError` for an absent config (`refs init` hint),
 * an older/newer schema (`refs migrate` hint / `upgrade refs`), or a malformed shape — every one of
 * those messages is already actionable, so it is carried through to the `config` check's `detail`
 * verbatim rather than being re-worded here. */
const loadConfigSafely = async (home: RefsHome): Promise<ConfigLoad> => {
  try {
    return { config: await readConfig(home) };
  } catch (error) {
    return { config: buildEmptyConfig(), errorMessage: errorMessageOf(error) };
  }
};

const buildConfigCheck = (errorMessage: string | undefined): CheckResult => {
  if (errorMessage === undefined) {
    return {
      detail: 'config is present and matches the current schema',
      name: 'config',
      status: 'ok',
    };
  }
  return { detail: errorMessage, name: 'config', status: 'fail' };
};

export { buildConfigCheck, checkGit, checkNode, loadConfigSafely };
export type { ConfigLoad };
