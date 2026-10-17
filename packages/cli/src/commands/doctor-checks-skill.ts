import { PLUGIN_UPDATE_HINT, codexPluginCandidates } from './doctor-skill-plugin.ts';
import { readFile, realpath } from 'node:fs/promises';
import type { CheckResult } from './doctor-types.ts';
import type { CliContext } from '../context.ts';
import type { SkillCandidate } from './doctor-skill-locations.ts';
import { comparePlainVersions } from '@kaisers-io/refs-core';

import { skillCandidatesOf } from './doctor-skill-locations.ts';

// `refs doctor`'s `skill` check: reads the installed skill's YAML frontmatter out of every install
// location it knows about and compares the `metadata.cli_version` it pins against the running CLI
// version. Split out of doctor-checks-basic.ts (which keeps `git`/`node`/`config` — the checks that
// are environment probes rather than filesystem lookups) when the location table below grew past
// what the two could share under the repo's 300-line cap.

const SKILL_INSTALL_HINT = 'npx skills add kaisers-io/refs';
const CLI_UPDATE_HINT = 'npm i -g @kaisers-io/refs@latest';

type FoundSkill = {
  label: string;
  realPath: string;
  source: string;
  plugin?: boolean;
};

/** `realpath` before `readFile` so a symlinked install can be recognised as one copy rather than
 * several. A throw is never a problem to report: an absent path (the usual case — nobody has all
 * five) and an unreadable one both mean "nothing to compare here", and an install that exists
 * nowhere falls through to `notFoundOf` below. Read-only throughout: `refs` writes nothing outside
 * `REFS_HOME`, and this check touches no path with anything but `realpath`/`readFile`. */
const readSkillAt = async (candidate: SkillCandidate): Promise<FoundSkill | undefined> => {
  const { label, path, plugin } = candidate;
  try {
    const resolved = await realpath(path);
    return {
      label,
      realPath: resolved,
      source: await readFile(resolved, 'utf8'),
      ...(plugin === undefined ? {} : { plugin }),
    };
  } catch {
    return undefined;
  }
};

/** Keeps the first entry per resolved path. `skills add` leaves `~/.claude/skills/refs` (and
 * others) pointing at `~/.agents/skills/refs`, so without this the one installed copy would be read
 * twice and reported as if separate installs agreed — or, once the location list grows, disagreed.
 * `Map` iteration is insertion-ordered, so the earliest location wins. */
const uniqueByRealPath = (entries: readonly FoundSkill[]): FoundSkill[] => {
  const byRealPath = new Map<string, FoundSkill>();
  for (const entry of entries) {
    if (!byRealPath.has(entry.realPath)) {
      byRealPath.set(entry.realPath, entry);
    }
  }
  return [...byRealPath.values()];
};

// Pulls `metadata.cli_version` out of the skill's YAML frontmatter without a YAML dependency —
// same trade-off as `parseNodeVersion` in doctor-checks-basic.ts: one well-known key in a file this
// repo owns, so a line scan beats pulling in a parser. Accepts the value quoted or bare, at any
// indentation.
const FRONTMATTER_PATTERN = /^---\r?\n(?<body>[\s\S]*?)\r?\n---/u;
const CLI_VERSION_PATTERN = /^\s*cli_version:\s*["']?(?<version>[^"'\s]+)["']?\s*$/mu;

const skillCliVersionOf = (source: string): string | undefined => {
  const body = FRONTMATTER_PATTERN.exec(source)?.groups?.['body'];
  if (body === undefined) {
    return undefined;
  }
  return CLI_VERSION_PATTERN.exec(body)?.groups?.['version'];
};

type SkillVerdict = 'cli-older' | 'match' | 'skill-older' | 'unknown';

// Anything that is not three plain decimal components — a prerelease on either side — is left to
// the `unknown` verdict, which tells the user to reinstall both sides rather than guessing an
// ordering. `comparePlainVersions` is the single implementation of that rule; this file used to
// carry a second one that compared through `Number`, which agrees with it everywhere except past
// 2^53, where it silently reported a match.
// Longer than any version this CLI could have published, by a wide margin. `comparePlainVersions`
// deliberately supports components of arbitrary length, so `'9'.repeat(4000) + '.0.0'` compares
// fine and is a perfectly ordinary `skill-older`/`cli-older` verdict — which then quotes those
// 4000 digits into the detail. A bound here keeps the line a line, and it belongs on the verdict
// rather than on the rendering: a value this long is not a version, whatever it compares as.
const MAX_SKILL_VERSION_LENGTH = 32;

const compareSkillVersion = (skillVersion: string, cliVersion: string): SkillVerdict => {
  if (skillVersion.length > MAX_SKILL_VERSION_LENGTH) {
    return 'unknown';
  }
  if (skillVersion === cliVersion) {
    return 'match';
  }
  const compared = comparePlainVersions(skillVersion, cliVersion);
  if (compared === undefined) {
    return 'unknown';
  }
  if (compared === 0) {
    return 'match';
  }
  return compared > 0 ? 'cli-older' : 'skill-older';
};

