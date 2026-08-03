import { describe, expect, it } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import type { CheckResult } from '../../src/commands/doctor-types.ts';
import { checkSkill } from '../../src/commands/doctor-checks-basic.ts';
import { join } from 'node:path';
import { testContext } from '../helpers/context.ts';
import { withTempHome } from '../helpers/add-support.ts';

// `doctor`'s `skill` check compared against the CLI version the installed skill pins in its
// frontmatter (`metadata.cli_version`). The skill ships from git (`npx skills add`) while the CLI
// ships from npm (`npm i -g`), so the two can drift apart silently and this check is the only
// thing that ever notices. Split out of `doctor.test.ts` (already ~283 lines) purely to keep both
// files under the repo's 300-line oxlint cap — the same reason `show-payload.test.ts` exists — and
// the `describe` blocks below are split by theme only to stay under `max-lines-per-function`.
//
// These drive `checkSkill(ctx)` directly rather than the full `refs doctor --json` pipeline: the
// check reads nothing but `ctx.env['HOME']` and `ctx.cliVersion`, so a `refs init` home plus a
// scripted `git --version` would add setup without adding coverage. `doctor.test.ts` still covers
// the end-to-end wiring through `run`.

const writeSkillAt = async (homeDir: string, agentDir: string, source: string): Promise<void> => {
  const dir = join(homeDir, agentDir, 'skills', 'refs');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), source, 'utf8');
};

const writeSkill = (homeDir: string, frontmatter: string): Promise<void> =>
  writeSkillAt(homeDir, '.claude', frontmatter);

// What `npx skills add` actually builds: one real copy under `~/.agents/skills/refs`, with each
// agent's own directory symlinked at it. The symlink is created unconditionally rather than behind
// a platform guard, matching `remove.test.ts`'s own directory symlink — the Windows leg of CI runs
// elevated enough to create one, and a silent skip would hide a regression on the platform.
const linkAgentDirToShared = async (homeDir: string, agentDir: string): Promise<void> => {
  await mkdir(join(homeDir, agentDir, 'skills'), { recursive: true });
  await symlink(
    join(homeDir, '.agents', 'skills', 'refs'),
    join(homeDir, agentDir, 'skills', 'refs'),
  );
};

const skillSource = (cliVersion: string): string =>
  `---\nname: refs\ndescription: x\nmetadata:\n  cli_version: "${cliVersion}"\n---\n\n# refs\n`;

// `withTempHome` hands back a fresh `mkdtemp` directory (not the real `$HOME`), so pointing
// `ctx.env['HOME']` at it is what makes the check read the fixture skill rather than whatever the
// developer running the suite happens to have installed.
const skillCheckOf = (homeDir: string, cliVersion: string): Promise<CheckResult> => {
  const { ctx } = testContext();
  ctx.env['HOME'] = homeDir;
  ctx.cliVersion = cliVersion;
  return checkSkill(ctx);
};

describe('doctor: skill check compares the pinned CLI version', () => {
  it('reports ok when the pinned version equals the running CLI', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, skillSource('0.5.1'));
      const result = await skillCheckOf(homeDir, '0.5.1');
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('0.5.1');
    });
  });

  it('tells the user to update the CLI when the skill targets a newer one', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, skillSource('0.6.0'));
      const result = await skillCheckOf(homeDir, '0.5.1');
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('npm i -g @kaisers-io/refs@latest');
    });
  });

  it('tells the user to update the skill when the skill is older', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, skillSource('0.4.0'));
      const result = await skillCheckOf(homeDir, '0.5.1');
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('npx skills add kaisers-io/refs');
    });
  });
});

describe('doctor: skill check without a usable pin', () => {
  it('warns when the installed skill predates the version gate', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, '---\nname: refs\ndescription: x\n---\n\n# refs\n');
      const result = await skillCheckOf(homeDir, '0.5.1');
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('predates');
    });
  });

  it('still reports a missing skill as not installed', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const result = await skillCheckOf(homeDir, '0.5.1');
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('refs skill not found');
    });
  });
});

// Both sides of the comparison are parsed, so both sides can be unparseable — and the CLI side is
// the arm a skill-only fixture never reaches. `1.0x2.3` is here because `Number('0x2') === 2`: it
// would compare equal to `1.2.3` and report `ok` if the parser ever went back to a bare split.
describe('doctor: skill check with versions it cannot compare', () => {
  it('falls back to "reinstall both" when the skill pin is not a plain x.y.z', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, skillSource('1.0.0-rc.1'));
      const result = await skillCheckOf(homeDir, '1.0.0');
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('reinstall both');
    });
  });

  it('rejects a skill pin whose parts are not plain decimals', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, skillSource('1.0x2.3'));
      const result = await skillCheckOf(homeDir, '1.2.3');
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('reinstall both');
    });
  });

  it('falls back to "reinstall both" when the running CLI version is not parseable', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, skillSource('0.5.1'));
      const result = await skillCheckOf(homeDir, '0.5.1-dev.3');
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('reinstall both');
    });
  });
});

