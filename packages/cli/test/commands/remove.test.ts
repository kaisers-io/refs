import { EXIT, checkoutPath, readConfig, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { access, lstat, mkdir, mkdtemp, symlink } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import type { RefsHome } from '@kaisers-io/refs-core';
import { join } from 'node:path';
import { run } from '../../src/main.ts';
import { testContext } from '../helpers/context.ts';
import { tmpdir } from 'node:os';

// Integration suite for `refs remove` — the CLI's only destructive command. Test case labels
// (a)-(d) mirror the task brief's Step 1 list. Config is seeded directly via `seedConfig`
// (`writeConfig`), mirroring `show.test.ts`/`tag.test.ts`; checkouts are either a bare `.git`
// marker (`markCheckoutPresent`, sufficient for `fs.rm`/pruning — no real git repo needed) or, for
// the containment case, a raw symlink built the same way `core/test/home.test.ts`'s "rejects
// symlinks pointing outside sources" case does. Multi-assertion checks are pulled into named
// `expectX` helpers (mirroring `add-support.ts`'s `expectFinalizedState` etc.) purely to keep each
// `it` body's own statement/assertion count under the repo's oxlint caps.

const NEXTJS_KEY = 'github.com/vercel/next.js';
const NEXTJS_ENTRY = {
  default_branch: 'canary',
  description: 'The React Framework',
  tag_format: 'v{version}',
  url: 'https://github.com/vercel/next.js',
};
const ESCAPE_KEY = 'evil.example.com/acme/widget';
const ESCAPE_ENTRY = {
  default_branch: 'main',
  description: 'A ref whose checkout is a symlink escaping sources/',
  tag_format: 'v{version}',
  url: 'https://evil.example.com/acme/widget',
};

type RemoveEnvelope = {
  data?: { key: string; removed_checkout: boolean };
  error?: { code: string; message: string };
  ok: boolean;
  warnings?: string[];
};

const parseSoleEnvelope = (stdout: readonly string[]): RemoveEnvelope => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as RemoveEnvelope;
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

/** Like `pathExists`, but via `lstat` so it reports `true` for a symlink entry even when the
 * symlink is DANGLING (its target is missing) — `access`/`pathExists` would follow the link and
 * report `false` regardless of whether the link itself is still there. */
const entryExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
};

const expectSuccessEnvelope = (
  stdout: readonly string[],
  expectedData: { key: string; removed_checkout: boolean },
  expectedWarnings: readonly string[],
): void => {
  const envelope = parseSoleEnvelope(stdout);
  expect(envelope.ok).toBe(true);
  expect(envelope.data).toStrictEqual(expectedData);
  expect(envelope.warnings).toStrictEqual(expectedWarnings);
};

/** Asserts the config entry is gone, the checkout directory is gone, its now-empty parents up to
 * (but excluding) `sources/` were pruned too, and `sources/` itself still exists. */
const expectFullyPruned = async (home: RefsHome, dest: string): Promise<void> => {
  const config = await readConfig(home);
  expect(config.refs[NEXTJS_KEY]).toBeUndefined();
  await expect(pathExists(dest)).resolves.toBe(false);
  await expect(pathExists(join(home.sourcesDir, 'github.com', 'vercel'))).resolves.toBe(false);
  await expect(pathExists(join(home.sourcesDir, 'github.com'))).resolves.toBe(false);
  await expect(pathExists(home.sourcesDir)).resolves.toBe(true);
};

const expectEntryRemoved = async (home: RefsHome, key: string): Promise<void> => {
  const config = await readConfig(home);
  expect(config.refs[key]).toBeUndefined();
};

const expectValidationError = (stdout: readonly string[]): void => {
  expect(process.exitCode).toBe(EXIT.VALIDATION);
  const envelope = parseSoleEnvelope(stdout);
  expect(envelope.ok).toBe(false);
  expect(envelope.error?.code).toBe('validation');
  expect(envelope.error?.message).toMatch(/containment/u);
};

const expectEntryIntact = async (home: RefsHome, key: string, outside: string): Promise<void> => {
  const config = await readConfig(home);
  expect(config.refs[key]).toBeDefined();
  await expect(pathExists(outside)).resolves.toBe(true);
};

const expectNotFoundError = (stdout: readonly string[]): void => {
  expect(process.exitCode).toBe(EXIT.NOT_FOUND);
  const envelope = parseSoleEnvelope(stdout);
  expect(envelope.ok).toBe(false);
  expect(envelope.error?.code).toBe('not_found');
};

describe('refs remove: full removal', () => {
  it('(a) deletes the config entry and the checkout, pruning empty parents up to sources/', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [NEXTJS_KEY]: NEXTJS_ENTRY });
        const dest = checkoutPath(home, zRefKey.parse(NEXTJS_KEY));
        await markCheckoutPresent(dest);

        await run(ctx, ['node', 'refs', 'remove', NEXTJS_KEY, '--json']);

        expectSuccessEnvelope(stdout, { key: NEXTJS_KEY, removed_checkout: true }, []);
        await expectFullyPruned(home, dest);
      }),
    );
  });
});

