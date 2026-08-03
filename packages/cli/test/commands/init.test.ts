import { access, constants, mkdtemp, readFile, rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';
import { tmpdir } from 'node:os';

const NO_LINES = 0;
const ONE_LINE = 1;
const EXPECTED_SCHEMA_VERSION = 1;
const HOME_LINE_INDEX = 0;
const CONFIG_LINE_INDEX = 1;
const BLANK_LINE_INDEX = 2;
const SKILL_HINT_LINE_INDEX = 3;

// `run`/`runProgram` set `process.exitCode` as a real side effect on the actual test-runner
// Process — snapshot and restore it around every case, mirroring `main.test.ts`'s helper, so one
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
  const homeDir = await mkdtemp(join(tmpdir(), 'refs-init-test-'));
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

const runInitJson = async (homeDir: string): Promise<{ stderr: string[]; stdout: string[] }> => {
  const { ctx, stderr, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  await run(ctx, ['node', 'refs', 'init', '--json']);
  return { stderr, stdout };
};

describe('refs init: json envelope', () => {
  it('seeds the config and reports it in the json envelope on first run', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { stderr, stdout } = await runInitJson(homeDir);
        expect(stderr).toHaveLength(NO_LINES);
        expect(stdout).toHaveLength(ONE_LINE);
        const parsed = parseSoleEnvelope(stdout);
        expect(parsed).toMatchObject({ data: { config: 'seeded', home: homeDir }, ok: true });
        // Catches a future regression where `init` reports 'seeded' in the envelope without
        // Actually having written the config to disk: read the real file back and parse it.
        const configText = await readFile(join(homeDir, 'config.toml'), 'utf8');
        const config = parse(configText) as {
          meta?: { schema_version?: unknown };
          settings?: unknown;
        };
        expect(config.meta?.schema_version).toBe(EXPECTED_SCHEMA_VERSION);
        expect(config.settings).toBeDefined();
      }),
    );
  });

  it('includes an npx skills add skill hint in the json data', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { stdout } = await runInitJson(homeDir);
        const parsed = parseSoleEnvelope(stdout) as { data: { skill_hint: string } };
        expect(parsed.data.skill_hint).toContain('npx skills add');
      }),
    );
  });

  it('reports noop on a second run once the config already matches', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await runInitJson(homeDir);
        const { stdout } = await runInitJson(homeDir);
        const parsed = parseSoleEnvelope(stdout);
        expect(parsed).toMatchObject({ data: { config: 'noop' }, ok: true });
      }),
    );
  });
});

describe('refs init: filesystem side effects', () => {
  it('creates sources/, locks/, and hooks/ with an executable pre-commit hook', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await runInitJson(homeDir);
        await expect(access(join(homeDir, 'sources'))).resolves.toBeUndefined();
        await expect(access(join(homeDir, 'locks'))).resolves.toBeUndefined();
        await expect(access(join(homeDir, 'hooks'))).resolves.toBeUndefined();
        await expect(
          access(join(homeDir, 'hooks', 'pre-commit'), constants.X_OK),
        ).resolves.toBeUndefined();
        await expect(
          access(join(homeDir, 'hooks', 'pre-push'), constants.X_OK),
        ).resolves.toBeUndefined();
      }),
    );
  });
});

describe('refs init: human mode', () => {
  it('prints the skill install line', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        await run(ctx, ['node', 'refs', 'init']);
        expect(stdout.some((line) => line.includes('npx skills add'))).toBe(true);
      }),
    );
  });

  it('prints home and config on their own key: value lines, then the skill hint', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        await run(ctx, ['node', 'refs', 'init']);
        expect(stdout[HOME_LINE_INDEX]).toBe(`home: ${homeDir}`);
        expect(stdout[CONFIG_LINE_INDEX]).toBe('config: seeded');
        expect(stdout[BLANK_LINE_INDEX]).toBe('');
        expect(stdout[SKILL_HINT_LINE_INDEX]).toContain('npx skills add');
      }),
    );
  });

  it('says unchanged rather than noop on a second run', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        await run(ctx, ['node', 'refs', 'init']);
        const second = testContext();
        second.ctx.env['REFS_HOME'] = homeDir;
        await run(second.ctx, ['node', 'refs', 'init']);
        expect(second.stdout[CONFIG_LINE_INDEX]).toBe('config: unchanged');
      }),
    );
  });
});
