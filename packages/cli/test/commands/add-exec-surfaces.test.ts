import { describe, expect, it } from 'vitest';
import {
  initHome,
  parseLastEnvelope,
  realContextFor,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { writeFile } from 'node:fs/promises';

// `add --dry-run` says what the git configuration will run before anyone approves the ref (#194):
// the `doctor` check `git-exec-surfaces`, read before the clone. A warning, not protection — a
// filter stays enabled, because turning it off changes what the checkout contains (#187).
//
// Real git through the real CLI, with the ambient configuration supplied by `GIT_CONFIG_GLOBAL`
// and the system file switched off, so the developer's own git config never decides the outcome.

type Envelope = { ok: boolean; warnings: string[] };

const AMBIENT_KEYS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'] as const;

const restoreEnv = (saved: readonly (string | undefined)[]): void => {
  for (const [index, key] of AMBIENT_KEYS.entries()) {
    const value = saved[index];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const withAmbientConfig = async (
  text: string,
  homeDir: string,
  body: () => Promise<void>,
): Promise<void> => {
  const path = join(homeDir, 'ambient-gitconfig');
  await writeFile(path, text);
  const saved = AMBIENT_KEYS.map((key) => process.env[key]);
  process.env['GIT_CONFIG_GLOBAL'] = path;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  try {
    await body();
  } finally {
    restoreEnv(saved);
  }
};

const dryRunUnder = async (config: string, homeDir: string): Promise<Envelope> => {
  const { ctx, stdout } = realContextFor(homeDir);
  let envelope: Envelope = { ok: false, warnings: [] };
  await withAmbientConfig(config, homeDir, async () => {
    await initHome(ctx);
    const fixture = await createFixtureRepo();
    await run(ctx, ['node', 'refs', 'add', fixture.url, '--dry-run', '--json']);
    envelope = parseLastEnvelope(stdout) as Envelope;
  });
  return envelope;
};

const surfaceWarnings = (envelope: Envelope): string[] =>
  envelope.warnings.filter((warning) => warning.startsWith('git-exec-surfaces:'));

describe('refs add --dry-run: what git is configured to run', () => {
  it(
    'names a filter the clone will run',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const envelope = await dryRunUnder('[filter "probe"]\n\tsmudge = cat\n', homeDir);

          expect(envelope.ok).toBe(true);
          const [warning] = surfaceWarnings(envelope);
          expect(warning).toContain('filter.probe.smudge');
          expect(warning).toContain('stays enabled');
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it(
    'does not name an fsmonitor command, which refs switches off for its own git',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const envelope = await dryRunUnder('[core]\n\tfsmonitor = ./fsm.sh\n', homeDir);

          expect(envelope.ok).toBe(true);
          expect(surfaceWarnings(envelope)).toStrictEqual([]);
        }),
      );
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
