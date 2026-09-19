import { describe, expect, it } from 'vitest';
import { isRegistrablePackageName } from '../../src/schemas/record-keys.ts';
import { isStorableText } from '../../src/schemas/primitives.ts';
import { zConfig } from '../../src/schemas/config.ts';

// A package name comes from a checkout manifest unchanged. It then becomes a `config.toml` table
// key — and a name that cannot be written back is worse than a rejected one: the pinned TOML
// serializer writes a lone surrogate as a `\ud800` escape, as a key AND as a value, and its own
// parser rejects that escape. Accepting one produced a config file refs could never read again.

// U+D800, the first high surrogate: valid UTF-16 on its own, but it has no UTF-8 encoding.
const HIGH_SURROGATE_START = 55_296;
const LONE_SURROGATE = String.fromCodePoint(HIGH_SURROGATE_START);
// Longer than npm's own 214-character cap on a REGISTRY name. A workspace member is not required
// to be an npm name, and this one round-trips through TOML perfectly well.
const LONG_NAME_LENGTH = 300;

const configWith = (overrides: { declined?: unknown; packages?: unknown }): unknown => ({
  meta: { cli_version: '0.17.0', schema_version: 1 },
  refs: {
    'example.com/o/r': {
      default_branch: 'main',
      description: 'a ref',
      ...(overrides.declined === undefined ? {} : { declined_packages: overrides.declined }),
      ...(overrides.packages === undefined ? {} : { packages: overrides.packages }),
      url: 'https://example.com/o/r.git',
    },
  },
  settings: { clone_mode: 'blobless', git_transport: 'https', sync_ttl: '1h' },
});

const entry = { description: 'd', path: '.' };

describe('a package name that cannot be written back', () => {
  it.each([
    ['a lone surrogate', `pkg${LONE_SURROGATE}`],
    ['an empty name', ''],
  ])('is refused as a registered key: %s', (_name, key) => {
    expect.hasAssertions();
    expect(zConfig.safeParse(configWith({ packages: { [key]: entry } })).success).toBe(false);
  });

  it('is refused as a declined name too, since that is written back as well', () => {
    expect.hasAssertions();
    const declined = [{ name: `pkg${LONE_SURROGATE}`, path: 'packages/a' }];
    expect(zConfig.safeParse(configWith({ declined })).success).toBe(false);
  });

  it('is not offered for registration, so no command is printed that would fail', () => {
    expect.hasAssertions();
    expect(isRegistrablePackageName(`pkg${LONE_SURROGATE}`)).toBe(false);
  });
});

describe('names that must keep working', () => {
  it.each([
    ['an ordinary name', 'pkg-a'],
    ['a scoped name', '@acme/pkg'],
    // `zConfig` is validated on every READ, so a length bound here would make an existing home
    // unreadable — and unfixable through a CLI that cannot load it — over a name that was never
    // the problem. Storability is the only question this schema answers.
    ['a long name', 'p'.repeat(LONG_NAME_LENGTH)],
  ])('accepts %s as a registered key', (_name, key) => {
    expect.hasAssertions();
    expect(zConfig.safeParse(configWith({ packages: { [key]: entry } })).success).toBe(true);
  });

  it('still accepts a prototype name as DECLINED, which is the documented difference', () => {
    expect.hasAssertions();
    // A workspace member may legitimately be called `constructor`. It cannot be a record key, which
    // is exactly why the decline list exists — so the wider alphabet there must survive this change.
    const declined = [{ name: 'constructor', path: 'packages/a' }];
    expect(zConfig.safeParse(configWith({ declined })).success).toBe(true);
    expect(isRegistrablePackageName('constructor')).toBe(false);
    expect(isStorableText('constructor')).toBe(true);
  });
});

// Every FREE-TEXT field that lands in `config.toml`, not only the package name. `refs add
// --proposal` reads its input as JSON, and JSON has an escape for a lone surrogate where TOML has
// none — so a proposal could carry one into the ref description, the url or a package description
// and leave the home unreadable, exactly as a package name could.
//
// Each field below holds a distinct value, so a case names the field by that value and the
// surrogate is appended to it in the serialized JSON. That keeps every other constraint on the
// field satisfied — a tag format still contains `{version}`, a path is still a legal path — so a
// rejection can only come from the storability rule.
const BASE = {
  meta: { cli_version: 'cli-version', schema_version: 1 },
  refs: {
    'example.com/o/r': {
      declined_packages: [{ name: 'declined-name', path: 'packages/declined' }],
      default_branch: 'branch-name',
      description: 'ref-description',
      packages: {
        pkg: {
          description: 'package-description',
          path: 'packages/member',
          tag_format: 'p{version}',
        },
      },
      tag_format: 'r{version}',
      url: 'https://example.com/o/r.git',
    },
  },
  settings: { clone_mode: 'blobless', git_transport: 'https', sync_ttl: '1h' },
};

// `\ud800` as JSON TEXT: `JSON.parse` turns it into the lone surrogate the field must refuse.
// It cannot be written as a literal here, because a source file has no UTF-8 encoding for one.
const poisoned = (value: string): unknown =>
  JSON.parse(JSON.stringify(BASE).replace(`"${value}"`, `"${value}\\ud800"`));

describe('any config text that cannot be written back', () => {
  it.each([
    ['the ref description', 'ref-description'],
    ['the ref url', 'https://example.com/o/r.git'],
    ['the default branch', 'branch-name'],
    ['the ref tag format', 'r{version}'],
    ['a package description', 'package-description'],
    ['a package path', 'packages/member'],
    ['a package tag format', 'p{version}'],
    ['a declined name', 'declined-name'],
    ['a declined path', 'packages/declined'],
    ['the recorded cli version', 'cli-version'],
  ])('is refused in %s', (_field, value) => {
    expect.hasAssertions();
    expect(zConfig.safeParse(poisoned(value)).success).toBe(false);
  });

  it('accepts the same config untouched', () => {
    expect.hasAssertions();
    expect(zConfig.safeParse(structuredClone(BASE)).success).toBe(true);
  });
});
