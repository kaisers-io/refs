import {
  buildSshRefEntry,
  expectCheck,
  expectGitVersion,
  findCheck,
  runDoctorJson,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { describe, expect, it } from 'vitest';
import { initHome, realContextFor } from '../helpers/add-support.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { EXIT } from '@kaisers-io/refs-core';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { testContext } from '../helpers/context.ts';

// Unit + CLI-wiring tests for `refs doctor` covering the task brief's Step 1 cases (a)/(b)/(e).
// Case (c) orphans and (d) dirty checkouts live in `doctor-orphans.test.ts`/
// `doctor-checkouts.test.ts`; ssh-auth in `doctor-ssh.test.ts` — split purely to keep each file
// under the repo's 300-line oxlint cap. `expectGitVersion`/`runDoctorJson`/`findCheck`/
// `setupInitializedHome` (shared scaffolding) live in `test/helpers/doctor-support.ts`.
//
// FakeRunner (never a real git binary) is used throughout: `doctor`'s own probes (`git --version`,
// per-checkout `git config`/`git status`, `ssh -T`) are simple, deterministic single commands with
// no real repository state to exercise, unlike `sync.test.ts`'s real `file://` fixtures — a scripted
// response is both simpler and faster here.

// Old-schema TOML shape mirroring `migrate.test.ts`'s own fixture — a real `schema_version = 0`
// config so `readConfig` takes its "older than expected" failure branch. Deliberately does NOT go
// through `setupInitializedHome`/`refs init`: `init` calls `migrateConfig`, which would silently
// migrate this file rather than leaving it broken for `doctor` to detect.
const OLD_SCHEMA_CONFIG = [
  '[meta]',
  'schema_version = 0',
  'cli_version = "0.0.1"',
  '[settings]',
  '[refs]',
  '',
].join('\n');

describe('refs doctor: (a) healthy home', () => {
  it('reports every check as ok/warn and exits 0', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expect(envelope.ok).toBe(true);
        expect(envelope.data.checks.some((check) => check.status === 'fail')).toBe(false);
        expect(findCheck(envelope, 'ssh-auth')).toBeUndefined();
        expect(process.exitCode).toBeUndefined();
      }),
    );
  });
});

describe('refs doctor: (b) old-schema config', () => {
  it('reports the config check as fail (naming refs migrate) and exits 1', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await writeFile(join(homeDir, 'config.toml'), OLD_SCHEMA_CONFIG);
        const { ctx, runner, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'config', { detailContains: 'refs migrate', status: 'fail' });
        expect(process.exitCode).toBe(EXIT.UNEXPECTED);
      }),
    );
  });
});

describe('refs doctor: (e) skill not installed', () => {
  it('reports the skill check as warn with the install hint', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'skill', {
          detailContains: 'npx skills add kaisers-io/refs',
          status: 'warn',
        });
      }),
    );
  });
});

describe('refs doctor: skill installed', () => {
  it('reports the skill check as ok when SKILL.md exists under $HOME/.claude/skills/refs', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const fakeHome = join(homeDir, 'agent-home');
        const skillDir = join(fakeHome, '.claude', 'skills', 'refs');
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, 'SKILL.md'), '# refs skill\n');
        const { ctx, stdout } = realContextFor(join(homeDir, 'refs-home'));
        ctx.env['HOME'] = fakeHome;
        await initHome(ctx);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'skill', { status: 'ok' });
      }),
    );
  });
});

describe('refs doctor: human mode', () => {
  it('prints one bracketed status line per check', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        expectGitVersion(runner);

        await run(ctx, ['node', 'refs', 'doctor']);

        expect(stdout.some((line) => /^\[(?:OK|WARN|FAIL)\] git:/u.test(line))).toBe(true);
      }),
    );
  });
});

