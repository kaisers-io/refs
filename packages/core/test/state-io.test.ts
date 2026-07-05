import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { readState, writeState } from '../src/state-io.ts';
import { join } from 'node:path';
import { resolveHome } from '../src/home.ts';
import { tmpdir } from 'node:os';

const SHA_LENGTH = 40;

// eslint-disable-next-line node/no-sync, unicorn/max-nested-calls -- test fixture setup, sync is fine
const freshHome = () => resolveHome({ REFS_HOME: mkdtempSync(join(tmpdir(), 'refs-state-')) });

describe('reading state', () => {
  it('missing file → empty refs', async () => {
    expect.hasAssertions();
    const state = await readState(freshHome());
    expect(state).toStrictEqual({ refs: {} });
  });

  it('corrupt JSON → empty refs (self-healing, never throws)', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(home.statePath, '{ not json ');
    const state = await readState(home);
    expect(state).toStrictEqual({ refs: {} });
  });

  it('schema-invalid JSON → empty refs (self-healing, never throws)', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(home.statePath, JSON.stringify({ refs: { 'a/b': { head_sha: 'nope' } } }));
    const state = await readState(home);
    expect(state).toStrictEqual({ refs: {} });
  });

  it('dangerous key in state → empty refs (self-healing)', async () => {
    expect.hasAssertions();
    const home = freshHome();
    // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
    writeFileSync(home.statePath, '{"refs":{"__proto__":{}}}');
    const state = await readState(home);
    expect(state).toStrictEqual({ refs: {} });
  });
});

describe('writeState + readState round trip', () => {
  it('writes and reads back valid state', async () => {
    expect.hasAssertions();
    const home = freshHome();
    const state = {
      refs: {
        'github.com/a/b': {
          head_sha: 'a'.repeat(SHA_LENGTH),
          last_fetched_at: new Date().toISOString(),
        },
      },
    };
    await writeState(home, state);
    const roundTripped = await readState(home);
    expect(roundTripped).toStrictEqual(state);
  });
});

describe('atomic write', () => {
  it('leaves no tmp files behind', async () => {
    expect.hasAssertions();
    const home = freshHome();
    await writeState(home, { refs: {} });
    // eslint-disable-next-line node/no-sync -- assertion reads dir written by the impl under test
    expect(readdirSync(home.root).filter((entry) => entry.includes('.tmp'))).toStrictEqual([]);
  });
});
