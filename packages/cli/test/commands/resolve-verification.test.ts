import { NEXT_ENTRY, NEXT_KEY, seedNextFixture } from '../helpers/next-fixture.ts';
import { checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { testContext } from '../helpers/context.ts';

// Behaviour of `refs resolve`'s package-identity verification, at the CLI boundary. The routing
// itself lives in `resolve.test.ts`; this file is only about what happens once a package HAS been
// routed and its configured location turns out to be right, wrong, or uncheckable.
//
// The failure this exists to prevent is silent: without verification, resolve hands back whatever
// occupies the configured path, and an agent reads the wrong source while answering confidently.
// Nothing errors, nothing logs — the answer is just wrong.

type JsonEnvelope = {
  data: unknown;
  error?: { code: string; message: string };
  ok: boolean;
};

const parseSoleEnvelope = (stdout: readonly string[]): JsonEnvelope => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as JsonEnvelope;
};

type VerifiedPackageShape = {
  candidates?: string[];
  configured_path?: string;
  local_path: string | null;
  name: string;
  path: string | null;
  reason?: string;
  status: string;
};

/** Rewrites the seeded fixture so `next` lives at `src/next` and is declared as a workspace
 * there — the upstream-moved-a-package scenario. */
const relocateNext = async (dest: string): Promise<void> => {
  await writeFile(
    join(dest, 'package.json'),
    JSON.stringify({ name: 'nextjs-monorepo', workspaces: ['src/*'] }),
  );
  await rm(join(dest, 'packages', 'next'), { force: true, recursive: true });
  await mkdir(join(dest, 'src', 'next'), { recursive: true });
  await writeFile(join(dest, 'src', 'next', 'package.json'), JSON.stringify({ name: 'next' }));
};

/** Leaves a DIFFERENT package sitting at next's configured path, with the real one elsewhere.
 * Without verification, resolve hands over the configured path and the agent reads
 * `@next/legacy` while answering about `next` — no error, just a wrong answer. */
const swapNextForLegacy = async (dest: string): Promise<void> => {
  await writeFile(
    join(dest, 'package.json'),
    JSON.stringify({ name: 'nextjs-monorepo', workspaces: ['src/*'] }),
  );
  await writeFile(
    join(dest, 'packages', 'next', 'package.json'),
    JSON.stringify({ name: '@next/legacy' }),
  );
  await mkdir(join(dest, 'src', 'next'), { recursive: true });
  await writeFile(join(dest, 'src', 'next', 'package.json'), JSON.stringify({ name: 'next' }));
};

/** Leaves a complete, readable workspace that simply does not contain `next` anywhere. */
const removeNextEntirely = async (dest: string): Promise<void> => {
  await rm(join(dest, 'packages', 'next'), { force: true, recursive: true });
  await writeFile(
    join(dest, 'package.json'),
    JSON.stringify({ name: 'nextjs-monorepo', workspaces: ['src/*'] }),
  );
  await mkdir(join(dest, 'src', 'other'), { recursive: true });
  await writeFile(join(dest, 'src', 'other', 'package.json'), JSON.stringify({ name: 'other' }));
};

/** Seeds the fixture, lets `setup` rearrange the checkout, then runs `refs resolve next --json`
 * and returns the parsed `package` object. Every test here has the same shape; only the
 * rearrangement and the expectations differ. */
const resolveNextAfter = async (
  homeDir: string,
  setup: (dest: string) => Promise<void>,
): Promise<{ dest: string; pkg: VerifiedPackageShape }> => {
  const { ctx, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  const { dest } = await seedNextFixture(ctx.env);
  await setup(dest);
  await run(ctx, ['node', 'refs', 'resolve', 'next', '--json']);
  const data = parseSoleEnvelope(stdout).data as { package: VerifiedPackageShape };
  return { dest, pkg: data.package };
};

describe('refs resolve: a package that moved upstream', () => {
  it('reports relocated with the corrected path, and still exits 0', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { dest, pkg } = await resolveNextAfter(homeDir, relocateNext);
        expect(pkg.status).toBe('relocated');
        expect(pkg.path).toBe('src/next');
        expect(pkg.configured_path).toBe('packages/next');
        expect(pkg.local_path).toBe(join(dest, 'src', 'next'));
        expect(process.exitCode).toBeUndefined();
      }),
    );
  });
});