const DETAIL_BY_VERDICT: Record<SkillVerdict, (skill: string, cli: string) => string> = {
  'cli-older': (skill, cli) =>
    `the refs skill targets CLI ${skill} but this CLI is ${cli} — update the CLI: ${CLI_UPDATE_HINT}`,
  match: (_skill, cli) => `the refs skill is installed and matches this CLI (${cli})`,
  'skill-older': (skill, cli) =>
    `the refs skill targets CLI ${skill} but this CLI is ${cli} — update the skill: ${SKILL_INSTALL_HINT}`,
  // The one verdict where the declared value is NOT quoted back. Two of the five places a
  // `SKILL.md` is looked for are rooted at the working directory — for an agent session, whatever
  // repository it happens to be in — and the frontmatter scan accepts any quote-free,
  // whitespace-free token of any length. Quoting it put attacker-chosen prose, unbounded, into an
  // agent-facing `--json` detail that MAINTAIN.md tells the agent to relay verbatim to a human.
  //
  // The two ordering verdicts are the only others that interpolate the declared value, and they
  // are reached only once `comparePlainVersions` has accepted it, so what they quote is three
  // decimal components bounded by `MAX_SKILL_VERSION_LENGTH`. `match` does not quote it at all.
  unknown: (_skill, cli) =>
    `the refs skill does not declare a version this CLI (${cli}) can compare — reinstall both: ${CLI_UPDATE_HINT} and ${SKILL_INSTALL_HINT}`,
};

type SkillVersionArgs = {
  cliVersion: string;
  label: string;
  skillVersion: string | undefined;
  plugin?: boolean;
};

const buildSkillVersionCheck = (args: SkillVersionArgs): CheckResult => {
  const { cliVersion, label, skillVersion } = args;
  const updateHint = args.plugin === true ? PLUGIN_UPDATE_HINT : SKILL_INSTALL_HINT;
  if (skillVersion === undefined) {
    return {
      detail: `the refs skill (${label}) predates the version gate — update it: ${updateHint}`,
      name: 'skill',
      status: 'warn',
    };
  }
  const verdict = compareSkillVersion(skillVersion, cliVersion);
  return {
    detail: `${label}: ${DETAIL_BY_VERDICT[verdict](skillVersion, cliVersion).replace(SKILL_INSTALL_HINT, updateHint)}`,
    name: 'skill',
    status: verdict === 'match' ? 'ok' : 'warn',
  };
};

/** Deliberately not "refs skill not found": with env-overridable per-agent directories, project
 * scope as the installer's default, and 70-odd agent directories this deliberately does not look
 * at, "it is not installed" is not a claim this check can make. So it says what it actually knows —
 * which places it looked — and keeps the install hint for the case where the skill really is
 * missing. One line, because both a human and an agent read it.
 *
 * Derived from the candidates rather than written out, so the list is true in every configuration.
 * A hardcoded `~/.claude` would be a lie under `$CLAUDE_CONFIG_DIR`, which MOVES the search rather
 * than widening it: the message would send its reader — quite possibly an agent acting on it — to
 * inspect the one directory this check has just finished arguing nothing reads. */
const notFoundOf = (candidates: readonly SkillCandidate[]): CheckResult => ({
  detail: `refs skill not found in the locations this check knows about (${candidates.map((candidate) => candidate.display).join(', ')}) — an install anywhere else is invisible here and still works; if it really is missing: ${SKILL_INSTALL_HINT}`,
  name: 'skill',
  status: 'warn',
});

/** Reports the skill as installed AND in step with this CLI. The skill and the CLI ship through
 * different channels (`skills add` from git, `npm i -g` from the registry), so they can drift
 * silently; the skill pins the CLI version it was written against in its frontmatter, and this
 * check is the only thing that ever compares the two.
 *
 * Every distinct copy is checked, and a problem in ANY of them wins over an `ok` in the others:
 * `doctor` cannot know which agent is about to read the skill, so a stale Claude Code copy must
 * not be hidden by a current shared one. The `detail` names the location so the fix is
 * unambiguous. */
const checkSkill = async (ctx: CliContext): Promise<CheckResult> => {
  const plugin = await codexPluginCandidates(ctx);
  const candidates = [...skillCandidatesOf(ctx), ...plugin.candidates];
  const loaded = await Promise.all(candidates.map((candidate) => readSkillAt(candidate)));
  const found = uniqueByRealPath(loaded.filter((entry) => entry !== undefined));
  const checks = found.map((entry) =>
    buildSkillVersionCheck({
      cliVersion: ctx.cliVersion,
      label: entry.label,
      skillVersion: skillCliVersionOf(entry.source),
      ...(entry.plugin === undefined ? {} : { plugin: entry.plugin }),
    }),
  );
  const result =
    plugin.warning ??
    checks.find((check) => check.status !== 'ok') ??
    checks[0] ??
    notFoundOf(candidates);
  return found.some((entry) => entry.plugin === true) &&
    found.some((entry) => entry.plugin !== true)
    ? {
        ...result,
        detail: `${result.detail}; both plugin and standalone copies are installed — Codex can show refs and refs:refs; choose one installation method to avoid duplicates`,
      }
    : result;
};

export { checkSkill };
