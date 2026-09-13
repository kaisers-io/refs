import { asCheckout, freshRepo } from '../helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { packageDataFor, packageLines } from '../../src/commands/resolve-package.ts';
import { join } from 'node:path';
import { zRefKey } from '@kaisers-io/refs-core';

// What `refs resolve` attaches to a package, and — more importantly — what it refuses to attach.

const KEY = zRefKey.parse('github.com/acme/alpha');

/** A checkout holding one package at `packages/p`, with the manifest the caller asks for. */
const checkoutWith = (manifest: Record<string, unknown>): string => {
  const dir = asCheckout(freshRepo());
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(join(dir, 'packages', 'p'), { recursive: true });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(dir, 'packages', 'p', 'package.json'), JSON.stringify(manifest));
  return dir;
};

const resolveIn = (checkoutDir: string, packageName: string): ReturnType<typeof packageDataFor> =>
  packageDataFor({
    checkoutDir,
    checkoutManaged: true,
    checkoutReason: '',
    configuredPath: 'packages/p',
    home: { configPath: '', hooksDir: '', root: '', sourcesDir: '' } as never,
    key: KEY,
    packageName,
  });

describe('a package whose location was verified', () => {
  it('carries the declaration it found there', async () => {
    expect.hasAssertions();
    const dir = checkoutWith({ exports: { '.': './src/index.ts' }, name: '@acme/p' });

    const data = await resolveIn(dir, '@acme/p');

    expect(data.status).toBe('verified');
    expect(data.entry_points?.entries[0]?.value).toStrictEqual({
      kind: 'target',
      observed: 'absent',
      target: './src/index.ts',
    });
  });
});

describe('a package whose identity was NOT established', () => {
  it('carries no declaration at all, even though the path came back', async () => {
    expect.hasAssertions();
    const dir = asCheckout(freshRepo());
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(dir, 'packages', 'p'), { recursive: true });
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(join(dir, 'packages', 'p', 'package.json'), '{ not json');

    const data = await resolveIn(dir, '@acme/p');

    // `unverifiable` keeps its path — this outcome, a containment rejection and lock contention
    // all produce one. Gating on the path rather than the verdict would attach whatever sits
    // there to the package that was asked for, which is the failure verification exists to
    // prevent.
    expect(data.status).toBe('unverifiable');
    expect(data.path).not.toBeNull();
    expect(data.entry_points).toBeUndefined();
  });
});

describe('the human summary', () => {
  it('does not call an uninspected target absent', async () => {
    expect.hasAssertions();
    const dir = checkoutWith({ exports: { './lib/*': './src/*.js' }, name: '@acme/p' });

    const data = await resolveIn(dir, '@acme/p');
    const lines = packageLines(data);

    // A pattern is never probed. Folding it into "none is present" would state a fact about
    // something nobody looked at.
    expect(lines).toContain('entry points: none of the 1 declared target(s) was inspected');
  });

  it('separates what is absent from what was not inspected', async () => {
    expect.hasAssertions();
    const dir = checkoutWith({
      exports: { '.': './dist/index.js', './lib/*': './src/*.js' },
      name: '@acme/p',
    });

    const data = await resolveIn(dir, '@acme/p');
    const lines = packageLines(data);

    expect(lines).toContain('entry points: 1 declared target(s) absent here, 1 not inspected');
  });
});
