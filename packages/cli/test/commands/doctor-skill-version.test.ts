import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
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

const writeSkill = async (homeDir: string, frontmatter: string): Promise<void> => {
  const dir = join(homeDir, '.claude', 'skills', 'refs');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), frontmatter, 'utf8');
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

  it('falls back to "reinstall both" when a version is not a plain x.y.z', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, skillSource('1.0.0-rc.1'));
      const result = await skillCheckOf(homeDir, '1.0.0');
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('reinstall both');
    });
  });
});

describe('doctor: skill check version ordering and frontmatter shapes', () => {
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

  it('parses CRLF frontmatter and ignores a --- rule in the body', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(
        homeDir,
        '---\r\nname: refs\r\nmetadata:\r\n  cli_version: "0.5.1"\r\n---\r\n\r\n# refs\r\n\r\n---\r\n',
      );
      const result = await skillCheckOf(homeDir, '0.5.1');
      expect(result.status).toBe('ok');
    });
  });
});

describe('doctor: skill check across both agent homes', () => {
  it('lets a stale Claude Code copy win over a current Codex copy', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkill(homeDir, skillSource('0.4.0'));
      const codexDir = join(homeDir, '.codex', 'skills', 'refs');
      await mkdir(codexDir, { recursive: true });
      await writeFile(join(codexDir, 'SKILL.md'), skillSource('0.5.1'), 'utf8');

      const result = await skillCheckOf(homeDir, '0.5.1');

      expect(result.status).toBe('warn');
      expect(result.detail).toContain('Claude Code');
    });
  });
});
