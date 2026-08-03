import { describe, expect, it } from 'vitest';
import { skillCheckOf, skillSource, writeSkillAt } from '../helpers/doctor-skill-support.ts';
import { withTempHome } from '../helpers/add-support.ts';

// `doctor`'s `skill` check compared against the CLI version the installed skill pins in its
// frontmatter (`metadata.cli_version`). The skill ships from git (`skills add`) while the CLI ships
// from npm (`npm i -g`), so the two can drift apart silently and this check is the only thing that
// ever notices. Split out of `doctor.test.ts` (already ~283 lines) purely to keep both files under
// the repo's 300-line oxlint cap — the same reason `show-payload.test.ts` exists — and the
// `describe` blocks below are split by theme only to stay under `max-lines-per-function`.
//
// WHICH locations are searched, and how duplicate copies of one skill collapse, is the sibling
// `doctor-skill-locations.test.ts`; everything here writes its fixture into a single location and
// varies only the file's contents.

const writeSkill = (homeDir: string, frontmatter: string): Promise<void> =>
  writeSkillAt(homeDir, '.claude', frontmatter);

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
