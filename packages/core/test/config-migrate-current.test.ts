import { configBackupPath, resolveHome } from '../src/home.ts';
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { SCHEMA_VERSION } from '../src/schemas/config.ts';
import { join } from 'node:path';
import { migrateConfig } from '../src/config-migrate.ts';
import { readConfig } from '../src/config-io.ts';
import { tmpdir } from 'node:os';

// Split from `config-io.test.ts` for the 300-line cap; the cases are unchanged.

const freshHome = () => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-cfg-'));
  return resolveHome({ REFS_HOME: dir });
};

// The branch that reports "config up to date". It used to rewrite the file with a fresh
// `cli_version` and answer `noop` without ever validating what it held — so `refs migrate`, whose
// whole job is to leave the config in a known-good state, reported a state it had not established.
// Measured with the built CLI: a `clone_mode` of `42` was stamped and reported up to date while
// every reader then refused the file.
const CURRENT_BUT_INVALID = [
  '[meta]',
  `schema_version = ${String(SCHEMA_VERSION)}`,
  'cli_version = "0.0.1"',
  '',
  '[settings]',
  'clone_mode = 42',
  '',
].join('\n');

const ALREADY_STAMPED_INVALID = CURRENT_BUT_INVALID.replace(
  'cli_version = "0.0.1"',
  'cli_version = "0.1.0"',
);

const MISSING_CLI_VERSION = [
  '[meta]',
  `schema_version = ${String(SCHEMA_VERSION)}`,
  '',
  '[settings]',
  'clone_mode = "full"',
  '',
].join('\n');

describe('migrate — a config already at the current schema', () => {
  it('refuses one that does not validate, rather than calling it up to date', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(home.configPath, CURRENT_BUT_INVALID);

    await expect(migrateConfig(home, '0.1.0')).rejects.toThrow(/does not validate/u);
  });

  it('leaves the file exactly as it found it when it refuses', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(home.configPath, CURRENT_BUT_INVALID);

    await expect(migrateConfig(home, '0.1.0')).rejects.toThrow(/does not validate/u);

    // No backup is taken on this path, so the file on disk is the only copy — the stamp must not
    // have landed. `0.1.0` here would mean it was rewritten before anyone looked at it.
    // eslint-disable-next-line node/no-sync -- assertion reads the file the impl under test wrote
    expect(readFileSync(home.configPath, 'utf8')).toBe(CURRENT_BUT_INVALID);
    // And no backup was invented for an attempt that wrote nothing.
    // eslint-disable-next-line node/no-sync -- the assertion is about what is NOT on disk
    expect(existsSync(configBackupPath(home))).toBe(false);
  });

  it('refuses it even when there is nothing to stamp', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // The version already matches, so the write is skipped — and the answer `noop` is still a
    // claim about the document. Validation behind that early return would miss this entirely.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(home.configPath, ALREADY_STAMPED_INVALID);

    await expect(migrateConfig(home, '0.1.0')).rejects.toThrow(/does not validate/u);
  });
});

describe('migrate — the repair the stamp exists for', () => {
  it('still fills in a missing cli_version', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // `zConfig` requires a non-empty `meta.cli_version`, so this document fails as it stands and
    // passes once stamped. Validating the INPUT rather than the stamped result would have turned
    // a repair refs has always performed into a refusal.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(home.configPath, MISSING_CLI_VERSION);

    await expect(migrateConfig(home, '0.1.0')).resolves.toBe('noop');

    const config = await readConfig(home);
    expect(config.meta.cli_version).toBe('0.1.0');
  });
});
