import { readFile, realpath } from 'node:fs/promises';
import type { CheckResult } from './doctor-types.ts';
import type { CliContext } from '../context.ts';
import { join } from 'node:path';

// `refs doctor`'s `skill` check: reads the installed skill's YAML frontmatter out of every install
// location it knows about and compares the `metadata.cli_version` it pins against the running CLI
// version. Split out of doctor-checks-basic.ts (which keeps `git`/`node`/`config` — the checks that
// are environment probes rather than filesystem lookups) when the location table below grew past
// what the two could share under the repo's 300-line cap.

const AGENTS_SKILL_SEGMENTS = ['.agents', 'skills', 'refs', 'SKILL.md'] as const;
const AGENT_HOME_SKILL_SEGMENTS = ['skills', 'refs', 'SKILL.md'] as const;
const SKILL_INSTALL_HINT = 'npx skills add kaisers-io/refs';
const CLI_UPDATE_HINT = 'npm i -g @kaisers-io/refs@latest';

type SkillCandidate = {
  label: string;
  path: string;
};

/** One agent's own configuration directory, honouring the installer's env override
 * (`$CLAUDE_CONFIG_DIR`, `$CODEX_HOME`) exactly as `vercel-labs/skills`' `src/agents.ts` resolves
 * it: a set, non-blank override wins over `<home>/<dirName>` outright — a user who sets either has
 * no `~/.claude`/`~/.codex` at all. Read through `ctx.env`, never `process.env`, like every other
 * environment read in this package. An unset `HOME` with no override yields no candidate rather
 * than a `join()` on `undefined`. */
type AgentHomeArgs = {
  dirName: string;
  env: NodeJS.ProcessEnv;
  home: string | undefined;
  overrideName: string;
};

const agentHomeOf = (args: AgentHomeArgs): string | undefined => {
  const { dirName, env, home, overrideName } = args;
  const override = env[overrideName]?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return home === undefined ? undefined : join(home, dirName);
};

/** The locations an installed skill is looked for — best-effort, and deliberately short.
 *
 * None of these paths is a stable contract. They are `vercel-labs/skills`' implementation detail:
 * the canonical directory has moved before, the README table documenting it is generated from the
 * installer's own source (and is already wrong for Codex), and 74 agents carry a global directory
 * each. Enumerating them is not a strategy, so this covers the installer's canonical location plus
 * the two agents `refs` ships plugin manifests for. Two consequences worth knowing:
 *
 * - Project scope is the installer's DEFAULT (`-g` is opt-in), and `skills add` implies `-y` when
 *   it detects it is running inside an agent — so an agent-driven install lands in
 *   `<cwd>/.agents/skills/refs` and never touches `$HOME`. That is why the last entry exists.
 * - A single-target install (`skills add … -a claude-code -g`) silently switches to copy mode, as
 *   does a symlink failure on a filesystem without symlink support, so the per-agent directories
 *   can hold real, independent copies that drift from the shared one — not just symlinks into it.
 *
 * A miss here is a `warn`, never a `fail`, and that is not a hedge: the skill's own capability gate
 * (`SKILL.md` §1) depends on none of this. It runs `refs --version` and compares the result against
 * the pin in the file the agent has already loaded, so a skill this check cannot see still gates
 * itself correctly. This check is a convenience for whoever runs `refs doctor`, not the gate.
 *
 * Order: the canonical global first, so a symlinked install is named by the directory holding the
 * real copy rather than by whichever agent links at it (`uniqueByRealPath` keeps the first entry);
 * then the two per-agent globals; then project scope last — the narrowest reach, and the only entry
 * whose meaning depends on where `refs doctor` happened to be run. */
const skillCandidatesOf = (ctx: CliContext): SkillCandidate[] => {
  const home = ctx.env['HOME'];
  const locations = [
    { base: home, label: 'shared ~/.agents', segments: AGENTS_SKILL_SEGMENTS },
    {
      base: agentHomeOf({
        dirName: '.claude',
        env: ctx.env,
        home,
        overrideName: 'CLAUDE_CONFIG_DIR',
      }),
      label: 'Claude Code',
      segments: AGENT_HOME_SKILL_SEGMENTS,
    },
    {
      base: agentHomeOf({ dirName: '.codex', env: ctx.env, home, overrideName: 'CODEX_HOME' }),
      label: 'Codex',
      segments: AGENT_HOME_SKILL_SEGMENTS,
    },
    { base: ctx.cwd, label: 'project ./.agents', segments: AGENTS_SKILL_SEGMENTS },
  ];
  return locations.flatMap(({ base, label, segments }) =>
    base === undefined ? [] : [{ label, path: join(base, ...segments) }],
  );
};

type FoundSkill = {
  label: string;
  realPath: string;
  source: string;
};

/** `realpath` before `readFile` so a symlinked install can be recognised as one copy rather than
 * several. A throw is never a problem to report: an absent path (the usual case — nobody has all
 * four) and an unreadable one both mean "nothing to compare here", and an install that exists
 * nowhere falls through to `NOT_FOUND` below. Read-only throughout: `refs` writes nothing outside
 * `REFS_HOME`, and this check touches no path with anything but `realpath`/`readFile`. */
const readSkillAt = async (path: string, label: string): Promise<FoundSkill | undefined> => {
  try {
    const resolved = await realpath(path);
    return { label, realPath: resolved, source: await readFile(resolved, 'utf8') };
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

/** Deliberately not "refs skill not found": with env-overridable per-agent directories, project
 * scope as the installer's default, and 70-odd agent directories this deliberately does not look
 * at, "it is not installed" is not a claim this check can make. So it says what it actually knows —
 * which places it looked — and keeps the install hint for the case where the skill really is
 * missing. One line, because both a human and an agent read it. */
const NOT_FOUND: CheckResult = {
  detail: `refs skill not found in the locations this check knows about (~/.agents, ~/.claude, ~/.codex, ./.agents) — an install anywhere else is invisible here and still works; if it really is missing: ${SKILL_INSTALL_HINT}`,
  name: 'skill',
  status: 'warn',
};

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
  const found = await Promise.all(
    skillCandidatesOf(ctx).map((candidate) => readSkillAt(candidate.path, candidate.label)),
  );
  const checks = uniqueByRealPath(found.filter((entry) => entry !== undefined)).map((entry) =>
    buildSkillVersionCheck({
      cliVersion: ctx.cliVersion,
      label: entry.label,
      skillVersion: skillCliVersionOf(entry.source),
    }),
  );
  return checks.find((check) => check.status !== 'ok') ?? checks[0] ?? NOT_FOUND;
};

export { checkSkill };
