import { describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import {
  skillCheckOf,
  skillSource,
  writeSkillAt,
  writeSkillIn,
} from '../helpers/doctor-skill-support.ts';
import { join } from 'node:path';
import { withTempHome } from '../helpers/add-support.ts';

const CURRENT = '0.18.2';
const OLD = '0.17.0';
const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const UPDATE = 'codex plugin add refs@refs';

const install = async (codexHome: string, version = CURRENT, pin = version): Promise<string> => {
  const root = join(codexHome, 'plugins', 'cache', 'refs', 'refs', version);
  await writeSkillIn(root, skillSource(pin));
  await writeFile(
    join(root, 'plugin.json'),
    JSON.stringify({ $schema: SCHEMA, name: 'refs', version }),
  );
  await writeFile(join(codexHome, 'config.toml'), '[plugins."refs@refs"]\nenabled = true\n');
  return root;
};

const checkPlugin = (home: string) => skillCheckOf(home, CURRENT);

describe('doctor: the supported Codex plugin installation', () => {
  it('recognizes a plugin-only install', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await install(join(home, '.codex'));
      const result = await checkPlugin(home);
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('Codex plugin refs@refs');
    });
  });

  it('uses CODEX_HOME instead of the default home', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await install(join(home, '.codex'), OLD);
      const override = join(home, 'custom');
      await install(override);
      const result = await skillCheckOf(home, CURRENT, { env: { CODEX_HOME: override } });
      expect(result.status).toBe('ok');
    });
  });

  it('reads the skill pin, not only the plugin version', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await install(join(home, '.codex'), CURRENT, OLD);
      const result = await checkPlugin(home);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain(UPDATE);
      expect(result.detail).not.toContain('npx skills add');
    });
  });
});

describe('doctor: duplicate plugin and standalone installations', () => {
  it('reports matching copies without a false version mismatch', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await install(join(home, '.codex'));
      await writeSkillAt(home, '.agents', skillSource(CURRENT));
      const result = await checkPlugin(home);
      expect(result.status).toBe('ok');
      expect(result.detail).toContain('both plugin and standalone');
      expect(result.detail).toContain('refs and refs:refs');
    });
  });

  it('does not hide a stale standalone copy behind a current plugin', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await install(join(home, '.codex'));
      await writeSkillAt(home, '.agents', skillSource(OLD));
      const result = await checkPlugin(home);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain('npx skills add');
    });
  });

  it('does not hide a stale plugin behind a current standalone copy', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await install(join(home, '.codex'), OLD);
      await writeSkillAt(home, '.agents', skillSource(CURRENT));
      const result = await checkPlugin(home);
      expect(result.status).toBe('warn');
      expect(result.detail).toContain(UPDATE);
    });
  });
});

describe('doctor: inactive and invalid plugin state', () => {
  it.each([
    '[plugins."refs@refs"]\nenabled = false\n',
    '',
    '[plugins."other@refs"]\nenabled = true\n',
    'not valid toml',
  ])('does not count inactive cache: %s', async (config) => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await install(join(home, '.codex'));
      await writeFile(join(home, '.codex', 'config.toml'), config);
      const result = await checkPlugin(home);
      expect(result.detail).toContain('not found');
    });
  });

  it.each(['plugin.json', 'skills/refs/SKILL.md'])(
    'reports an enabled broken installation: %s',
    async (file) => {
      expect.hasAssertions();
      await withTempHome(async (home) => {
        const root = await install(join(home, '.codex'));
        await rm(join(root, file));
        const result = await checkPlugin(home);
        expect(result.status).toBe('warn');
        expect(result.detail).toContain('could not be verified');
      });
    },
  );

  it.each([
    'null',
    '{',
    '{"name":"other"}',
    JSON.stringify({ $schema: SCHEMA, name: 'refs', version: OLD }),
  ])('rejects an invalid manifest: %s', async (manifest) => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      const root = await install(join(home, '.codex'));
      await writeFile(join(root, 'plugin.json'), manifest);
      const result = await checkPlugin(home);
      expect(result.detail).toContain('could not be verified');
    });
  });
});

describe('doctor: Codex cache version selection', () => {
  it('ignores an old cache when a newer release is active', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await install(join(home, '.codex'), '0.9.0');
      await install(join(home, '.codex'));
      const result = await checkPlugin(home);
      expect(result.status).toBe('ok');
    });
  });

  it('accepts a single prerelease installation without guessing ordering', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await install(join(home, '.codex'), '0.19.0-rc.1', CURRENT);
      const result = await checkPlugin(home);
      expect(result.status).toBe('ok');
    });
  });

  it('reports ambiguous non-plain caches as unverifiable', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await install(join(home, '.codex'), '0.19.0-rc.1');
      await install(join(home, '.codex'));
      const result = await checkPlugin(home);
      expect(result.detail).toContain('could not be verified');
    });
  });
});

describe('doctor: unusual Codex cache entries', () => {
  it('gives local the same precedence as Codex', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      await install(join(home, '.codex'));
      await install(join(home, '.codex'), 'local', OLD);
      const result = await checkPlugin(home);
      expect(result.status).toBe('warn');
    });
  });

  it('reports an empty enabled cache as unverifiable', async () => {
    expect.hasAssertions();
    await withTempHome(async (home) => {
      const root = await install(join(home, '.codex'));
      await rm(root, { recursive: true });
      await writeFile(join(root, '..', 'README'), 'not a version directory');
      await mkdir(join(root, '..', 'bad version'));
      const result = await checkPlugin(home);
      expect(result.detail).toContain('could not be verified');
    });
  });
});
