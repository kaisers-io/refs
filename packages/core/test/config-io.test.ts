import { describe, expect, it } from 'vitest';
import { migrateConfig, readConfig, seedConfig, writeConfig } from '../src/config-io.ts';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { SCHEMA_VERSION } from '../src/schemas/config.ts';
import { join } from 'node:path';
import { resolveHome } from '../src/home.ts';
import { tmpdir } from 'node:os';

// eslint-disable-next-line node/no-sync, unicorn/max-nested-calls -- test fixture setup, sync is fine
const freshHome = () => resolveHome({ REFS_HOME: mkdtempSync(join(tmpdir(), 'refs-cfg-')) });

describe('seed + read', () => {
  it('seeds once, then noop; seeded config parses', async () => {
    expect.hasAssertions();
    const home = freshHome();
    await expect(seedConfig(home, '0.1.0')).resolves.toBe('seeded');
    await expect(seedConfig(home, '0.1.0')).resolves.toBe('noop');
    const config = await readConfig(home);
    expect(config.settings.clone_mode).toBe('blobless');
    // eslint-disable-next-line node/no-sync -- assertion reads the file written by the impl under test
    expect(readFileSync(home.configPath, 'utf8')).toContain('per-ref');
  });

  it('missing file → not_found with init hint', async () => {
    expect.hasAssertions();
    await expect(readConfig(freshHome())).rejects.toThrow(/refs init/u);
  });
});

describe('schema version gate', () => {
  it('invalid TOML → validation error', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(home.configPath, '[meta\nnot valid toml');
    await expect(readConfig(home)).rejects.toThrow(/invalid toml/iu);
  });

  it('newer schema → validation error naming upgrade', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      home.configPath,
      '[meta]\nschema_version = 999\ncli_version = "9.9.9"\n[settings]\n[refs]\n',
    );
    await expect(readConfig(home)).rejects.toThrow(/upgrade refs/u);
  });

  it('older schema → validation error naming refs migrate', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(home.configPath, '[meta]\nschema_version = 0\ncli_version = "0.0.1"\n');
    await expect(readConfig(home)).rejects.toThrow(/refs migrate/u);
  });

  it('missing meta/schema_version entirely → validation error naming refs migrate', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(home.configPath, '[settings]\n[refs]\n');
    await expect(readConfig(home)).rejects.toThrow(/refs migrate/u);
  });
});

describe('migrate', () => {
  it('fills missing keys, keeps user values and refs, writes backup', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      home.configPath,
      [
        '[meta]',
        'schema_version = 0',
        'cli_version = "0.0.1"',
        'custom_marker = "keep-me"',
        '[settings]',
        'clone_mode = "full"',
        '[refs."github.com/a/b"]',
        'description = "x"',
        'url = "https://github.com/a/b"',
        'tag_format = "v{version}"',
        'default_branch = "main"',
        '',
      ].join('\n'),
    );
    await expect(migrateConfig(home, '0.1.0')).resolves.toBe('migrated');
    const migrated = await readConfig(home);
    expect(migrated).toMatchObject({
      meta: { custom_marker: 'keep-me', schema_version: SCHEMA_VERSION },
      refs: { 'github.com/a/b': { description: 'x' } },
      settings: { clone_mode: 'full' },
    });
    // eslint-disable-next-line node/no-sync -- assertion reads dir written by the impl under test
    expect(readdirSync(home.root)).toContain('config.toml.bak');
  });

  it('absent config → seeds', async () => {
    expect.hasAssertions();
    const home = freshHome();
    await expect(migrateConfig(home, '0.1.0')).resolves.toBe('seeded');
    const config = await readConfig(home);
    expect(config.meta.schema_version).toBe(SCHEMA_VERSION);
  });

  it('already current schema → noop', async () => {
    expect.hasAssertions();
    const home = freshHome();
    await seedConfig(home, '0.1.0');
    await expect(migrateConfig(home, '0.1.0')).resolves.toBe('noop');
  });
});

describe('migrate — malformed schema_version handling', () => {
  it('migrate refuses to write a config that cannot be read back', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // The `settings` key must be top-level, so it has to precede the `[meta]` header. TOML
    // Would otherwise parse it as nested under `[meta]`, which isn't the shape under test.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(
      home.configPath,
      'settings = "oops"\n[meta]\nschema_version = 0\ncli_version = "0.0.1"\n',
    );
    await expect(migrateConfig(home, '0.1.0')).rejects.toThrow(/beyond automatic migration/u);
  });

  it('treats a string schema_version as migratable and heals it', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(home.configPath, '[meta]\nschema_version = "1"\ncli_version = "0.0.1"\n');
    await expect(migrateConfig(home, '0.1.0')).resolves.toBe('migrated');
    const config = await readConfig(home);
    expect(config.meta.schema_version).toBe(SCHEMA_VERSION);
  });

  it('readConfig reports a fractional schema_version as malformed, not newer', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(home.configPath, '[meta]\nschema_version = 1.5\ncli_version = "0.0.1"\n');
    await expect(readConfig(home)).rejects.toThrow(/refs migrate/u);
  });
});

describe('atomic write', () => {
  it('leaves no tmp files behind', async () => {
    expect.hasAssertions();
    const home = freshHome();
    await seedConfig(home, '0.1.0');
    const config = await readConfig(home);
    await writeConfig(home, config);
    // eslint-disable-next-line node/no-sync -- assertion reads dir written by the impl under test
    expect(readdirSync(home.root).filter((entry) => entry.includes('.tmp'))).toStrictEqual([]);
  });
});
