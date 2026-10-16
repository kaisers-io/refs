import type { CliContext } from '../context.ts';
import { join } from 'node:path';

const AGENTS_SKILL_SEGMENTS = ['.agents', 'skills', 'refs', 'SKILL.md'] as const;
const AGENT_HOME_SKILL_SEGMENTS = ['skills', 'refs', 'SKILL.md'] as const;
const PROJECT_CLAUDE_SKILL_SEGMENTS = ['.claude', 'skills', 'refs', 'SKILL.md'] as const;

type SkillCandidate = {
  display: string;
  label: string;
  path: string;
  plugin?: boolean;
};

/** A location's base directory paired with the short form the "not found" message names it by. The
 * two always travel together because an env override moves both at once: `$CLAUDE_CONFIG_DIR` does
 * not just change where the check looks, it changes which directory it is honest to name. */
type SkillRoot = {
  display: string;
  path: string;
};

const rootOf = (path: string | undefined, display: string): SkillRoot | undefined =>
  path === undefined ? undefined : { display, path };

/** One agent's own configuration directory, honouring the installer's env override
 * (`$CLAUDE_CONFIG_DIR`, `$CODEX_HOME`) exactly as `vercel-labs/skills`' `src/agents.ts` resolves
 * it: a set, non-blank override wins over `<home>/<dirName>` outright — a user who sets either has
 * no `~/.claude`/`~/.codex` at all. Read through `ctx.env`, never `process.env`, like every other
 * environment read in this package — the overrides still come from the environment, only the home
 * directory behind them does not. An absent home with no override yields no candidate rather than
 * a `join()` on `undefined`. */
type AgentHomeArgs = {
  dirName: string;
  env: NodeJS.ProcessEnv;
  home: string | undefined;
  overrideName: string;
};

const agentHomeOf = (args: AgentHomeArgs): SkillRoot | undefined => {
  const { dirName, env, home, overrideName } = args;
  const override = env[overrideName]?.trim();
  if (override !== undefined && override.length > 0) {
    return { display: override, path: override };
  }
  return rootOf(home === undefined ? undefined : join(home, dirName), `~/${dirName}`);
};

/** The locations an installed skill is looked for — best-effort, and deliberately short.
 *
 * None of these paths is a stable contract. They are `vercel-labs/skills`' implementation detail:
 * the canonical directory has moved before, the README table documenting it is generated from the
 * installer's own source (and is already wrong for Codex), and 74 agents carry a global directory
 * each. Enumerating them is not a strategy, so this covers the installer's canonical location plus
 * the two agents `refs` documents an invocation for, Claude Code and Codex. Three consequences
 * worth knowing:
 *
 * - Project scope is the installer's DEFAULT (`-g` is opt-in), and `skills add` implies `-y` when
 *   it detects it is running inside an agent — so an agent-driven install lands in
 *   `<cwd>/.agents/skills/refs` and never touches `$HOME`. That is why the project entries exist.
 * - A single-target install (`skills add … -a claude-code`, with or without `-g`) silently switches
 *   to copy mode, as does a symlink failure on a filesystem without symlink support, so the
 *   per-agent directories can hold real, independent copies that drift from the shared one — not
 *   just symlinks into it.
 * - Copy mode skips the canonical directory outright, so `-a claude-code` at project scope — the
 *   installer's default scope — writes ONLY `<cwd>/.claude/skills/refs`, and nothing under
 *   `.agents` at all. That is the last entry, and note it takes NO env override: unlike the global
 *   directory, the installer's project path is a literal relative `.claude/skills`, so
 *   `$CLAUDE_CONFIG_DIR` does not move it. Codex needs no counterpart: it is a universal agent, so
 *   its project install resolves to `./.agents/skills` in every mode, copy included.
 *
 * The three global entries resolve their base from `ctx.homedir`, which `realContext()` fills from
 * `os.homedir()` — the same call the installer makes. Reading `$HOME` instead used to agree with it
 * everywhere except native Windows, where the variable is typically unset: all three entries
 * vanished there and a correctly installed skill reported as missing.
 *
 * A miss here is a `warn`, never a `fail`, and that is not a hedge: the skill's own capability gate
 * (`SKILL.md` §1) depends on none of this. It runs `refs --version` and compares the result against
 * the pin in the file the agent has already loaded, so a skill this check cannot see still gates
 * itself correctly. This check is a convenience for whoever runs `refs doctor`, not the gate.
 *
 * Order: the canonical global first, so a symlinked install is named by the directory holding the
 * real copy rather than by whichever agent links at it (`uniqueByRealPath` keeps the first entry);
 * then the two per-agent globals; then project scope last — the narrowest reach, and the only pair
 * whose meaning depends on where `refs doctor` happened to be run, canonical before per-agent there
 * too, for the same reason. */
const skillCandidatesOf = (ctx: CliContext): SkillCandidate[] => {
  // An empty `homedir` is treated as no home at all: `os.homedir()` returns a string on every
  // platform, but a blank one would turn `join(home, '.agents')` into a path relative to the
  // process's cwd — a lookup somewhere nobody installs to, reported as if it were `~`.
  const home = ctx.homedir.length > 0 ? ctx.homedir : undefined;
  const locations = [
    { label: 'shared ~/.agents', root: rootOf(home, '~/.agents'), segments: AGENTS_SKILL_SEGMENTS },
    {
      label: 'Claude Code',
      root: agentHomeOf({
        dirName: '.claude',
        env: ctx.env,
        home,
        overrideName: 'CLAUDE_CONFIG_DIR',
      }),
      segments: AGENT_HOME_SKILL_SEGMENTS,
    },
    {
      label: 'Codex',
      root: agentHomeOf({ dirName: '.codex', env: ctx.env, home, overrideName: 'CODEX_HOME' }),
      segments: AGENT_HOME_SKILL_SEGMENTS,
    },
    {
      label: 'project ./.agents',
      root: rootOf(ctx.cwd, './.agents'),
      segments: AGENTS_SKILL_SEGMENTS,
    },
    {
      label: 'project ./.claude',
      root: rootOf(ctx.cwd, './.claude'),
      segments: PROJECT_CLAUDE_SKILL_SEGMENTS,
    },
  ];
  return locations.flatMap(({ label, root, segments }) =>
    root === undefined
      ? []
      : [{ display: root.display, label, path: join(root.path, ...segments) }],
  );
};

export { skillCandidatesOf };
export type { SkillCandidate };
