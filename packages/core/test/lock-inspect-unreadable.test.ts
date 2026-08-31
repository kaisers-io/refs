import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { inspectLocks } from '../src/lock-inspect.ts';
import { join } from 'node:path';
import { resolveHome } from '../src/home.ts';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// A locks directory that lists but cannot be searched — `readdir` succeeds, `stat` on its children
// fails with EACCES — is a real configuration (a directory with the read bit but not the execute
// bit). It must never read as an EMPTY locks directory: "no locks held" from a check that could not
// look is the worst answer a diagnostic can give, because it is indistinguishable from good news.
//
// `stat` is mocked rather than provoked with `chmod`, which behaves differently on Windows, where
// this suite also runs.

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal();
  // `stat` is overloaded (its return type depends on `bigint`), and vi.fn's inferred mock type
  // cannot reproduce every overload — cast back to the original signature, as
  // `lock-steal-eperm.test.ts` does for `mkdir`.
  const statSpy = vi.fn<typeof actual.stat>(actual.stat as never) as unknown as typeof actual.stat;
  return { ...actual, stat: statSpy };
});

const eaccesError = (): NodeJS.ErrnoException => {
  const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
  error.code = 'EACCES';
  return error;
};

describe('inspectLocks on an unsearchable locks directory', () => {
  it('reports the entry as unknown rather than dropping it as gone', async () => {
    expect.hasAssertions();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    const dir = mkdtempSync(join(tmpdir(), 'refs-lock-eacces-'));
    const home = resolveHome({ REFS_HOME: dir });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(home.locksDir, 'home'), { recursive: true });
    // The directory lists fine; stat'ing into it does not. No `meta.json` is written, so metadata
    // reads as `missing` and the directory's own mtime is the only thing left to judge by — which
    // is exactly the read that fails here.
    vi.mocked(stat).mockRejectedValueOnce(eaccesError());

    const locks = await inspectLocks(home);

    // `gone` and `could not tell` both yield no timestamp, but only the first means "nothing is
    // here". Collapsing them is what would turn a permissions fault into a clean bill of health.
    expect(locks).toHaveLength(1);
    expect(locks[0]?.diagnosis).toMatchObject({
      meta: 'missing',
      policy: 'unknown',
      // Never stale: stealing a lock on the strength of a path nobody can read would be acting on
      // ignorance.
      stale: false,
    });
  });
});
