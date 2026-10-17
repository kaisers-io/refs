import { describe, expect, it } from 'vitest';
import { readFixture, withFixture } from './git-config-graph-fixture.ts';
import { realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FAILURE = 'Git configuration cannot be safely inventoried';
const DEEP_INCLUDE_COUNT = 11;
const EXCESS_FILE_COUNT = 65;
const EXCESS_ENTRY_COUNT = 4097;

describe('configuration traversal bounds', () => {
  it('rejects include chains past Git maximum depth even when inactive', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      await writeFile(fixture.config, '[includeIf "onbranch:inactive"]\npath=0\n');
      await Promise.all(
        Array.from({ length: DEEP_INCLUDE_COUNT }, (_unused, index) =>
          writeFile(join(fixture.home, String(index)), `[include]\npath=${String(index + 1)}\n`),
        ),
      );
      await writeFile(join(fixture.home, String(DEEP_INCLUDE_COUNT)), '[user]\nname=synthetic\n');
      await expect(readFixture(fixture)).rejects.toThrow(FAILURE);
    });
  });

  it('rejects too many distinct included files', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      await writeFile(
        fixture.config,
        Array.from(
          { length: EXCESS_FILE_COUNT },
          (_unused, index) => `[include]\npath=${String(index)}\n`,
        ).join(''),
      );
      await Promise.all(
        Array.from({ length: EXCESS_FILE_COUNT }, (_unused, index) =>
          writeFile(join(fixture.home, String(index)), '[user]\nname=synthetic\n'),
        ),
      );
      await expect(readFixture(fixture)).rejects.toThrow(FAILURE);
    });
  });

  it('rejects too many config records rather than silently truncating its inventory', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      await writeFile(fixture.config, `[user]\n${'name=synthetic\n'.repeat(EXCESS_ENTRY_COUNT)}`);
      await expect(readFixture(fixture)).rejects.toThrow(FAILURE);
    });
  });
});

describe('missing include traversal bounds', () => {
  it('counts absent external include paths toward the file limit', async () => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const home = await realpath(fixture.home);
      const entries = Array.from(
        { length: EXCESS_FILE_COUNT },
        (_unused, index) => `[include]\npath=${JSON.stringify(join(home, String(index)))}\n`,
      );
      await writeFile(fixture.config, entries.join(''));
      await expect(readFixture(fixture)).rejects.toThrow(FAILURE);
    });
  });
});
