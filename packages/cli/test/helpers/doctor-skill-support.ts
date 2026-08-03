import { mkdir, symlink, writeFile } from 'node:fs/promises';
import type { CheckResult } from '../../src/commands/doctor-types.ts';
import { checkSkill } from '../../src/commands/doctor-checks-skill.ts';
import { join } from 'node:path';
import { testContext } from './context.ts';

// Shared fixtures for the two `skill` check suites — `doctor-skill-version.test.ts` (the version
// comparison and the frontmatter parsing) and `doctor-skill-locations.test.ts` (which places are
// searched and how duplicates collapse). Split in two purely to keep both files under the repo's
// 300-line oxlint cap, mirroring the src-side split into `doctor-checks-skill.ts`.

const skillSource = (cliVersion: string): string =>
  `---\nname: refs\ndescription: x\nmetadata:\n  cli_version: "${cliVersion}"\n---\n\n# refs\n`;

/** Writes a fixture `SKILL.md` into `<dir>/skills/refs/` — the tail every install location in
 * `doctor-checks-skill.ts` ends in, whether `<dir>` is `~/.agents`, an agent's own home, or a
 * project's `.agents`. */
const writeSkillIn = async (dir: string, source: string): Promise<void> => {
  const skillDir = join(dir, 'skills', 'refs');
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), source, 'utf8');
};

const writeSkillAt = (base: string, subDir: string, source: string): Promise<void> =>
  writeSkillIn(join(base, subDir), source);

// What `skills add` actually builds: one real copy under `<base>/.agents/skills/refs`, with each
// non-universal agent's own directory symlinked at it. The symlink is created unconditionally
// rather than behind a platform guard, matching `remove.test.ts`'s own directory symlink — the
// Windows leg of CI runs elevated enough to create one, and a silent skip would hide a regression
// on the platform.
const linkAgentDirToShared = async (base: string, subDir: string): Promise<void> => {
  await mkdir(join(base, subDir, 'skills'), { recursive: true });
  await symlink(join(base, '.agents', 'skills', 'refs'), join(base, subDir, 'skills', 'refs'));
};

type SkillCheckOverrides = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

/** Drives `checkSkill(ctx)` directly rather than the full `refs doctor --json` pipeline: the check
 * reads nothing but `ctx.cliVersion`, `ctx.cwd` and three `ctx.env` keys, so a `refs init` home
 * plus a scripted `git --version` would add setup without adding coverage. `doctor.test.ts` still
 * covers the end-to-end wiring through `run`.
 *
 * `homeDir` is a `withTempHome` `mkdtemp` directory, never the real `$HOME`, and `ctx.cwd` keeps
 * `testContext()`'s deliberately non-existent default unless a test overrides it — so the check
 * only ever sees fixtures the test wrote. */
const skillCheckOf = (
  homeDir: string,
  cliVersion: string,
  overrides: SkillCheckOverrides = {},
): Promise<CheckResult> => {
  const { ctx } = testContext();
  Object.assign(ctx.env, { HOME: homeDir, ...overrides.env });
  ctx.cliVersion = cliVersion;
  ctx.cwd = overrides.cwd ?? ctx.cwd;
  return checkSkill(ctx);
};

export { linkAgentDirToShared, skillCheckOf, skillSource, writeSkillAt, writeSkillIn };
export type { SkillCheckOverrides };