describe('refs resolve: another package at the configured path', () => {
  it('relocates when another package has taken over the configured path', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { dest, pkg } = await resolveNextAfter(homeDir, swapNextForLegacy);
        expect(pkg.status).toBe('relocated');
        expect(pkg.local_path).toBe(join(dest, 'src', 'next'));
      }),
    );
  });
});

describe('refs resolve: a package with no usable location', () => {
  it('reports missing with a null local_path and still exits 0', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { pkg } = await resolveNextAfter(homeDir, removeNextEntirely);
        expect(pkg.status).toBe('missing');
        expect(pkg.local_path).toBeNull();
        // Exit 0 on purpose: the ref resolved fine, only the package's location inside it did
        // not. An agent with no human to ask needs the structured status, not an error envelope.
        expect(process.exitCode).toBeUndefined();
      }),
    );
  });
});

/** Leaves the package `next` declared at TWO workspace locations — what an in-progress upstream
 * migration looks like while both the old and new home exist. */
const duplicateNext = async (dest: string): Promise<void> => {
  await rm(join(dest, 'packages', 'next'), { force: true, recursive: true });
  await writeFile(
    join(dest, 'package.json'),
    JSON.stringify({ name: 'nextjs-monorepo', workspaces: ['legacy/*', 'src/*'] }),
  );
  await Promise.all(
    ['legacy', 'src'].map(async (base) => {
      await mkdir(join(dest, base, 'next'), { recursive: true });
      await writeFile(join(dest, base, 'next', 'package.json'), JSON.stringify({ name: 'next' }));
    }),
  );
};

describe('refs resolve: a name that is not unique in the checkout', () => {
  it('reports ambiguous with candidates when the name exists twice', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { pkg } = await resolveNextAfter(homeDir, duplicateNext);
        expect(pkg.status).toBe('ambiguous');
        expect(pkg.candidates).toStrictEqual(['legacy/next', 'src/next']);
        expect(pkg.local_path).toBeNull();
      }),
    );
  });
});

describe('refs resolve: a location that cannot be confirmed', () => {
  it('reports unverifiable and keeps the configured path when the manifest is malformed', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { dest, pkg } = await resolveNextAfter(homeDir, (checkout) =>
          writeFile(join(checkout, 'packages', 'next', 'package.json'), '{ broken'),
        );
        expect(pkg.status).toBe('unverifiable');
        // A read failure is not evidence of absence, so the configured path is still returned.
        expect(pkg.local_path).toBe(join(dest, 'packages', 'next'));
        expect(pkg.reason).toBeDefined();
      }),
    );
  });

  it('reports unmaterialized, without probing, when the checkout is absent', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [NEXT_KEY]: NEXT_ENTRY });
        const dest = checkoutPath(home, zRefKey.parse(NEXT_KEY));

        await run(ctx, ['node', 'refs', 'resolve', 'next', '--json']);

        const data = parseSoleEnvelope(stdout).data as {
          missing: boolean;
          package: VerifiedPackageShape;
        };
        // INVESTIGATE.md's recovery flow reads `missing` and syncs. Probing an absent checkout
        // would report the PACKAGE missing and break it.
        expect(data.missing).toBe(true);
        expect(data.package.status).toBe('unmaterialized');
        expect(data.package.local_path).toBe(join(dest, 'packages', 'next'));
      }),
    );
  });
});

describe('refs resolve: human output surfaces an unverified location', () => {
  it('names the status and the configured path after a relocation', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const { dest } = await seedNextFixture(ctx.env);
        await relocateNext(dest);

        await run(ctx, ['node', 'refs', 'resolve', 'next']);

        expect(stdout).toContain('package status: relocated');
        expect(stdout).toContain('configured path: packages/next');
      }),
    );
  });
});
