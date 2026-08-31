import { checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { markCheckoutPresent, minutesAgoIso, seedConfig, seedState } from './ref-fixtures.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import type { CliContext } from '../../src/context.ts';
import { join } from 'node:path';

// The shared next.js monorepo fixture: two registered packages, fresh state, a present checkout
// with REAL manifests. Used by `resolve.test.ts` (routing) and `resolve-verification.test.ts`
// (identity verification), which is why it lives here rather than in either of them.

const NEXT_KEY = 'github.com/vercel/next.js';
const FRESH_MINUTES_AGO = 1;

const NEXT_ENTRY = {
  default_branch: 'canary',
  description: 'Next.js monorepo',
  packages: {
    '@next/env': { description: 'env loader', path: 'packages/next-env' },
    next: { description: 'the framework', path: 'packages/next' },
  },
  tag_format: 'v{version}',
  url: 'https://github.com/vercel/next.js',
};

// `resolve` verifies a package's identity by reading the `name` where the config says the package
// lives, so a fixture without manifests would make every happy path report `missing`.
const writeNextManifests = async (dest: string): Promise<void> => {
  await mkdir(join(dest, 'packages', 'next'), { recursive: true });
  await writeFile(join(dest, 'packages', 'next', 'package.json'), JSON.stringify({ name: 'next' }));
  await mkdir(join(dest, 'packages', 'next-env'), { recursive: true });
  await writeFile(
    join(dest, 'packages', 'next-env', 'package.json'),
    JSON.stringify({ name: '@next/env' }),
  );
};

const seedNextFixture = async (
  env: CliContext['env'],
): Promise<{ dest: string; lastFetchedAt: string }> => {
  const home = resolveHome(env);
  const lastFetchedAt = minutesAgoIso(FRESH_MINUTES_AGO);
  await seedConfig(home, { [NEXT_KEY]: NEXT_ENTRY });
  await seedState(home, { [NEXT_KEY]: { last_fetched_at: lastFetchedAt } });
  const dest = checkoutPath(home, zRefKey.parse(NEXT_KEY));
  // The url has to match the configured entry: `resolve` now establishes that the checkout at
  // this path really is the one this ref names, so a fixture standing in for one must look like it.
  await markCheckoutPresent(dest, NEXT_ENTRY.url);
  await writeNextManifests(dest);
  return { dest, lastFetchedAt };
};

export { NEXT_ENTRY, NEXT_KEY, seedNextFixture };
