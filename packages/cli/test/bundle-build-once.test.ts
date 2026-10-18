import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// `vitest.global-setup.ts` builds `dist/refs.mjs` once, before any test file starts. A test file
// that builds it again runs in parallel with files that are already executing the bundle, and
// tsdown rewrites it in place: a reader can load an empty module (`realContext is not a function`,
// seen in CI). So the build happens in exactly one place.

const TEST_DIR = import.meta.dirname;
const BUILD_CALL = /['"]@kaisers-io\/refs['"],\s*['"]build['"]/u;

const testSources = async (): Promise<string[]> => {
  const entries = await readdir(TEST_DIR, { recursive: true });
  return entries.filter((entry) => entry.endsWith('.ts')).map((entry) => join(TEST_DIR, entry));
};

describe('the CLI bundle', () => {
  it('is built by the global setup, never by a test file', async () => {
    expect.hasAssertions();
    const files = await testSources();
    const sources = await Promise.all(
      files.map(async (file) => ({ file, text: await readFile(file, 'utf8') })),
    );
    const builders = sources.filter(({ text }) => BUILD_CALL.test(text)).map(({ file }) => file);
    expect(builders).toStrictEqual([]);
    const setup = await readFile(join(TEST_DIR, '../../../vitest.global-setup.ts'), 'utf8');
    expect(setup).toMatch(BUILD_CALL);
  });
});