describe('doctor: skill check version ordering', () => {
  it('orders 0.10.0 above 0.9.0 numerically, not lexically', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, skillSource('0.10.0'));
      const result = await skillCheckOf(homeDir, '0.9.0');
      expect(result.detail).toContain('update the CLI');
    });
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, skillSource('0.9.0'));
      const result = await skillCheckOf(homeDir, '0.10.0');
      expect(result.detail).toContain('update the skill');
    });
  });
});

describe('doctor: skill check frontmatter shapes', () => {
  it('reads a single-quoted and a bare frontmatter value', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, "---\nmetadata:\n  cli_version: '0.5.1'\n---\n\n# refs\n");
      const result = await skillCheckOf(homeDir, '0.5.1');
      expect(result.status).toBe('ok');
    });
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, '---\nmetadata:\n  cli_version: 0.5.1\n---\n\n# refs\n');
      const result = await skillCheckOf(homeDir, '0.5.1');
      expect(result.status).toBe('ok');
    });
  });

  it('parses CRLF frontmatter and stops at the first closing delimiter', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(
        homeDir,
        '---\r\nname: refs\r\nmetadata:\r\n  cli_version: "0.5.1"\r\n---\r\n\r\n# refs\r\n\r\n---\r\nmetadata:\r\n  cli_version: "9.9.9"\r\n',
      );
      const result = await skillCheckOf(homeDir, '0.5.1');
      expect(result.status).toBe('ok');
      expect(result.detail).not.toContain('9.9.9');
    });
  });

  // The discriminating half of the rule above: with no pin inside the real frontmatter, a capture
  // that ran past the first closing `---` would find the body's `9.9.9` and report a version
  // mismatch instead of "predates the version gate".
  it('never reads a cli_version that lives only after the frontmatter', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(
        homeDir,
        '---\nname: refs\n---\n\n# refs\n\n---\nmetadata:\n  cli_version: "9.9.9"\n',
      );
      const result = await skillCheckOf(homeDir, '0.5.1');
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('predates');
    });
  });
});

describe('doctor: skill check across both agent homes', () => {
  it('lets a stale Claude Code copy win over a current Codex copy', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkillAt(homeDir, '.claude', skillSource('0.4.0'));
      await writeSkillAt(homeDir, '.codex', skillSource('0.5.1'));

      const result = await skillCheckOf(homeDir, '0.5.1');

      expect(result.status).toBe('warn');
      expect(result.detail).toContain('Claude Code');
    });
  });

  // The direction that actually discriminates: `SKILL_LOCATIONS` lists Claude Code first, so an
  // implementation that simply reported the first home it found would pass the case above
  // unchanged and fail only here.
  it('lets a stale Codex copy win over a current Claude Code copy', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkillAt(homeDir, '.claude', skillSource('0.5.1'));
      await writeSkillAt(homeDir, '.codex', skillSource('0.4.0'));

      const result = await skillCheckOf(homeDir, '0.5.1');

      expect(result.status).toBe('warn');
      expect(result.detail).toContain('Codex');
    });
  });
});

// `~/.agents/skills/refs` is where `npx skills add` puts the only real copy; the per-agent homes
// are symlinks into it. Before v0.6.1 the check never looked there, so a Codex-only user — who has
// no `.claude` symlink to rescue the lookup — was told a correctly installed skill was missing.
describe('doctor: skill check in the shared ~/.agents home', () => {
  it('reports ok for a skill installed only under .agents', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkillAt(homeDir, '.agents', skillSource('0.5.1'));

      const result = await skillCheckOf(homeDir, '0.5.1');

      // Neither `.claude` nor `.codex` exists here, so this also pins the rule that an absent
      // location is silently skipped: `realpath` throwing ENOENT is the normal "not installed
      // here" case, never a problem of its own, or this would report `warn`.
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('shared ~/.agents');
    });
  });

  it('reports a symlinked Claude Code home once, under the shared label', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkillAt(homeDir, '.agents', skillSource('0.5.1'));
      await linkAgentDirToShared(homeDir, '.claude');

      const result = await skillCheckOf(homeDir, '0.5.1');

      expect(result.status).toBe('ok');
      expect(result.detail).toContain('shared ~/.agents');
      expect(result.detail).not.toContain('Claude Code');
    });
  });
});

// The shared home does not replace the per-agent ones: a manual `cp -r` into `~/.claude/skills` is
// still a real, separate copy that can drift on its own, so both are read and the "a problem in
// either wins" rule spans them. Both directions, because `.agents` is checked first and an
// implementation that just reported the first hit would pass only one of them.
describe('doctor: skill check across the shared home and an agent home', () => {
  it('lets a stale .claude copy win over a current .agents copy', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkillAt(homeDir, '.agents', skillSource('0.5.1'));
      await writeSkillAt(homeDir, '.claude', skillSource('0.4.0'));

      const result = await skillCheckOf(homeDir, '0.5.1');

      expect(result.status).toBe('warn');
      expect(result.detail).toContain('Claude Code');
    });
  });

  it('lets a stale .agents copy win over a current .claude copy', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkillAt(homeDir, '.agents', skillSource('0.4.0'));
      await writeSkillAt(homeDir, '.claude', skillSource('0.5.1'));

      const result = await skillCheckOf(homeDir, '0.5.1');

      expect(result.status).toBe('warn');
      expect(result.detail).toContain('shared ~/.agents');
    });
  });
});
