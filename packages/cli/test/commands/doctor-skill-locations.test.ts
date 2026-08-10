import { describe, expect, it } from 'vitest';
import {
  linkAgentDirToShared,
  skillCheckOf,
  skillSource,
  writeSkillAt,
  writeSkillIn,
} from '../helpers/doctor-skill-support.ts';
import { join } from 'node:path';
import { withTempHome } from '../helpers/add-support.ts';

// WHERE `doctor`'s `skill` check looks, and how several copies of one skill collapse into a single
// verdict. The sibling `doctor-skill-version.test.ts` owns the comparison itself; everything here
// varies the location and keeps the file contents boring.
//
// The list under test is best-effort by construction (see `doctor-checks-skill.ts`): `skills add`
// installs into the CURRENT PROJECT unless `-g` is passed, the per-agent directories move with
// `$CLAUDE_CONFIG_DIR`/`$CODEX_HOME`, and 74 agents have a global directory each. These cases pin
// the five this check does know about, plus the wording it uses when it finds nothing.

const CURRENT = '0.5.1';
const STALE = '0.4.0';

describe('doctor: skill check in the shared .agents home', () => {
  it('reports ok for a skill installed only under ~/.agents', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkillAt(homeDir, '.agents', skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT);
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
      await writeSkillAt(homeDir, '.agents', skillSource(CURRENT));
      await linkAgentDirToShared(homeDir, '.claude');
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('shared ~/.agents');
      expect(result.detail).not.toContain('Claude Code');
    });
  });
});

// `skills add` writes to `<cwd>/.agents/skills/<name>` unless `-g` is passed — project scope is the
// installer's default, and it implies `-y` when it detects it is running inside an agent, so an
// agent-driven install NEVER touches `$HOME`. Before 0.6.1 every such install reported as missing.
describe('doctor: skill check in a project .agents directory', () => {
  it('reports ok for a skill installed only under <cwd>/.agents', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const projectDir = join(homeDir, 'project');
      await writeSkillAt(projectDir, '.agents', skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT, { cwd: projectDir });
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('project ./.agents');
    });
  });

  it('lets a stale project copy win over a current global one', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const projectDir = join(homeDir, 'project');
      await writeSkillAt(homeDir, '.agents', skillSource(CURRENT));
      await writeSkillAt(projectDir, '.agents', skillSource(STALE));
      const result = await skillCheckOf(homeDir, CURRENT, { cwd: projectDir });
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('project ./.agents');
    });
  });

  // The one install the four-location list still missed. `skills add … -a claude-code` names a
  // single target directory, which silently switches the installer to copy mode, and copy mode
  // skips the canonical `.agents` directory entirely — so at project scope (the default) the only
  // thing on disk is `<cwd>/.claude/skills/refs`. Note the absent `-g`: no env override applies
  // here, because the installer's project path is a literal relative `.claude/skills`.
  it('reports ok for a single-agent project install under <cwd>/.claude', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const projectDir = join(homeDir, 'project');
      await writeSkillAt(projectDir, '.claude', skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT, {
        cwd: projectDir,
        env: { CLAUDE_CONFIG_DIR: join(homeDir, 'xdg', 'claude') },
      });
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('project ./.claude');
    });
  });
});

// `$CLAUDE_CONFIG_DIR`/`$CODEX_HOME` relocate an agent's whole configuration directory, and the
// installer honours them — so a user who sets either has no `~/.claude`/`~/.codex` at all, and
// hardcoding the tilde paths would report their skill as missing. Read through `ctx.env`, never
// `process.env`, which is what lets these cases exist without mutating the real environment.
describe('doctor: skill check honours the agent directory env overrides', () => {
  it('finds the skill under $CLAUDE_CONFIG_DIR when ~/.claude does not exist', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const claudeDir = join(homeDir, 'xdg', 'claude');
      await writeSkillIn(claudeDir, skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT, {
        env: { CLAUDE_CONFIG_DIR: claudeDir },
      });
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('Claude Code');
    });
  });

  it('finds the skill under $CODEX_HOME when ~/.codex does not exist', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexDir = join(homeDir, 'xdg', 'codex');
      await writeSkillIn(codexDir, skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT, { env: { CODEX_HOME: codexDir } });
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('Codex');
    });
  });

  // The discriminating half: an override does not widen the search, it MOVES it. A stale `~/.claude`
  // left over from before the variable was set is not the directory Claude Code reads, so reporting
  // it would send the user to fix a file nothing loads.
  it('reads $CLAUDE_CONFIG_DIR instead of ~/.claude, not in addition to it', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const claudeDir = join(homeDir, 'xdg', 'claude');
      await writeSkillIn(claudeDir, skillSource(CURRENT));
      await writeSkillAt(homeDir, '.claude', skillSource(STALE));
      const result = await skillCheckOf(homeDir, CURRENT, {
        env: { CLAUDE_CONFIG_DIR: claudeDir },
      });
      expect(result.status).toBe('ok');
    });
  });
});

