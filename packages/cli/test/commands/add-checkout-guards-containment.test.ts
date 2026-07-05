import { EXIT, readState } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  expectRefNotConfigured,
  plantSymlinkedAncestor,
  relocateBehindSymlink,
  setupDryRunFixture,
  setupSourceFixture,
} from '../helpers/add-guards-support.ts';
import {
  finalizeViaProposalFile,
  parseLastEnvelope,
  withResetExitCode,
  withTempHome,
} from '../helpers/add-support.ts';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { run } from '../../src/main.ts';

// Final-review finding (round 1): `ensureClonedCheckout`'s non-reuse (fresh clone) path used to
// `mkdir(dirname(opts.dest), { recursive: true })` + `cloneRepo` without ever containment-checking
// `opts.dest` against `home.sourcesDir` first. Round 2: the REUSE branch had the same gap —
// `isGitCheckout(opts.dest)`'s existsSync follows symlinked ancestors, so a managed checkout that
// physically lives outside `sources/` behind such a symlink would be silently ADOPTED (and every
// later sync would mutate it out there). Round 3: the FINALIZE path (`finalizeRef` — reached by
// both `--proposal` and `--description`) had the same adoption gap: `resolveCheckoutHead`'s
// origin/marker checks both pass against a relocated managed checkout, so it landed in
// config/state. Real-fs symlinks honestly reproduce all three exploit shapes: the file-fixture
// `local` host segment is replaced by a symlink pointing outside the managed tree. Kept in its
// own file — `add-guards.test.ts` has little headroom left under the repo's 300-line oxlint cap.

const TEST_TIMEOUT_MS = 30_000;
const NO_ENTRIES: readonly string[] = [];

interface ErrorEnvelope {
  error?: { code: string; message: string };
  ok: boolean;
}

describe('refs add: containment guard on fresh clone', () => {
  it(
    'fails closed (no clone) when an ancestor path segment under sources/ is a symlink pointing outside the tree',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          const { ctx, home, sourceUrl, stdout } = await setupSourceFixture(homeDir);
          const outside = await plantSymlinkedAncestor(join(home.sourcesDir, 'local'));

          await run(ctx, ['node', 'refs', 'add', sourceUrl, '--dry-run', '--json']);

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.message).toMatch(/containment/u);
          await expect(readdir(outside)).resolves.toStrictEqual([...NO_ENTRIES]);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add: containment guard on checkout reuse', () => {
  it(
    'refuses to adopt an existing managed checkout that physically lives outside sources/ via a symlinked ancestor',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          // The relocated checkout is refs' OWN prior clone (matching origin AND the refs-managed
          // hooksPath marker), so without a containment check the reuse branch accepts it happily.
          const { ctx, home, sourceUrl, stdout } = await setupDryRunFixture(homeDir);
          await relocateBehindSymlink(join(home.sourcesDir, 'local'));

          await run(ctx, ['node', 'refs', 'add', sourceUrl, '--dry-run', '--json']);

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.ok).toBe(false);
          expect(envelope.error?.message).toMatch(/containment/u);
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('refs add: containment guard on finalize', () => {
  it(
    'refuses to finalize (nothing written to config/state) when the checkout was relocated outside sources/ behind a symlinked ancestor between dry-run and finalize',
    async () => {
      expect.hasAssertions();
      await withResetExitCode(() =>
        withTempHome(async (homeDir) => {
          // The relocated checkout is refs' own dry-run clone (matching origin AND hooksPath
          // marker), so without a containment check `resolveCheckoutHead`'s identity guards both
          // pass and finalize would land the ref in config/state.
          const { ctx, home, proposal, stdout } = await setupDryRunFixture(homeDir);
          await relocateBehindSymlink(join(home.sourcesDir, 'local'));

          await finalizeViaProposalFile(ctx, homeDir, {
            ...proposal,
            description: 'A fixture repo.',
          });

          expect(process.exitCode).toBe(EXIT.VALIDATION);
          const envelope = parseLastEnvelope(stdout) as ErrorEnvelope;
          expect(envelope.error?.message).toMatch(/containment/u);
          await expectRefNotConfigured(home, proposal.key);
          const state = await readState(home);
          expect(state.refs[proposal.key]?.head_sha).toBeUndefined();
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
