import { describe, expect, it } from 'vitest';
import { networkTimeoutFrom } from '../src/network-timeout.ts';

const MS_PER_SECOND = 1000;

// Off unless set, and a value refs cannot use is refused: a typo silently meaning "no deadline"
// would be the hang the variable exists to prevent.

describe('the network deadline read from REFS_NETWORK_TIMEOUT', () => {
  it.each([
    ['unset', {}],
    ['empty', { REFS_NETWORK_TIMEOUT: '' }],
    ['zero', { REFS_NETWORK_TIMEOUT: '0' }],
  ])('means no deadline when %s', (_label, env) => {
    expect.hasAssertions();
    expect(networkTimeoutFrom(env)).toBeUndefined();
  });

  it.each(['30', ' 600 ', '2147483'])('reads %j as seconds', (value) => {
    expect.hasAssertions();
    expect(networkTimeoutFrom({ REFS_NETWORK_TIMEOUT: value })).toBe(Number(value) * MS_PER_SECOND);
  });

  it.each(['1.5', '-1', '30s', 'abc', '1e3', '2147484'])('refuses %j', (value) => {
    expect.hasAssertions();
    expect(() => networkTimeoutFrom({ REFS_NETWORK_TIMEOUT: value })).toThrow(
      `REFS_NETWORK_TIMEOUT must be a whole number of seconds up to 2147483, or 0 for no deadline — got '${value}'`,
    );
  });
});
