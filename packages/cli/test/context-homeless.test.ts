import { describe, expect, it, vi } from 'vitest';

// `os.homedir()` has no "could not resolve it" return value: Node wraps the libuv call in
// `getCheckedFunction` and throws `ERR_SYSTEM_ERROR` instead (`lib/os.js`, verified against
// v24.12.0). It happens when neither `$HOME` nor `$USERPROFILE` is set and the effective UID has
// no passwd entry — an arbitrary-UID container, most plausibly.
//
// `realContext()` is built on every command before a single argument is parsed, so an escaping
// throw would kill runs that never needed a home directory at all: `refs sync` against an explicit
// `REFS_HOME` is the case that used to work and must keep working.
//
// This lives in its own file rather than in `context.test.ts`, which asserts `ctx.homedir` equals
// the REAL `os.homedir()` — a module mock cannot be scoped to one case there without both tests
// lying about what they exercise. The replacement is the whole module rather than a spread over
// the original: `context.ts` takes nothing but `homedir` from it, and the second case below fails
// loudly if anything else in the import graph ever starts needing a different export.
vi.mock(import('node:os'), () => ({
  homedir: (): string => {
    throw new Error('ENOENT: no such file or directory, uv_os_homedir');
  },
}));

describe('real context in a homeless environment', () => {
  it('reports an empty homedir rather than letting the throw escape', async () => {
    expect.hasAssertions();
    const { realContext } = await import('../src/context.ts');
    // Empty is what `doctor`'s `skill` check already treats as "no home", and what a set-but-empty
    // `$HOME` yields on POSIX — so both homeless shapes arrive as one case rather than two.
    expect(realContext().homedir).toBe('');
  });

  it('still wires the rest of the context', async () => {
    expect.hasAssertions();
    const { realContext } = await import('../src/context.ts');
    // Pins that the guard is scoped to `homedir` and does not swallow the whole construction —
    // a `try` around the object literal would leave every other field unset and pass the case
    // above.
    expect(realContext().env).toBe(process.env);
    expect(realContext().nodeVersion).toBe(process.version);
  });
});
