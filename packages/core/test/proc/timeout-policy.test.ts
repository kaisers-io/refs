import {
  DEFAULT_GIT_TIMEOUT_SECONDS,
  GIT_TIMEOUT_VARIABLE,
  commandTimeoutMs,
} from '../../src/proc/timeout-policy.ts';
import { describe, expect, it } from 'vitest';

// `REFS_GIT_TIMEOUT`: seconds, `0` for no bound, anything unparseable ignored in favour of the
// default — so a typo can neither disable the bound nor set an absurd one.

const MS_PER_SECOND = 1000;
const DEFAULT_MS = DEFAULT_GIT_TIMEOUT_SECONDS * MS_PER_SECOND;
const MAX_TIMER_MS = 2_147_483_647;
const AT_LEAST_TEN_MINUTES_S = 600;
const THIRTY_SECONDS = 30;
const withValue = (value: string): NodeJS.ProcessEnv => ({ [GIT_TIMEOUT_VARIABLE]: value });

describe('the command timeout setting', () => {
  it('defaults to a generous bound when unset', () => {
    expect.hasAssertions();
    expect(commandTimeoutMs({})).toBe(DEFAULT_MS);
    expect(DEFAULT_GIT_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(AT_LEAST_TEN_MINUTES_S);
  });

  it('reads whole seconds, surrounding whitespace allowed', () => {
    expect.hasAssertions();
    expect(commandTimeoutMs(withValue(' 30 '))).toBe(THIRTY_SECONDS * MS_PER_SECOND);
  });

  it('turns the bound off with 0', () => {
    expect.hasAssertions();
    expect(commandTimeoutMs(withValue('0'))).toBeUndefined();
  });

  it.each([['10m'], ['-5'], ['1.5'], [''], ['off']])(
    'ignores %j and keeps the default',
    (value) => {
      expect.hasAssertions();
      expect(commandTimeoutMs(withValue(value))).toBe(DEFAULT_MS);
    },
  );

  it('caps a value larger than a timer can hold instead of letting it fire at once', () => {
    expect.hasAssertions();
    expect(commandTimeoutMs(withValue('99999999999'))).toBe(MAX_TIMER_MS);
  });
});
