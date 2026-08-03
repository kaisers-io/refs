import type { Config, RefsHome } from '@kaisers-io/refs-core';
import { SCHEMA_VERSION, readConfig, zConfig } from '@kaisers-io/refs-core';
import type { CheckResult } from './doctor-types.ts';
import type { CliContext } from '../context.ts';
import { errorMessageOf } from '../output.ts';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

// The four checks that need neither a per-checkout `Runner` loop nor the `sources/` directory
// walk: `git`/`node` are environment probes, `config` wraps `readConfig`'s own typed errors, and
// `skill` — the largest of the four — reads the installed skill's YAML frontmatter out of each
// agent home and compares the `metadata.cli_version` it pins against the running CLI version.
// Sibling modules own the rest: doctor-checks-checkouts.ts (per-checkout git iteration),
// doctor-checks-orphans.ts (sources/ directory walk), doctor-checks-ssh.ts (ssh auth probing);
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
const MIN_SUPPORTED_MINOR = 12;

type ParsedNodeVersion = {
  major: number;
  minor: number;
};

// Parses only the major/minor out of `process.version` (e.g. `v24.12.0`) — deliberately without a
// `semver` dependency: the supported range (`>=24.12`, open-ended) only ever needs major/minor
// comparison, never patch or prerelease handling.
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

const CLAUDE_SKILL_SEGMENTS = ['.claude', 'skills', 'refs', 'SKILL.md'] as const;
const CODEX_SKILL_SEGMENTS = ['.codex', 'skills', 'refs', 'SKILL.md'] as const;
const SKILL_INSTALL_HINT = 'npx skills add kaisers-io/refs';
const CLI_UPDATE_HINT = 'npm i -g @kaisers-io/refs@latest';

/** The agent homes a skill can be installed into, each resolved below against `ctx.env['HOME']` —
 * never the real process env directly (per `context.ts`'s injected-seam invariant). An unset
 * `HOME` (e.g. a test's bare `testContext()`) means no candidates at all, which reports as "not
 * found" rather than throwing on a `join()` with `undefined`. */
const SKILL_LOCATIONS = [
  { label: 'Claude Code', segments: CLAUDE_SKILL_SEGMENTS },
  { label: 'Codex', segments: CODEX_SKILL_SEGMENTS },
] as const;

const readIfPresent = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
};

// Pulls `metadata.cli_version` out of the skill's YAML frontmatter without a YAML dependency —
// same trade-off as `parseNodeVersion` above: one well-known key in a file this repo owns, so a
// line scan beats pulling in a parser. Accepts the value quoted or bare, at any indentation.
const FRONTMATTER_PATTERN = /^---\r?\n(?<body>[\s\S]*?)\r?\n---/u;
const CLI_VERSION_PATTERN = /^\s*cli_version:\s*["']?(?<version>[^"'\s]+)["']?\s*$/mu;

const skillCliVersionOf = (source: string): string | undefined => {
  const body = FRONTMATTER_PATTERN.exec(source)?.groups?.['body'];
  if (body === undefined) {
    return undefined;
  }
  return CLI_VERSION_PATTERN.exec(body)?.groups?.['version'];
};

// Guards the split because `Number` is far more permissive than the `x.y.z` this ever means:
// `Number('0x2') === 2` would let `1.0x2.3` through as `[1, 2, 3]`, and `Number('') === 0` would
// let `1..3` through as `[1, 0, 3]`. Anything that is not three plain decimal components is left
// to the `unknown` verdict, which tells the user to reinstall both sides rather than guessing an
// ordering. Once this matches, the split can only yield three non-negative integers.
const PLAIN_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

const parseVersionParts = (version: string): number[] | undefined => {
  if (!PLAIN_VERSION_PATTERN.test(version)) {
    return undefined;
  }
  return version.split('.').map(Number);
};

type SkillVerdict = 'cli-older' | 'match' | 'skill-older' | 'unknown';

