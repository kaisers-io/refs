import { describe, expect, it } from 'vitest';

import { zFinalProposal, zProposal } from '../../src/schemas/proposal.ts';
import { zState } from '../../src/schemas/state.ts';

const SHA_LENGTH = 40;

describe('state schema', () => {
  it('defaults to empty refs and roundtrips a full ref state', () => {
    expect.hasAssertions();
    expect(zState.parse({}).refs).toStrictEqual({});
    const parsed = zState.parse({
      refs: {
        'github.com/a/b': {
          effective_clone_mode: 'full',
          head_sha: 'a'.repeat(SHA_LENGTH),
          last_fetched_at: '2026-07-04T10:00:00Z',
        },
      },
    });
    expect(parsed.refs['github.com/a/b']?.effective_clone_mode).toBe('full');
  });

  it('rejects __proto__ as a state ref key instead of silently dropping it', () => {
    expect.hasAssertions();
    const refs = JSON.parse('{"__proto__": {"last_error": "x"}}') as Record<string, unknown>;
    expect(zState.safeParse({ refs }).success).toBe(false);
  });
});

describe('proposal schema', () => {
  const base = {
    default_branch: 'canary',
    key: 'github.com/vercel/next.js',
    packages: { next: { path: 'packages/next' } },
    tag_format_candidate: 'v{version}',
    url: 'https://github.com/vercel/next.js',
  };

  it('zProposal allows missing descriptions; zFinalProposal requires them', () => {
    expect.hasAssertions();
    expect(zProposal.safeParse(base).success).toBe(true);
    expect(zFinalProposal.safeParse(base).success).toBe(false);
    expect(
      zFinalProposal.safeParse({
        ...base,
        description: 'React framework.',
        packages: { next: { description: 'The framework.', path: 'packages/next' } },
      }).success,
    ).toBe(true);
  });

  it('rejects __proto__ as a proposal package key', () => {
    expect.hasAssertions();
    const packages = JSON.parse('{"__proto__": {"path": "."}}') as Record<string, unknown>;
    expect(zProposal.safeParse({ ...base, packages }).success).toBe(false);
    expect(zFinalProposal.safeParse({ ...base, description: 'd', packages }).success).toBe(false);
  });
});
