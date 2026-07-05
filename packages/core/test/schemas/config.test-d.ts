import { expectTypeOf, it } from 'vitest';
import type { Settings } from '../../src/schemas/config.ts';

it('Settings has exactly the three v1 keys', () => {
  expectTypeOf<keyof Settings>().toEqualTypeOf<'clone_mode' | 'sync_ttl' | 'git_transport'>();
});
