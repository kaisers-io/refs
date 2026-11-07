import type { CheckResult } from './doctor-types.ts';
import { comparePlainVersions } from '@kaisers-io/refs-core';

// The version half of `refs doctor`'s `skill` check: reads `metadata.cli_version` out of one
// installed copy and turns the comparison with the running CLI into a check result. Split out of
// doctor-checks-skill.ts, which keeps the half that decides WHERE copies are looked for, when the
// Codex plugin cache joined that list and the two no longer fitted the repo's 300-line cap.

const CLI_UPDATE_HINT = 'npm i -g @kaisers-io/refs@latest';

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

// `hint` is the command that updates THIS copy: a plugin install is not updated by `skills add`,
// and telling its owner to run that would add a second copy instead of fixing the first.
const DETAIL_BY_VERDICT: Record<
  SkillVerdict,
  (skill: string, cli: string, hint: string) => string
> = {
  'cli-older': (skill, cli) =>
    `the refs skill targets CLI ${skill} but this CLI is ${cli} — update the CLI: ${CLI_UPDATE_HINT}`,
  match: (_skill, cli) => `the refs skill is installed and matches this CLI (${cli})`,
  'skill-older': (skill, cli, hint) =>
    `the refs skill targets CLI ${skill} but this CLI is ${cli} — update the skill: ${hint}`,
  // The one verdict where the declared value is NOT quoted back. Two of the places a `SKILL.md` is
  // looked for are rooted at the working directory — for an agent session, whatever repository it
  // happens to be in — and the frontmatter scan accepts any quote-free, whitespace-free token of
  // any length. Quoting it put attacker-chosen prose, unbounded, into an agent-facing `--json`
  // detail that MAINTAIN.md tells the agent to relay verbatim to a human.
  //
  // The two ordering verdicts are the only others that interpolate the declared value, and they
  // are reached only once `comparePlainVersions` has accepted it, so what they quote is three
  // decimal components bounded by `MAX_SKILL_VERSION_LENGTH`. `match` does not quote it at all.
  unknown: (_skill, cli, hint) =>
    `the refs skill does not declare a version this CLI (${cli}) can compare — reinstall both: ${CLI_UPDATE_HINT} and ${hint}`,
};

type SkillVersionArgs = {
  cliVersion: string;
  /** What updates this copy — the installer's command, or Codex's for a plugin install. */
  hint: string;
  label: string;
  skillVersion: string | undefined;
};

const buildSkillVersionCheck = (args: SkillVersionArgs): CheckResult => {
  const { cliVersion, hint, label, skillVersion } = args;
  if (skillVersion === undefined) {
    return {
      detail: `the refs skill (${label}) predates the version gate — update it: ${hint}`,
      name: 'skill',
      status: 'warn',
    };
  }
  const verdict = compareSkillVersion(skillVersion, cliVersion);
  return {
    detail: `${label}: ${DETAIL_BY_VERDICT[verdict](skillVersion, cliVersion, hint)}`,
    name: 'skill',
    status: verdict === 'match' ? 'ok' : 'warn',
  };
};

export { buildSkillVersionCheck, skillCliVersionOf };
