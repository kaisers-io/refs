import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { probePackageIdentity } from '../src/package-identity.ts';
import { readEntryPoints } from '../src/entry-points.ts';
import { tmpdir } from 'node:os';

// A manifest is checkout content. `JSON.parse` embeds the offending input in its message for SOME
// malformations and not others, which is why one probe is misleading — measured on Node 24:
//
//   {"url":SECRET}         -> Unexpected token 'S', "{"url":SECRET}" is not valid JSON   (carries it)
//   {"a":"b"},broken       -> Unexpected non-whitespace character after JSON at position 9
//   {"a":"b",broken:1}     -> Expected double-quoted property name in JSON at position 9
//
// Both readers forwarded that message into a reason `refs resolve --json` renders, so the shape
// that carries the input put third-party bytes into the agent contract. Which malformations do it
// is a property of the Node version rather than anything refs decides, so the message is not
// forwarded at all.

// The input-embedding shape, with a token no fixed reason could contain by accident.
const SECRET = 'LEAKED_TOKEN_abc123';
const MALFORMED = `{"name":"@acme/a","token":${SECRET}}`;

const packageAt = (manifest: string): string => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-manifest-'));
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(dir, 'package.json'), manifest);
  return dir;
};

describe('a manifest that is not valid JSON', () => {
  it('is reported by readEntryPoints without the parser message', async () => {
    expect.hasAssertions();
    const dir = packageAt(MALFORMED);

    const result = await readEntryPoints(dir, '@acme/a');

    expect(result.status).toBe('unverifiable');
    expect(result.reason).toBe('manifest could not be read or interpreted');
  });

  it('is reported by probePackageIdentity without the parser message', async () => {
    expect.hasAssertions();
    const dir = packageAt(MALFORMED);

    const result = await probePackageIdentity(dir, '.', '@acme/a');

    // The whole result, not just the absence of the token: asserting only what is missing would
    // hold for `absent`, `match` and `mismatch` too, none of which is the right answer here.
    expect(result).toStrictEqual({
      kind: 'unreadable',
      reason: 'manifest could not be read or interpreted',
    });
  });

  it('says the same for a manifest that parses but is not an object', async () => {
    expect.hasAssertions();
    // `JSON.parse('null')` succeeds and the first property access then throws, so the reason has
    // to be worded for everything the catch covers rather than for a syntax error alone.
    const dir = packageAt('null');

    const result = await readEntryPoints(dir, '@acme/a');

    expect(result.reason).toBe('manifest could not be read or interpreted');
  });

  it('still reports an errno, which is refs own fact rather than a parser message', async () => {
    expect.hasAssertions();
    // The `code` branch is untouched: only the fallback changed. A directory where the manifest
    // should be is the cheapest way to reach it — `readFile` answers EISDIR.
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    const dir = mkdtempSync(join(tmpdir(), 'refs-manifest-'));
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    mkdirSync(join(dir, 'package.json'));

    const result = await readEntryPoints(dir, '@acme/a');

    expect(result.reason).toBe('EISDIR');
  });
});