describe('refs remove: missing checkout', () => {
  it('(b) still removes the config entry and reports ok with a warning', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [NEXTJS_KEY]: NEXTJS_ENTRY });

        await run(ctx, ['node', 'refs', 'remove', NEXTJS_KEY, '--json']);

        expectSuccessEnvelope(stdout, { key: NEXTJS_KEY, removed_checkout: false }, [
          'checkout was already missing',
        ]);
        await expectEntryRemoved(home, NEXTJS_KEY);
      }),
    );
  });
});

/** Builds `ESCAPE_KEY`'s checkout path as a symlink pointing at an existing directory OUTSIDE
 * `home.sourcesDir` — a real, existing external target (not a dangling one), so
 * `assertInsideSources`'s realpath resolution actually walks through the link instead of treating
 * it as a missing path segment. Returns the outside directory so the test can also assert it was
 * left untouched. */
const seedEscapingCheckout = async (home: RefsHome): Promise<string> => {
  const dest = checkoutPath(home, zRefKey.parse(ESCAPE_KEY));
  await mkdir(join(home.sourcesDir, 'evil.example.com', 'acme'), { recursive: true });
  const outside = await mkdtemp(join(tmpdir(), 'refs-remove-outside-'));
  await symlink(outside, dest);
  return outside;
};

describe('refs remove: containment violation', () => {
  it('(c) exits 3 (validation) and leaves the config entry intact', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [ESCAPE_KEY]: ESCAPE_ENTRY });
        const outside = await seedEscapingCheckout(home);

        await run(ctx, ['node', 'refs', 'remove', ESCAPE_KEY, '--json']);

        expectValidationError(stdout);
        await expectEntryIntact(home, ESCAPE_KEY, outside);
      }),
    );
  });
});

/** Builds `NEXTJS_KEY`'s checkout path as a DANGLING symlink — pointing at a target that does not
 * exist. `lstat` (unlike `stat`) sees this entry without following the link, so `removeCheckout`
 * must treat it as present and remove the link itself via `rm`. */
const seedDanglingCheckout = async (home: RefsHome): Promise<string> => {
  const dest = checkoutPath(home, zRefKey.parse(NEXTJS_KEY));
  await mkdir(join(home.sourcesDir, 'github.com', 'vercel'), { recursive: true });
  const missingTarget = join(home.sourcesDir, 'github.com', 'vercel', 'does-not-exist-target');
  await symlink(missingTarget, dest);
  return dest;
};

describe('refs remove: dangling symlink checkout', () => {
  it('(e) treats a dangling symlink checkout as present, removes it, and drops the entry', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [NEXTJS_KEY]: NEXTJS_ENTRY });
        const dest = await seedDanglingCheckout(home);
        await expect(entryExists(dest)).resolves.toBe(true);

        await run(ctx, ['node', 'refs', 'remove', NEXTJS_KEY, '--json']);

        expectSuccessEnvelope(stdout, { key: NEXTJS_KEY, removed_checkout: true }, []);
        await expectEntryRemoved(home, NEXTJS_KEY);
        await expect(entryExists(dest)).resolves.toBe(false);
      }),
    );
  });
});

/** Builds a checkout whose immediate parent directory (`github.com/vercel`) is itself a symlink to
 * a real directory ELSEWHERE under `sources/` (so `assertInsideSources`'s containment check still
 * passes — this is not the escaping-checkout case). `readdir` follows such a symlink transparently
 * (so pruning would see it as "empty" once the checkout inside is gone), but `rmdir` refuses to
 * remove a path whose final component is a symlink (`ENOTDIR`) — exactly the tampered-ancestor edge
 * `removeIfEmpty` must detect and back off from, rather than let the error surface after the
 * checkout is already deleted. */
const seedSymlinkedAncestorCheckout = async (home: RefsHome): Promise<string> => {
  const linkDir = join(home.sourcesDir, 'github.com', 'vercel');
  const realTargetDir = join(home.sourcesDir, 'github.com', 'actual-vercel-target');
  await mkdir(realTargetDir, { recursive: true });
  await symlink(realTargetDir, linkDir);
  const dest = checkoutPath(home, zRefKey.parse(NEXTJS_KEY));
  await markCheckoutPresent(dest);
  return linkDir;
};

describe('refs remove: symlinked ancestor during pruning', () => {
  it('(f) removes the checkout and entry, backing off pruning at the symlinked ancestor', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [NEXTJS_KEY]: NEXTJS_ENTRY });
        const linkDir = await seedSymlinkedAncestorCheckout(home);

        await run(ctx, ['node', 'refs', 'remove', NEXTJS_KEY, '--json']);

        expectSuccessEnvelope(stdout, { key: NEXTJS_KEY, removed_checkout: true }, []);
        await expectEntryRemoved(home, NEXTJS_KEY);
        await expect(entryExists(linkDir)).resolves.toBe(true);
      }),
    );
  });
});

describe('refs remove: unknown ref', () => {
  it('(d) exits 4 (not_found)', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const { ctx, stdout } = testContext();
        ctx.env['REFS_HOME'] = homeDir;
        const home = resolveHome(ctx.env);
        await seedConfig(home, { [NEXTJS_KEY]: NEXTJS_ENTRY });

        await run(ctx, ['node', 'refs', 'remove', 'nonexistent', '--json']);

        expectNotFoundError(stdout);
      }),
    );
  });
});
