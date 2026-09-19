import type { Config, RefKey } from '@kaisers-io/refs-core';
import { FakeRunner, RefsError, SpawnRunner } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { requireCheckout } from '../../src/commands/ref-context.ts';
import { resolveCheckoutHead } from '../../src/commands/add-checkout-guards.ts';
import { routeQuery } from '../../src/commands/resolve-route.ts';

// Recovery messages that end in a command are commands someone runs. A ref key and a package name
// are both permitted to carry `$()`, `;`, `|` and quotes — SAFE_SEGMENT is a filesystem-containment
// alphabet, not a shell one — so the value has to be quoted before it is printed. These tests take
// the clause the CLI printed and hand it to a real `/bin/sh`, because that is the only thing that
// answers whether the printed line survives word splitting. A hand-built argv would not: it passes
// a metacharacter straight through as one element and hides exactly the bug.

const HOSTILE = String.raw`evil$(touch /dev/null);x'y`;
const HOSTILE_KEY = `example.com/o/${HOSTILE}` as RefKey;
const SUCCESS = 0;
const NOT_FOUND = -1;
const runner = new SpawnRunner();

/** Everything the message put after `marker`, i.e. the part presented as a command. */
const clauseAfter = (message: string, marker: string): string => {
  const at = message.indexOf(marker);
  expect(at, `expected the message to contain '${marker}': ${message}`).toBeGreaterThan(NOT_FOUND);
  return message.slice(at + marker.length).split(', then ')[0] ?? '';
};

/** Runs the printed clause through a real shell with `refs` replaced by a program that echoes its
 * argv one element per line, and returns those elements. */
const argvFromShell = async (clause: string): Promise<string[]> => {
  const line = clause.replace(/^refs /u, String.raw`printf '%s\n' `);
  const result = await runner.run('sh', ['-c', line]);
  expect(result.exitCode, `shell rejected the printed clause: ${result.stderr}`).toBe(SUCCESS);
  return result.stdout.split('\n').filter((part) => part !== '');
};

const messageOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof RefsError) {
      return error.message;
    }
    throw error;
  }
  throw new Error('expected the guard to throw');
};

const entry = (packages: Record<string, { description: string; path: string }>): unknown => ({
  default_branch: 'main',
  description: 'd',
  packages,
  url: 'https://example.com/o/r',
});

const configWith = (refs: Record<string, unknown>): Config =>
  ({ meta: { schema_version: 1 }, refs }) as unknown as Config;

/** `resolveCheckoutHead` with its first two guards satisfied and `rev-parse HEAD` failing. */
const corruptCheckoutMessage = async (key: RefKey): Promise<string> => {
  const hooksDir = '/refs-home/hooks';
  const fake = new FakeRunner();
  fake.expect('git remote get-url origin', { stdout: 'https://example.com/o/r\n' });
  fake.expect('git config --local core.hooksPath', { stdout: `${hooksDir}\n` });
  fake.expect('git rev-parse HEAD', { exitCode: 1, stderr: 'fatal: bad revision' });
  const failed: unknown = await resolveCheckoutHead(fake, {
    allowFileUrls: false,
    dest: '/refs-home/sources/x',
    expectedUrl: 'https://example.com/o/r',
    hooksDir,
    key,
  }).catch((error: unknown) => error);
  expect(failed).toBeInstanceOf(RefsError);
  return (failed as RefsError).message;
};

describe('recovery commands naming a ref key', () => {
  it('quotes the key in the missing-checkout remedy', async () => {
    expect.hasAssertions();
    const message = messageOf(() => {
      requireCheckout('/nonexistent/checkout', HOSTILE_KEY);
    });
    await expect(argvFromShell(clauseAfter(message, 'run: '))).resolves.toStrictEqual([
      'sync',
      HOSTILE_KEY,
    ]);
  });

  it('quotes the key in the corrupt-checkout remedy', async () => {
    expect.hasAssertions();
    const message = await corruptCheckoutMessage(HOSTILE_KEY);
    await expect(argvFromShell(clauseAfter(message, 'run: '))).resolves.toStrictEqual([
      'remove',
      HOSTILE_KEY,
    ]);
  });

  it('quotes the key in the no-matching-package remedy', async () => {
    expect.hasAssertions();
    const config = configWith({ [HOSTILE_KEY]: entry({ other: { description: 'd', path: '.' } }) });
    const message = messageOf(() =>
      routeQuery(config, 'nope', { allowFileUrls: false, ref: HOSTILE_KEY }),
    );
    await expect(argvFromShell(clauseAfter(message, 'inspect: '))).resolves.toStrictEqual([
      'show',
      HOSTILE_KEY,
      '--packages',
      '--json',
    ]);
  });
});

describe('recovery command naming a package', () => {
  it('quotes the name and names a real ref rather than a placeholder', async () => {
    expect.hasAssertions();
    const config = configWith({
      'example.com/o/one': entry({ [HOSTILE]: { description: 'd', path: '.' } }),
      'example.com/o/two': entry({ [HOSTILE]: { description: 'd', path: '.' } }),
    });
    const message = messageOf(() => routeQuery(config, HOSTILE, { allowFileUrls: false }));
    await expect(argvFromShell(clauseAfter(message, 'pick one with: '))).resolves.toStrictEqual([
      'resolve',
      HOSTILE,
      '--ref',
      'example.com/o/one',
    ]);
  });
});