const NOT_FOUND_INDEX = -1;

const compareSkillVersion = (skillVersion: string, cliVersion: string): SkillVerdict => {
  if (skillVersion === cliVersion) {
    return 'match';
  }
  const skillParts = parseVersionParts(skillVersion);
  const cliParts = parseVersionParts(cliVersion);
  if (skillParts === undefined || cliParts === undefined) {
    return 'unknown';
  }
  const index = skillParts.findIndex((part, position) => part !== cliParts[position]);
  if (index === NOT_FOUND_INDEX) {
    return 'match';
  }
  return (skillParts[index] ?? 0) > (cliParts[index] ?? 0) ? 'cli-older' : 'skill-older';
};

const DETAIL_BY_VERDICT: Record<SkillVerdict, (skill: string, cli: string) => string> = {
  'cli-older': (skill, cli) =>
    `the refs skill targets CLI ${skill} but this CLI is ${cli} — update the CLI: ${CLI_UPDATE_HINT}`,
  match: (_skill, cli) => `the refs skill is installed and matches this CLI (${cli})`,
  'skill-older': (skill, cli) =>
    `the refs skill targets CLI ${skill} but this CLI is ${cli} — update the skill: ${SKILL_INSTALL_HINT}`,
  unknown: (skill, cli) =>
    `the refs skill targets CLI ${skill} but this CLI is ${cli} — reinstall both: ${CLI_UPDATE_HINT} and ${SKILL_INSTALL_HINT}`,
};

type SkillVersionArgs = {
  cliVersion: string;
  label: string;
  skillVersion: string | undefined;
};

const buildSkillVersionCheck = (args: SkillVersionArgs): CheckResult => {
  const { cliVersion, label, skillVersion } = args;
  if (skillVersion === undefined) {
    return {
      detail: `the refs skill (${label}) predates the version gate — update it: ${SKILL_INSTALL_HINT}`,
      name: 'skill',
      status: 'warn',
    };
  }
  const verdict = compareSkillVersion(skillVersion, cliVersion);
  return {
    detail: `${label}: ${DETAIL_BY_VERDICT[verdict](skillVersion, cliVersion)}`,
    name: 'skill',
    status: verdict === 'match' ? 'ok' : 'warn',
  };
};

const NOT_INSTALLED: CheckResult = {
  detail: `refs skill not found — install it: ${SKILL_INSTALL_HINT}`,
  name: 'skill',
  status: 'warn',
};

/** Reports the skill as installed AND in step with this CLI. The skill and the CLI ship through
 * different channels (`npx skills add` from git, `npm i -g` from the registry), so they can drift
 * silently; the skill pins the CLI version it was written against in its frontmatter, and this
 * check is the only thing that ever compares the two.
 *
 * Both agent homes are checked, and a problem in EITHER wins over an `ok` in the other: `doctor`
 * cannot know which agent is about to read the skill, so a stale Claude Code copy must not be
 * hidden by a current Codex one. The `detail` names the platform so the fix is unambiguous. */
const checkSkill = async (ctx: CliContext): Promise<CheckResult> => {
  const home = ctx.env['HOME'];
  const found = await Promise.all(
    SKILL_LOCATIONS.map(async (location) => ({
      label: location.label,
      source:
        home === undefined ? undefined : await readIfPresent(join(home, ...location.segments)),
    })),
  );
  const checks = found
    .filter((entry) => entry.source !== undefined)
    .map((entry) =>
      buildSkillVersionCheck({
        cliVersion: ctx.cliVersion,
        label: entry.label,
        skillVersion: skillCliVersionOf(entry.source ?? ''),
      }),
    );
  return checks.find((check) => check.status !== 'ok') ?? checks[0] ?? NOT_INSTALLED;
};

export { buildConfigCheck, checkGit, checkNode, checkSkill, loadConfigSafely };
export type { ConfigLoad };