// A single-target `skills add … -a claude-code -g` switches to copy mode, and so does a symlink
// failure on a filesystem without symlink support — both leave a real, independent copy in the
// agent's own directory that can drift from the shared one. Both directions, because `.agents` is
// checked first and an implementation that just reported the first hit would pass only one of them.
describe('doctor: skill check across two independent copies', () => {
  it('lets a stale .claude copy win over a current .agents copy', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkillAt(homeDir, '.agents', skillSource(CURRENT));
      await writeSkillAt(homeDir, '.claude', skillSource(STALE));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('Claude Code');
    });
  });

  it('lets a stale .agents copy win over a current .claude copy', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkillAt(homeDir, '.agents', skillSource(STALE));
      await writeSkillAt(homeDir, '.claude', skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('shared ~/.agents');
    });
  });

  it('lets a stale Codex copy win over a current Claude Code copy', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkillAt(homeDir, '.claude', skillSource(CURRENT));
      await writeSkillAt(homeDir, '.codex', skillSource(STALE));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('Codex');
    });
  });
});

// The check can only ever speak for the places it looked, so this is the one `detail` that had to
// stop claiming otherwise: "not found in the locations this check knows about", not "not installed".
describe('doctor: skill check when nothing is found', () => {
  it('names the locations it searched rather than claiming the skill is absent', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('not found in the locations this check knows about');
      expect(result.detail).toContain('~/.agents, ~/.claude, ~/.codex, ./.agents, ./.claude');
      expect(result.detail).toContain('npx skills add kaisers-io/refs');
    });
  });

  // The message is derived from the candidates rather than written out, so that it stays true when
  // an override MOVES the search: naming `~/.claude` here would send its reader — quite possibly an
  // agent acting on the `detail` — to inspect the one directory the check just skipped.
  it('names the override it searched, not the default the override replaced', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const claudeDir = join(homeDir, 'xdg', 'claude');
      const result = await skillCheckOf(homeDir, CURRENT, {
        env: { CLAUDE_CONFIG_DIR: claudeDir },
      });
      expect(result.status).toBe('warn');
      expect(result.detail).toContain(claudeDir);
      expect(result.detail).not.toContain('~/.claude');
      // The untouched neighbours still appear under their tilde form, so this pins that the
      // override replaced one entry rather than reformatting the whole list.
      expect(result.detail).toContain('~/.codex');
    });
  });
});

// The three global locations hang off `ctx.homedir` (`os.homedir()`), not off `$HOME`. The two
// agree on macOS and Linux, so only Windows ever saw the difference: `HOME` is typically unset
// there while `os.homedir()` answers from `USERPROFILE`, which used to drop all three entries and
// report a correctly installed skill as missing. Both directions are pinned here, because a
// regression to `ctx.env['HOME']` would still pass every other case in this file.
describe('doctor: skill check resolves globals from the home directory', () => {
  it('finds a global install with no HOME in the environment at all', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await writeSkillAt(homeDir, '.agents', skillSource(CURRENT));
      // `skillCheckOf` sets `ctx.homedir` and leaves `ctx.env` empty — the native Windows shape.
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('shared ~/.agents');
    });
  });

  it('ignores a HOME pointing at a different directory', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      await withTempHome(async (decoyDir) => {
        // The only install lives under the decoy that `$HOME` names. Reading the variable would
        // find it and report `ok`; reading `ctx.homedir` looks at an empty home and reports `warn`.
        await writeSkillAt(decoyDir, '.agents', skillSource(CURRENT));
        const result = await skillCheckOf(homeDir, CURRENT, { env: { HOME: decoyDir } });
        expect(result.status).toBe('warn');
        expect(result.detail).not.toContain(decoyDir);
      });
    });
  });
});
