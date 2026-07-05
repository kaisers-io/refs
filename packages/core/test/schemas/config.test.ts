import {
  SCHEMA_VERSION,
  zConfig,
  zRefEntry,
  zRefSettingsOverride,
  zSettings,
} from '../../src/schemas/config.ts';
import { describe, expect, it } from 'vitest';

const minimalRef = {
  default_branch: 'canary',
  description: 'React framework.',
  tag_format: 'v{version}',
  url: 'https://github.com/vercel/next.js',
};

describe('zSettings schema', () => {
  it('applies defaults', () => {
    expect.hasAssertions();
    expect(zSettings.parse({})).toStrictEqual({
      clone_mode: 'blobless',
      git_transport: 'https',
      sync_ttl: '1h',
    });
  });

  it('rejects unknown keys (strict)', () => {
    expect.hasAssertions();
    expect(zSettings.safeParse({ nope: 1 }).success).toBe(false);
  });
});

describe('settings-inheritance invariant', () => {
  it('every settings key is overridable per ref', () => {
    expect.hasAssertions();
    const settingsKeys = Object.keys(zSettings.shape).toSorted();
    const overrideKeys = Object.keys(zRefSettingsOverride.shape).toSorted();
    expect(overrideKeys).toStrictEqual(settingsKeys);
    const entry = zRefEntry.parse({ ...minimalRef, clone_mode: 'full', sync_ttl: '2h' });
    expect(entry.clone_mode).toBe('full');
  });
});

describe('zConfig schema', () => {
  it('parses a full config and preserves unknown meta keys', () => {
    expect.hasAssertions();
    const parsed = zConfig.parse({
      meta: { cli_version: '0.1.0', future_key: true, schema_version: SCHEMA_VERSION },
      refs: {
        'github.com/vercel/next.js': {
          ...minimalRef,
          packages: { next: { description: 'The framework.', path: 'packages/next' } },
        },
      },
      settings: {},
    });
    expect(parsed.meta).toMatchObject({ future_key: true });
    expect(parsed.refs['github.com/vercel/next.js']?.packages?.['next']?.path).toBe(
      'packages/next',
    );
  });

  it('rejects invalid ref keys and package paths', () => {
    expect.hasAssertions();
    expect(
      zConfig.safeParse({
        meta: { cli_version: '0.1.0', schema_version: 1 },
        refs: { 'github.com/../evil': minimalRef },
        settings: {},
      }).success,
    ).toBe(false);
  });
});

describe('dangerous record keys', () => {
  it('rejects __proto__ as a ref key instead of silently dropping it', () => {
    expect.hasAssertions();
    const refs = JSON.parse(
      '{"__proto__": {"description": "x", "url": "u", "tag_format": "{version}", "default_branch": "m"}}',
    ) as Record<string, unknown>;
    const result = zConfig.safeParse({
      meta: { cli_version: '0.1.0', schema_version: 1 },
      refs,
      settings: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects __proto__ as a package key instead of silently dropping it', () => {
    expect.hasAssertions();
    const packages = JSON.parse('{"__proto__": {"path": ".", "description": "x"}}') as Record<
      string,
      unknown
    >;
    const result = zRefEntry.safeParse({ ...minimalRef, packages });
    expect(result.success).toBe(false);
  });
});
