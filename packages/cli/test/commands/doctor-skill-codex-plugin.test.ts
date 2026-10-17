import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { skillCheckOf, skillSource, writeSkillAt } from '../helpers/doctor-skill-support.ts';
import { join } from 'node:path';
import { withTempHome } from '../helpers/add-support.ts';

// `doctor`'s `skill` check against a Codex plugin install. `codex plugin add refs@<marketplace>`
// copies the plugin root (`skills/` in this repository) into
// `<codex home>/plugins/cache/<marketplace>/refs/<version>/` and loads the skill from there, so the
// file the agent reads is `<version>/refs/SKILL.md`. Before the plugin existed the check looked only
// where `skills add` and a manual copy put the skill, and a plugin-only install read as missing.

const CURRENT = '0.5.1';
const STALE = '0.4.0';
const PLUGIN_HINT = 'codex plugin marketplace upgrade';
const INSTALLER_HINT = 'npx skills add kaisers-io/refs';

type PluginInstall = {
  codexHome: string;
  marketplace?: string;
  plugin?: string;
  version: string;
};

/** Writes the tree Codex 0.163 leaves after `codex plugin add` — observed, not assumed. */
const writePluginInstall = async (install: PluginInstall, source: string): Promise<void> => {
  const { codexHome, marketplace = 'kaisers-io', plugin = 'refs', version } = install;
  const root = join(codexHome, 'plugins', 'cache', marketplace, plugin, version);
  await mkdir(join(root, '.codex-plugin'), { recursive: true });
  await writeFile(join(root, '.codex-plugin', 'plugin.json'), '{"name":"refs"}\n', 'utf8');
  await mkdir(join(root, 'refs'), { recursive: true });
  await writeFile(join(root, 'refs', 'SKILL.md'), source, 'utf8');
};

describe('doctor: skill check finds a Codex plugin install', () => {
  it('reports ok for a plugin-only install under ~/.codex', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      await writePluginInstall({ codexHome, version: CURRENT }, skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('ok');
      expect(result.detail).toBe(
        `Codex plugin: the refs skill is installed and matches this CLI (${CURRENT})`,
      );
    });
  });

  it('follows $CODEX_HOME, as Codex does', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, 'elsewhere');
      await writePluginInstall({ codexHome, version: CURRENT }, skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT, { env: { CODEX_HOME: codexHome } });
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('Codex plugin');
    });
  });

  it('finds the plugin whatever the marketplace is called', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      const install = { codexHome, marketplace: 'a-fork', version: CURRENT };
      await writePluginInstall(install, skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('ok');
    });
  });

  it('ignores another plugin in the same cache', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      const install = { codexHome, plugin: 'not-refs', version: CURRENT };
      await writePluginInstall(install, skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('refs skill not found');
    });
  });
});

describe('doctor: a stale Codex plugin is updated through Codex', () => {
  // The installer's command would add a second copy beside the plugin rather than update it.
  it('names the Codex upgrade command, not the skills installer', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      await writePluginInstall({ codexHome, version: STALE }, skillSource(STALE));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('warn');
      expect(result.detail).toBe(
        `Codex plugin: the refs skill targets CLI ${STALE} but this CLI is ${CURRENT} — update the skill: ${PLUGIN_HINT}`,
      );
    });
  });

  it('names the Codex upgrade command for a plugin copy without a version pin', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      await writePluginInstall({ codexHome, version: CURRENT }, '---\nname: refs\n---\n');
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain(PLUGIN_HINT);
      expect(result.detail).not.toContain(INSTALLER_HINT);
    });
  });
});

describe('doctor: plugin and standalone skill installed together', () => {
  // Both installed is the duplicate case (`refs` and `refs:refs` in Codex's skill list). Each copy
  // is checked, so a current standalone copy must not hide a stale plugin.
  it('lets a stale plugin win over a current standalone copy', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      await writeSkillAt(homeDir, '.agents', skillSource(CURRENT));
      await writePluginInstall({ codexHome, version: STALE }, skillSource(STALE));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('Codex plugin');
      expect(result.detail).toContain(PLUGIN_HINT);
    });
  });

  it('keeps the installer command for a stale standalone copy beside a current plugin', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      await writeSkillAt(homeDir, '.agents', skillSource(STALE));
      await writePluginInstall({ codexHome, version: CURRENT }, skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('shared ~/.agents');
      expect(result.detail).toContain(INSTALLER_HINT);
    });
  });
});

describe('doctor: the not-found message names the plugin cache', () => {
  it('lists the cache under the Codex home it searched', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, 'elsewhere');
      const result = await skillCheckOf(homeDir, CURRENT, { env: { CODEX_HOME: codexHome } });
      expect(result.status).toBe('warn');
      expect(result.detail).toContain(`${codexHome}/plugins/cache`);
    });
  });

  // No home directory and no `$CODEX_HOME`: there is no Codex home to search, so the message must
  // not claim a plugin cache was looked at, least of all one relative to the working directory.
  it('names no plugin cache when there is no Codex home', async () => {
    expect.hasAssertions();
    const result = await skillCheckOf('', CURRENT);
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('refs skill not found');
    expect(result.detail).not.toContain('plugins/cache');
  });

  it('uses the tilde form without an override', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.detail).toContain('~/.codex/plugins/cache');
    });
  });
});
