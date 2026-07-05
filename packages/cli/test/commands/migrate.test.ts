import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { configBackupPath, resolveHome } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';
import { tmpdir } from 'node:os';

const NO_LINES = 0;
const ONE_LINE = 1;

// `run`/`runProgram` set `process.exitCode` as a real side effect on the actual test-runner
// Process — snapshot and restore it around every case, mirroring `init.test.ts`'s helper, so one
// Test's exit code never leaks into the next.
const withResetExitCode = async (exercise: () => Promise<void>): Promise<void> => {
  const original = process.exitCode;
  process.exitCode = undefined;
  try {
    await exercise();
  } finally {
    process.exitCode = original;
  }
};

// Provides a fresh `REFS_HOME` temp dir for the duration of `exercise`, always cleaned up
// afterwards — inlined per test (house style forbids `beforeEach`/`afterEach`) rather than a
// shared fixture, so a temp dir never leaks across tests or into the real home.
const withTempHome = async (exercise: (homeDir: string) => Promise<void>): Promise<void> => {
  const homeDir = await mkdtemp(join(tmpdir(), 'refs-migrate-test-'));
  try {
    await exercise(homeDir);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
};

const parseSoleEnvelope = (stdout: readonly string[]): unknown => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line);
};

const runMigrateJson = async (homeDir: string): Promise<{ stderr: string[]; stdout: string[] }> => {
  const { ctx, stderr, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  await run(ctx, ['node', 'refs', 'migrate', '--json']);
  return { stderr, stdout };
};

// Old-schema TOML shape mirroring core's own `config-io.test.ts` migrate fixture — a real
// `schema_version = 0` config so `migrateConfig` takes its `migrated` (not `seeded`/`noop`)
// branch and writes a `config.toml.bak` backup.
const OLD_SCHEMA_CONFIG = [
  '[meta]',
  'schema_version = 0',
  'cli_version = "0.0.1"',
  '[settings]',
  '[refs]',
  '',
].join('\n');

describe('refs migrate: json envelope', () => {
  it('migrates an old-schema config and reports the backup path', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await writeFile(join(homeDir, 'config.toml'), OLD_SCHEMA_CONFIG);
        const { stderr, stdout } = await runMigrateJson(homeDir);
        expect(stderr).toHaveLength(NO_LINES);
        expect(stdout).toHaveLength(ONE_LINE);
        const parsed = parseSoleEnvelope(stdout);
        const backup = configBackupPath(resolveHome({ REFS_HOME: homeDir }));
        expect(parsed).toMatchObject({ data: { backup, result: 'migrated' }, ok: true });
        await expect(access(backup)).resolves.toBeUndefined();
      }),
    );
  });

  it('reports noop and a null backup when the config is already current', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await runMigrateJson(homeDir);
        const { stdout } = await runMigrateJson(homeDir);
        const parsed = parseSoleEnvelope(stdout) as { data: { backup: unknown; result: string } };
        expect(parsed).toMatchObject({ data: { result: 'noop' }, ok: true });
        expect(parsed.data.backup).toBeNull();
      }),
    );
  });

  it('seeds and reports a null backup when the config is absent', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { stdout } = await runMigrateJson(homeDir);
        const parsed = parseSoleEnvelope(stdout) as { data: { backup: unknown; result: string } };
        expect(parsed).toMatchObject({ data: { result: 'seeded' }, ok: true });
        expect(parsed.data.backup).toBeNull();
        await expect(access(join(homeDir, 'config.toml'))).resolves.toBeUndefined();
      }),
    );
  });
});

describe('refs migrate: human mode', () => {
  it('prints the migrated message with the backup filename', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await writeFile(join(homeDir, 'config.toml'), OLD_SCHEMA_CONFIG);
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        await run(ctx, ['node', 'refs', 'migrate']);
        expect(stdout).toContain('config migrated (backup: config.toml.bak)');
      }),
    );
  });

  it('prints the up-to-date message on a noop run', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await runMigrateJson(homeDir);
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        await run(ctx, ['node', 'refs', 'migrate']);
        expect(stdout).toContain('config up to date');
      }),
    );
  });
});
