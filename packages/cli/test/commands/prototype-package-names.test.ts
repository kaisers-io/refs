import { describe, expect, it } from 'vitest';
import { readConfig, resolveHome, writeConfig } from '@kaisers-io/refs-core';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { resolveJson } from '../helpers/resolve-support.ts';
import { run } from '../../src/main.ts';
import { seedNextFixture } from '../helpers/next-fixture.ts';
import { testContext } from '../helpers/context.ts';

// A name with no OWN entry in the packages record is not a registered package, and the read paths
// used to think it was. `packages['toString']` resolves up the prototype chain to
// `Object.prototype.toString`, which is truthy, so the lookup succeeds. This is entirely the read
// path, and it produced a WRONG ANSWER rather than a clean error.
//
// Storability is not the question and never was: `toString` and `valueOf` are perfectly legal
// package keys — only `__proto__`, `constructor` and `prototype` are rejected — so the guard has to
// find a real entry under such a name, not refuse the name.
//
// Measured with the built bundle before this changed:
//
//   refs tag <ref> 1.2.3 --package toString   -> {"data":{"tag":"v1.2.3",…},"ok":true}
//   refs resolve toString --ref <ref>          -> {"error":{"code":"unexpected","message":
//                                                  "The \"path\" argument must be of type string"}}
//
// `tag` is the worse of the two: there is no schema re-validation behind it, so it read
// `.tag_format` off the prototype object, got `undefined`, and silently fell back to the REF's
// format — answering for a package the configuration does not register. `resolve` crashed instead,
// because `routeWithinRef` substitutes a `{}` literal for a ref with no packages table and that
// literal carries `Object.prototype` however the schema built the real record.

const NEXT_KEY = 'github.com/vercel/next.js';
const LAST = -1;
const PROTOTYPE_NAMES = [['toString'], ['constructor'], ['valueOf']] as const;
const REAL_TO_STRING_PACKAGE = {
  description: 'A package a repository really named toString.',
  path: 'packages/next',
  // Deliberately NOT the ref's `v{version}`: the old defect answered with the ref's format after
  // reading `undefined` off the prototype object, so a package with its own format is what tells
  // a real entry apart from a silent fallback.
  tag_format: 'toString@{version}',
};

/** Seeds the shared fixture and then registers a package under a prototype-shadowing name. */
const seedWithRealToString = async (homeDir: string): Promise<void> => {
  const home = resolveHome({ REFS_HOME: homeDir });
  await seedNextFixture({ REFS_HOME: homeDir });
  const config = await readConfig(home);
  const entry = config.refs[NEXT_KEY];
  await writeConfig(home, {
    ...config,
    refs: {
      ...config.refs,
      [NEXT_KEY]: {
        ...(entry as NonNullable<typeof entry>),
        packages: { ...entry?.packages, toString: REAL_TO_STRING_PACKAGE },
      },
    },
  });
};

const NOT_A_TAG = 1;

const tagJson = async (
  homeDir: string,
  args: readonly string[],
  scriptedTag?: string,
): Promise<unknown> => {
  const { ctx, runner, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  if (scriptedTag !== undefined) {
    runner.expect(`git show-ref --verify -- refs/tags/${scriptedTag}`, { exitCode: NOT_A_TAG });
  }
  await run(ctx, ['node', 'refs', 'tag', ...args, '--json']);
  return JSON.parse(stdout.at(LAST) ?? '{}');
};

describe('refs tag: a package name that only exists on Object.prototype', () => {
  it.each(PROTOTYPE_NAMES)('is not found rather than answered for: %s', async (name) => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await tagJson(homeDir, [NEXT_KEY, '1.2.3', '--package', name]);

        expect(envelope).toMatchObject({
          error: {
            code: 'not_found',
            message: `no package '${name}' registered on ref '${NEXT_KEY}'`,
          },
          ok: false,
        });
      }),
    );
  });
});

describe('refs resolve: a package name that only exists on Object.prototype', () => {
  it.each(PROTOTYPE_NAMES)('is not found rather than crashing: %s', async (name) => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await resolveJson(homeDir, [name, '--ref', NEXT_KEY]);

        expect(envelope.error?.code).toBe('not_found');
      }),
    );
  });
});

describe('refs resolve: a prototype name reached through the import-path prefix loop', () => {
  it.each(PROTOTYPE_NAMES)('is not found there either: %s', async (name) => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        // The exact-match guard never sees this: `toString/subpath` has no own entry, so routing
        // falls into the segment-prefix loop and asks the same question of `toString`. Pinning
        // only the exact lookup left the prefix one answering with the inherited method.
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await resolveJson(homeDir, [`${name}/subpath`, '--ref', NEXT_KEY]);

        expect(envelope.error?.code).toBe('not_found');
      }),
    );
  });

  it('is not found as a prefix across every ref either', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await resolveJson(homeDir, ['toString/subpath']);

        expect(envelope.error?.code).toBe('not_found');
      }),
    );
  });

  it('is not found when searched for across every ref either', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await resolveJson(homeDir, ['toString']);

        expect(envelope.error?.code).toBe('not_found');
      }),
    );
  });
});

describe('refs resolve: an ordinary package', () => {
  it('still resolves', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await resolveJson(homeDir, ['next', '--ref', NEXT_KEY]);

        expect(envelope.ok).toBe(true);
        expect(envelope.data?.['package']).toMatchObject({ name: 'next', status: 'verified' });
      }),
    );
  });
});

describe('a package genuinely registered under a prototype-shadowing name', () => {
  it('is still found, because own-ness is the question and not the spelling', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        // `toString` and `valueOf` are NOT in `DANGEROUS_RECORD_KEYS` — only `__proto__`,
        // `constructor` and `prototype` are — so a repository really can register a package under
        // one, and the fix must not turn that into a `not_found`.
        await seedWithRealToString(homeDir);

        const envelope = await resolveJson(homeDir, ['toString', '--ref', NEXT_KEY]);

        expect(envelope.error).toBeUndefined();
        expect(envelope.data?.['package']).toMatchObject({ name: 'toString' });
      }),
    );
  });

  it("uses that package's OWN tag format, not the ref's", async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedWithRealToString(homeDir);

        const envelope = await tagJson(
          homeDir,
          [NEXT_KEY, '1.2.3', '--package', 'toString'],
          'toString@1.2.3',
        );

        // The tag itself is scripted as absent, so what this asserts is which NAME was looked for.
        // `v1.2.3` would mean the entry was never read and the ref's format was used, which is
        // exactly the silent fallback the old lookup produced for a name with no entry at all.
        expect(JSON.stringify(envelope)).toContain('toString@1.2.3');
        expect(JSON.stringify(envelope)).not.toContain('v1.2.3');
      }),
    );
  });
});
