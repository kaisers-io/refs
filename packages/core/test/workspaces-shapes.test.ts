import { describe, expect, it } from 'vitest';
import { classifyWorkspacePattern } from '../src/workspaces-shapes.ts';

// Which pattern shapes this scanner will WALK, and what plan each one produces. Matching is
// minimatch's job — the plan carries the original pattern for it — so nothing here is about
// whether a path matches, only about which directory to read or which single path to probe.

describe('workspace pattern classification', () => {
  it('classifies `<dir>/*` as one-level expansion under that dir', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('packages/*')).toStrictEqual({
      baseDir: 'packages',
      kind: 'expand-children',
      pattern: 'packages/*',
      suffix: '',
    });
  });

  it('classifies bare `*` (flat layout) as expansion under the repo root `.`', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('*')).toStrictEqual({
      baseDir: '.',
      kind: 'expand-children',
      pattern: '*',
      suffix: '',
    });
  });

  it('classifies a wildcard-free pattern as a literal directory probe', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('docs/site')).toStrictEqual({
      dir: 'docs/site',
      kind: 'probe-dir',
      pattern: 'docs/site',
    });
  });

  it('classifies a directory literally named "..packages" as a probe, not an escape', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('..packages')).toStrictEqual({
      dir: '..packages',
      kind: 'probe-dir',
      pattern: '..packages',
    });
  });
});

describe('unsupported workspace pattern forms', () => {
  it('ignores a raw negation, which the caller is expected to have stripped', () => {
    expect.hasAssertions();
    // Negations ARE applied — `expandPatterns` strips the `!` and classifies the body. Reaching
    // here with one still attached would classify a directory literally named `!packages`.
    expect(classifyWorkspacePattern('!packages/b')).toStrictEqual({ kind: 'ignore' });
  });

  it('ignores deeper glob patterns like ** (v1 simplification)', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('src/**/pkg')).toStrictEqual({ kind: 'ignore' });
  });

  it('ignores a pattern above the single-wildcard budget even when it ends with `/*`', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('packages/*/nested/*')).toStrictEqual({ kind: 'ignore' });
  });

  it('expands a wildcard inside the last segment, carrying the pattern for matching', () => {
    expect.hasAssertions();
    // Real repositories exclude by this shape — TanStack Query writes `!examples/vue/2*` — and a
    // negation nobody can expand costs every finding about the repository, not just those paths.
    // The plan says WHERE to walk; whether a child matches is the matcher's answer, from the
    // pattern carried alongside.
    expect(classifyWorkspacePattern('pkg-*')).toStrictEqual({
      baseDir: '.',
      kind: 'expand-children',
      pattern: 'pkg-*',
      suffix: '',
    });
    expect(classifyWorkspacePattern('examples/vue/2*')).toStrictEqual({
      baseDir: 'examples/vue',
      kind: 'expand-children',
      pattern: 'examples/vue/2*',
      suffix: '',
    });
  });
});

describe('a wildcard that is not in the last segment', () => {
  it('expands its base one level, with the rest as a literal suffix', () => {
    expect.hasAssertions();
    // One `readdir` of `packages/` plus a literal probe per child — the same work `packages/*`
    // does, which is why the wildcard's position never justified rejecting this. `vercel/next.js`
    // declares `crates/*/js` and `turbopack/crates/*/js`, and four published packages sat behind
    // them unseen.
    expect(classifyWorkspacePattern('packages/*/test')).toStrictEqual({
      baseDir: 'packages',
      kind: 'expand-children',
      pattern: 'packages/*/test',
      suffix: 'test',
    });
    expect(classifyWorkspacePattern('turbopack/crates/*/js')).toStrictEqual({
      baseDir: 'turbopack/crates',
      kind: 'expand-children',
      pattern: 'turbopack/crates/*/js',
      suffix: 'js',
    });
  });

  it('ignores absolute, leading-.. and mid-pattern .. patterns', () => {
    expect.hasAssertions();
    expect(classifyWorkspacePattern('/etc/*')).toStrictEqual({ kind: 'ignore' });
    expect(classifyWorkspacePattern('../*')).toStrictEqual({ kind: 'ignore' });
    expect(classifyWorkspacePattern('packages/../../etc/*')).toStrictEqual({ kind: 'ignore' });
  });
});
