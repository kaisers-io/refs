import { describe, expect, it } from 'vitest';
import { skillCheckOf, skillSource, writePluginInstall } from '../helpers/doctor-skill-support.ts';
import { join } from 'node:path';
import { withTempHome } from '../helpers/add-support.ts';
import { writeFile } from 'node:fs/promises';

// Which Codex plugin cache copies the `skill` check believes, measured against Codex 0.163.0 with a
// scratch `CODEX_HOME`: app-server `skills/list` says what Codex actually loads. Codex loads one
// version directory per plugin (the greatest, by semver), loads `refs:refs` from ANY marketplace
// that publishes a plugin called `refs`, and keeps a disabled plugin's cache in place. The check
// used to read every `<marketplace>/refs/<version>` directory and call each one installed.

const CURRENT = '0.5.1';
const STALE = '0.4.0';
const PLUGIN_LABEL = 'Codex plugin refs@kaisers-io (enabled state not checked)';
const PLUGIN_HINT = 'codex plugin marketplace upgrade';

const disablePlugin = (codexHome: string): Promise<void> =>
  writeFile(
    join(codexHome, 'config.toml'),
    '[plugins."refs@kaisers-io"]\nenabled = false\n',
    'utf8',
  );

describe('doctor: only the cached version Codex loads is checked', () => {
  // `codex plugin marketplace upgrade` replaces the directory, but nothing stops an older one from
  // surviving an interrupted upgrade or a manual copy. Codex loads the greatest and ignores it.
  it('ignores a stale leftover below the version Codex loads', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      await writePluginInstall({ codexHome, version: '0.18.1' }, skillSource(STALE));
      await writePluginInstall({ codexHome, version: '0.18.2' }, skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result).toStrictEqual({
        detail: `${PLUGIN_LABEL}: the refs skill is installed and matches this CLI (${CURRENT})`,
        name: 'skill',
        status: 'ok',
      });
    });
  });

  // `0.18.10` sorts below `0.18.2` as a string. Codex orders by semver and loads `0.18.10`, so a
  // stale copy there is the one the agent reads.
  it('orders version directories by semver, not as strings', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      await writePluginInstall({ codexHome, version: '0.18.2' }, skillSource(CURRENT));
      await writePluginInstall({ codexHome, version: '0.18.10' }, skillSource(STALE));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('warn');
      expect(result.detail).toBe(
        `${PLUGIN_LABEL}: the refs skill targets CLI ${STALE} but this CLI is ${CURRENT} — update the skill: ${PLUGIN_HINT}`,
      );
    });
  });

  // `v9.9.9` sorts above `local` as a string, so only the preference itself picks `local`.
  it('prefers a `local` directory, as Codex does', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      await writePluginInstall({ codexHome, version: 'v9.9.9' }, skillSource(STALE));
      await writePluginInstall({ codexHome, version: 'local' }, skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('ok');
    });
  });
});

describe('doctor: a refs plugin from another marketplace is not this skill', () => {
  // Measured: `refs@acme` with an unrelated `refs/SKILL.md` loads in Codex as `refs:refs` too, and
  // the check used to report it as the refs skill predating the version gate.
  it('does not report a foreign refs plugin as the refs skill', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      const foreign = { codexHome, marketplace: 'acme', version: '1.0.0' };
      await writePluginInstall(foreign, '---\nname: refs\ndescription: bibliography\n---\n');
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('refs skill not found');
    });
  });

  it('checks this repository’s plugin beside a foreign one', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      const foreign = { codexHome, marketplace: 'acme', version: '1.0.0' };
      await writePluginInstall(foreign, '---\nname: refs\n---\n');
      await writePluginInstall({ codexHome, version: CURRENT }, skillSource(CURRENT));
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('refs@kaisers-io');
    });
  });
});

describe('doctor: a disabled plugin is reported as a cache copy, not as active', () => {
  // Codex stops loading a disabled plugin but keeps its cache. The check does not read Codex's
  // layered configuration, so it must not word an `ok` as if the skill were active.
  it('says the enabled state was not checked when the copy matches', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      await writePluginInstall({ codexHome, version: CURRENT }, skillSource(CURRENT));
      await disablePlugin(codexHome);
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('ok');
      expect(result.detail).toBe(
        `${PLUGIN_LABEL}: the refs skill is installed and matches this CLI (${CURRENT})`,
      );
    });
  });

  // Still a warning: the copy is stale, re-enabling the plugin would load it, and the upgrade
  // command refreshes a disabled plugin's files too (measured, and stated in Codex's docs).
  it('still names the upgrade for a stale disabled copy, labelled as unverified', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const codexHome = join(homeDir, '.codex');
      await writePluginInstall({ codexHome, version: STALE }, skillSource(STALE));
      await disablePlugin(codexHome);
      const result = await skillCheckOf(homeDir, CURRENT);
      expect(result.status).toBe('warn');
      expect(result.detail).toBe(
        `${PLUGIN_LABEL}: the refs skill targets CLI ${STALE} but this CLI is ${CURRENT} — update the skill: ${PLUGIN_HINT}`,
      );
    });
  });
});
