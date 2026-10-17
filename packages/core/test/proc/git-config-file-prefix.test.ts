import { describe, expect, it, vi } from 'vitest';
import { readFixture, withFixture } from './git-config-graph-fixture.ts';
import { symlink, writeFile } from 'node:fs/promises';
import type { Fixture } from './git-config-graph-fixture.ts';
import { join } from 'node:path';

const windowsMissing = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOTDIR') {
      throw Object.assign(new Error('fixture Windows missing path'), { code: 'ENOENT' });
    }
    throw error;
  }
};

// libuv on Windows maps ERROR_DIRECTORY to ENOENT. Preserve real filesystem operations but
// reproduce that error shape so this regression does not depend on the host's errno mapping.
vi.mock(import('node:fs/promises'), async (original) => {
  const actual = await original();
  return {
    ...actual,
    lstat: ((...args: Parameters<typeof actual.lstat>) =>
      windowsMissing(() => actual.lstat(...args))) as typeof actual.lstat,
    realpath: ((...args: Parameters<typeof actual.realpath>) =>
      windowsMissing(() => actual.realpath(...args))) as typeof actual.realpath,
  };
});

const fileSource = async (fixture: Fixture, kind: string, content: string): Promise<string> => {
  const file = join(fixture.home, 'file');
  await writeFile(file, content);
  if (kind === 'regular') {
    return file;
  }
  const alias = join(fixture.home, 'alias');
  await symlink(file, alias);
  return alias;
};

describe('non-directory configuration prefixes', () => {
  it.each(['regular', 'symlink'])('refuses a %s file ancestor even on ENOENT', async (kind) => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const prefix = await fileSource(fixture, kind, 'fixture');
      await writeFile(
        fixture.config,
        `[include]\npath=${JSON.stringify(join(prefix, 'config'))}\n`,
      );
      await expect(readFixture(fixture)).rejects.toThrow(
        'Git configuration cannot be safely inventoried',
      );
    });
  });

  it.each(['regular', 'symlink'])('allows a %s file as the terminal include', async (kind) => {
    expect.hasAssertions();
    await withFixture(async (fixture) => {
      const source = await fileSource(fixture, kind, '[user]\nname=fixture\n');
      await writeFile(fixture.config, `[include]\npath=${JSON.stringify(source)}\n`);
      await expect(readFixture(fixture)).resolves.toContainEqual(
        expect.objectContaining({ key: 'user.name', value: 'fixture' }),
      );
    });
  });
});
