import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { SCHEMA_VERSION } from '../src/schemas/config.ts';
import { join } from 'node:path';
import { resolveHome } from '../src/home.ts';
import { tmpdir } from 'node:os';
import { writeConfig } from '../src/config-io.ts';

// `writeConfig` parses what it serialized before writing it, because `meta` is a `looseObject` and
// so the schema alone cannot promise the text is readable. No real input is known to reach that
// refusal: smol-toml up to 1.8 serialized a lone surrogate it could not parse back, 1.9 replaces it
// with U+FFFD. The serializer is mocked so the refusal stays proved against a future divergence.

vi.mock(import('smol-toml'), async (importOriginal) => ({
  ...(await importOriginal()),
  stringify: () => 'not valid toml',
}));

describe('the write boundary proves the document can be read back', () => {
  it('refuses to write a config the parser would then reject', async () => {
    expect.hasAssertions();
    // eslint-disable-next-line node/no-sync, unicorn/max-nested-calls -- test fixture setup, sync is fine
    const home = resolveHome({ REFS_HOME: mkdtempSync(join(tmpdir(), 'refs-cfg-')) });
    const raw: unknown = {
      meta: { cli_version: '0.1.0', schema_version: SCHEMA_VERSION },
      refs: {},
      settings: { clone_mode: 'blobless', git_transport: 'https', sync_ttl: '1h' },
    };
    const config = raw as Parameters<typeof writeConfig>[1];
    await expect(writeConfig(home, config)).rejects.toThrow(/could not be read back/u);
    // eslint-disable-next-line node/no-sync -- the point is that nothing was written at all
    expect(existsSync(home.configPath)).toBe(false);
  });
});
