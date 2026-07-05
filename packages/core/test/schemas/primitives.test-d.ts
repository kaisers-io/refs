import { durationToMs, zDuration } from '../../src/schemas/primitives.ts';
import { expectTypeOf, it } from 'vitest';

it('durationToMs only accepts branded Duration', () => {
  // eslint-disable-next-line no-magic-numbers
  expectTypeOf(durationToMs).parameter(0).not.toEqualTypeOf<string>();
  const duration = zDuration.parse('1h');
  expectTypeOf(durationToMs(duration)).toEqualTypeOf<number>();
});
