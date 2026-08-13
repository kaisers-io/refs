import { describe, expect, it } from 'vitest';
import { comparePlainVersions } from '../src/version.ts';

// Ordering for plain `x.y.z`. The interesting cases are the ones a `Number`-based comparison gets
// wrong, and the ones nobody should try to order at all.

const LESS = -1;
const GREATER = 1;

describe('plain version ordering', () => {
  it('orders by the first component that differs', () => {
    expect.hasAssertions();
    expect(comparePlainVersions('0.8.3', '0.9.0')).toBeLessThan(0);
    expect(comparePlainVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(comparePlainVersions('0.8.3', '0.8.3')).toBe(0);
  });

  it('compares components as numbers, not as text', () => {
    expect.hasAssertions();
    // The case a naive string comparison gets backwards: '10' < '9' lexicographically.
    expect(comparePlainVersions('0.9.0', '0.10.0')).toBeLessThan(0);
    expect(comparePlainVersions('2.0.0', '10.0.0')).toBeLessThan(0);
  });

  it('stays exact past the safe integer range', () => {
    expect.hasAssertions();
    // Both components exceed 2^53, where `Number` would round them to the same value and report
    // equality. Unreachable for refs itself; the point is that the helper does not have a ceiling
    // that a caller has to know about.
    const left = '1.9007199254740993.0';
    const right = '1.9007199254740992.0';
    expect(comparePlainVersions(left, right)).toBeGreaterThan(0);
  });

  it('ignores leading zeros in a component', () => {
    expect.hasAssertions();
    expect(comparePlainVersions('1.007.0', '1.7.0')).toBe(0);
  });
});

describe('plain version ordering: what it refuses', () => {
  it('refuses to order a prerelease or build metadata', () => {
    expect.hasAssertions();
    // Orderable in principle, but by rules this helper does not implement — returning a guess
    // would be worse than saying nothing.
    expect(comparePlainVersions('1.2.3-rc.1', '1.2.3')).toBeUndefined();
    expect(comparePlainVersions('1.2.3+build', '1.2.3')).toBeUndefined();
  });

  it('refuses to order anything else that is not three decimal components', () => {
    expect.hasAssertions();
    expect(comparePlainVersions('1.2', '1.2.0')).toBeUndefined();
    expect(comparePlainVersions('', '1.2.3')).toBeUndefined();
    // `Number` would read these as valid; the pattern guard is what stops it.
    expect(comparePlainVersions('1.0x2.3', '1.2.3')).toBeUndefined();
    expect(comparePlainVersions('1..3', '1.0.3')).toBeUndefined();
  });

  it('is antisymmetric', () => {
    expect.hasAssertions();
    expect(Math.sign(comparePlainVersions('1.2.3', '1.2.4') as number)).toBe(LESS);
    expect(Math.sign(comparePlainVersions('1.2.4', '1.2.3') as number)).toBe(GREATER);
  });
});
