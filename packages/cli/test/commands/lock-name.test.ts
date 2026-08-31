import { describe, expect, it } from 'vitest';
import { refLockName } from '../../src/commands/add-source.ts';
import { zRefKey } from '@kaisers-io/refs-core';

// `refLockName` maps a ref key onto a lock name, and that map has to be injective: two refs that
// derive one name serialize against each other for the length of a clone, and `doctor` then names
// the wrong ref as busy. Substituting `_` for `/` was not injective — `_` is legal inside a key.
//
// The example cases below are the ones that were actually wrong (or that a plausible fix gets
// wrong); the sweep at the end is what says the property holds rather than that four cases pass.

const nameFor = (key: string): string => refLockName(zRefKey.parse(key));

describe('refLockName: keys that used to collide', () => {
  it('distinguishes a key whose segment contains "_" from one where "/" sat instead', () => {
    expect.hasAssertions();

    expect(nameFor('github.com/acme_tools/widget')).not.toBe(
      nameFor('github.com/acme/tools_widget'),
    );
  });

  it('distinguishes an escaped underscore from an escaped slash followed by that letter', () => {
    expect.hasAssertions();

    // The trap in the obvious fix (`_` -> `_u`, `/` -> `_`, no separate namespace): these two
    // both come out as `github.com_acme_utools_widget` under it.
    expect(nameFor('github.com/acme_tools/widget')).not.toBe(
      nameFor('github.com/acme/utools/widget'),
    );
  });
});

describe('refLockName: names refs has already written', () => {
  it('leaves a key without "_" byte-identical to the previous scheme', () => {
    expect.hasAssertions();

    expect(nameFor('github.com/vercel/next.js')).toBe('ref.github.com_vercel_next.js');
  });

  it('moves only keys containing "_" into the escaped namespace', () => {
    expect.hasAssertions();

    expect(nameFor('github.com/acme_tools/widget')).toBe('ref._github.com_sacme_utools_swidget');
  });
});

describe('refLockName: every name is a legal lock name', () => {
  // The allowlist `withLock` enforces (`LOCK_NAME_PATTERN` in core's `lock.ts`). A name that fails
  // it turns every locking command for that ref into a validation error.
  const LOCK_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u;

  it('accepts the escaped form as well as the plain one', () => {
    expect.hasAssertions();

    expect(nameFor('github.com/acme_tools/widget')).toMatch(LOCK_NAME);
    expect(nameFor('github.com/vercel/next.js')).toMatch(LOCK_NAME);
    expect(nameFor('gitlab.example.com_8443/group/repo')).toMatch(LOCK_NAME);
  });
});

/** Every string over `alphabet` of length `length`, as an array. Small alphabets only — this is
 * exponential, and it is chosen to stress the escape characters rather than to be broad. */
const wordsOf = (alphabet: string, length: number): string[] => {
  if (length === 0) {
    return [''];
  }
  return wordsOf(alphabet, length - 1).flatMap((prefix) =>
    [...alphabet].map((char) => `${prefix}${char}`),
  );
};

const MIN_LENGTH = 3;
const MAX_LENGTH = 7;
// Every character the encoding treats specially, plus one ordinary letter and one digit so the
// generated keys can form a valid host.
const ALPHABET = 'a1_u/s.';

/** Every generated string that is a valid ref key — `zRefKey` is the authority, so the sweep can
 * never claim a collision between two things refs would never store. */
const generatedKeys = (): string[] => {
  const lengths = Array.from(
    { length: MAX_LENGTH - MIN_LENGTH + 1 },
    (_unused, index) => MIN_LENGTH + index,
  );
  return lengths
    .flatMap((length) => wordsOf(ALPHABET, length))
    .filter((candidate) => zRefKey.safeParse(candidate).success);
};

/** Every pair of keys that derives one lock name, described so a failure names the actual pair
 * rather than only a count. */
const collisionsAmong = (keys: readonly string[]): string[] => {
  const byName = new Map<string, string>();
  return keys.flatMap((key) => {
    const name = refLockName(zRefKey.parse(key));
    const seen = byName.get(name);
    byName.set(name, key);
    return seen === undefined ? [] : [`${seen} and ${key} both derive ${name}`];
  });
};

const NO_KEYS = 0;

describe('refLockName: injective over generated keys', () => {
  it('gives no two valid ref keys the same lock name', () => {
    expect.hasAssertions();
    const keys = generatedKeys();

    expect(collisionsAmong(keys)).toStrictEqual([]);
    expect(keys.length).toBeGreaterThan(NO_KEYS);
  });
});
