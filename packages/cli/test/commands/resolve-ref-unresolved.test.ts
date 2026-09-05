import { describe, expect, it } from 'vitest';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { resolveJson } from '../helpers/resolve-support.ts';
import { seedNextFixture } from '../helpers/next-fixture.ts';

// What `--ref` says when its own argument resolves to nothing. Split out of `resolve-flags.ts` for
// the 300-line cap, and worth its own file anyway: this is the case where the fix for #88 could
// most easily be undone, by treating a failed key-suffix lookup as proof that a repository is not
// tracked.

describe('refs resolve --ref: an unconfigured ref', () => {
  it('does not claim the ref is absent — a suffix that misses is not proof', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        // `next` is a real prefix of the configured `github.com/vercel/next.js`, but not a key
        // suffix, so it misses — while `--ref next.js` resolves the very same repository. Calling
        // that "not registered" and suggesting `refs add` would recreate, one flag over, the false
        // conclusion this whole change exists to stop.
        const envelope = await resolveJson(homeDir, ['next', '--ref', 'next']);

        expect(envelope.error).toMatchObject({ code: 'not_found', reason: 'unmatched_query' });
        expect(envelope.error?.message).not.toContain('refs add');
      }),
    );
  });

  it('names the identifier shapes that do work', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        await seedNextFixture({ REFS_HOME: homeDir });

        const envelope = await resolveJson(homeDir, ['next', '--ref', 'nosuch-ref-anywhere']);

        expect(envelope.error?.message).toContain('full ref key or a unique suffix');
      }),
    );
  });
});