// Per-check isolation (finding: an unexpected throw from one check must never abort the batch).
// The real-world trigger cited is `orphans`' directory walk rethrowing a non-ENOENT `readdir`
// fault (EACCES/ENOTDIR/ELOOP) — reproducing that reliably needs root-hostile permission bits
// (`chmod 000`), which behaves inconsistently across CI/dev machines and is `root`-immune besides.
// Instead, this drives an unrelated real check (`ssh-auth`, deliberately last in step order) into
// an unexpected throw via `FakeRunner`'s own "unexpected command" guard: leaving its probe
// unscripted makes `checkSshAuth` throw exactly as `readdir` would — deterministic, platform
// -independent, and exercises the very same `runStepSafely` catch path in `doctor.ts`.
const ISOLATION_SSH_KEY = 'github.com/acme/isolation-repo';
const ISOLATION_SSH_HOST = 'github.com';
const NON_CRASHING_CHECK_NAMES = [
  'git',
  'node',
  'config',
  'hooks-guard',
  'dirty-checkouts',
  'orphans',
  'skill',
];

describe('refs doctor: per-check isolation on an unexpected throw', () => {
  it('fail-lists only the crashed check, keeps every other check, and still exits 1', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, home, runner, stdout } = await setupInitializedHome(homeDir);
        await seedConfig(home, {
          [ISOLATION_SSH_KEY]: buildSshRefEntry(ISOLATION_SSH_HOST),
        });
        expectGitVersion(runner);
        // Deliberately no `runner.expect(...)` for the ssh probe: `ssh-auth` (last in step order)
        // throws when it runs, standing in for `orphans`' real EACCES/ENOTDIR/ELOOP rethrow.

        const envelope = await runDoctorJson(ctx, stdout);

        expect(envelope.ok).toBe(true);
        expectCheck(envelope, 'ssh-auth', { detailContains: 'check crashed:', status: 'fail' });
        for (const name of NON_CRASHING_CHECK_NAMES) {
          expect(findCheck(envelope, name)).toBeDefined();
        }
        expect(process.exitCode).toBe(EXIT.UNEXPECTED);
      }),
    );
  });
});

// `node` check (finding: it must read `ctx.nodeVersion`, never `process.version`, so its fail
// branch — a too-old Node — is actually testable). The supported range is open-ended
// (`>=24.12`): only versions below 24.12 (an older 24.x minor, or an earlier major) are `fail`.
// Split across two `describe` blocks purely to keep each callback under the repo's
// max-lines-per-function cap.
describe('refs doctor: node version below the supported floor', () => {
  it('reports fail for a minor below the supported floor (v24.9.0)', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        ctx.nodeVersion = 'v24.9.0';
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'node', { detailContains: 'v24.9.0', status: 'fail' });
      }),
    );
  });

  it('reports fail for a minor just below the supported floor (v24.11.0)', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        ctx.nodeVersion = 'v24.11.0';
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'node', { detailContains: 'v24.11.0', status: 'fail' });
      }),
    );
  });

  it('reports fail for an older major (v22.0.0)', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        ctx.nodeVersion = 'v22.0.0';
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'node', { detailContains: 'v22.0.0', status: 'fail' });
      }),
    );
  });
});

// Open range has no ceiling: any major above 24 (or 24.12+) is `ok`.
describe('refs doctor: node version at or above the supported floor', () => {
  it('reports ok for a supported version (v24.13.1)', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        ctx.nodeVersion = 'v24.13.1';
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'node', { detailContains: 'v24.13.1', status: 'ok' });
      }),
    );
  });

  it('reports ok for a major above the ceiling with no upper bound (v25.0.0)', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        ctx.nodeVersion = 'v25.0.0';
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'node', { detailContains: 'v25.0.0', status: 'ok' });
      }),
    );
  });

  it('reports ok for Node 26.x (v26.4.0)', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, runner, stdout } = await setupInitializedHome(homeDir);
        ctx.nodeVersion = 'v26.4.0';
        expectGitVersion(runner);

        const envelope = await runDoctorJson(ctx, stdout);

        expectCheck(envelope, 'node', { detailContains: 'v26.4.0', status: 'ok' });
      }),
    );
  });
});
