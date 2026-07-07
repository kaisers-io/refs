import type { Config, RefsHome } from '@kaisers-io/refs-core';
import {
  SCHEMA_VERSION,
  readConfig,
  zConfig,
  // eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
} from '@kaisers-io/refs-core';
import type { CheckResult } from './doctor-types.ts';
import type { CliContext } from '../context.ts';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

// The four checks that need neither a per-checkout `Runner` loop nor the `sources/` directory
// walk: `git`/`node` are environment probes, `config` wraps `readConfig`'s own typed errors,
// `skill` is a plain fs existence check. Split out of `doctor.ts` purely to keep that file under
// the repo's 300-line oxlint cap; `hooks-guard`/`dirty-checkouts` (checkout iteration) and
// `orphans`/`ssh-auth` (heavier per-check logic) live in their own sibling modules.

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
const MIN_SUPPORTED_MINOR = 12;

interface ParsedNodeVersion {
  major: number;
  minor: number;
}

// Parses only the major/minor out of `process.version` (e.g. `v24.12.0`) — deliberately without a
// `semver` dependency, per the task brief: the supported range (`>=24.12`, open-ended) only ever
// needs major/minor comparison, never patch or prerelease handling.
const parseNodeVersion = (version: string): ParsedNodeVersion | undefined => {
  const match = NODE_VERSION_PATTERN.exec(version);
  const majorText = match?.groups?.['major'];
  const minorText = match?.groups?.['minor'];
  if (majorText === undefined || minorText === undefined) {
    return undefined;
  }
  return { major: Number(majorText), minor: Number(minorText) };
};

// `>=24.12` is open-ended: any major above 24 is accepted outright, major 24 needs minor >= 12,
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
    detail: `${version} does not satisfy the required range >=24.12`,
    name: 'node',
    status: 'fail',
  };
};

interface ConfigLoad {
  config: Config;
  errorMessage?: string;
}

const errorMessageOf = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

const CLAUDE_SKILL_SEGMENTS = ['.claude', 'skills', 'refs', 'SKILL.md'] as const;
const CODEX_SKILL_SEGMENTS = ['.codex', 'skills', 'refs', 'SKILL.md'] as const;
const SKILL_INSTALL_HINT = 'npx skills add kaisers-io/refs';

/** `home` is `ctx.env['HOME']`, never the real process env directly (per the task brief) — an
 * unset `HOME` (e.g. a test's bare `testContext()`) yields no candidates at all, which reports as
 * "not found" below rather than throwing on a `join()` with `undefined`. */
const skillCandidatePaths = (home: string | undefined): string[] => {
  if (home === undefined) {
    return [];
  }
  return [join(home, ...CLAUDE_SKILL_SEGMENTS), join(home, ...CODEX_SKILL_SEGMENTS)];
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const checkSkill = async (ctx: CliContext): Promise<CheckResult> => {
  const candidates = skillCandidatePaths(ctx.env['HOME']);
  const found = await Promise.all(candidates.map((path) => pathExists(path)));
  if (found.some(Boolean)) {
    return { detail: 'the refs skill is installed', name: 'skill', status: 'ok' };
  }
  return {
    detail: `refs skill not found — install it: ${SKILL_INSTALL_HINT}`,
    name: 'skill',
    status: 'warn',
  };
};

export { buildConfigCheck, checkGit, checkNode, checkSkill, errorMessageOf, loadConfigSafely };
export type { ConfigLoad };
