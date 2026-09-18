import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The temp file the atomic write creates, and what happens when something is already at that path.
//
// The default flags are `O_CREAT|O_TRUNC` and they follow symlinks, so a symlink planted at the
// temp path would be written THROUGH — truncating whatever it pointed at — and an ordinary file
// there would be silently overwritten. The `randomUUID` in the name makes planting one
// impractical, which is why this is defence in depth rather than a reachable hole. It is still
// testable: pin the UUID, create the path first, and drive the real filesystem.

const FIXED_UUID = '00000000-0000-4000-8000-000000000000';

vi.mock(import('node:crypto'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, randomUUID: () => FIXED_UUID as ReturnType<typeof actual.randomUUID> };
});

const { writeFileAtomic } = await import('../src/fs-atomic.ts');

const freshDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'refs-atomic-'));

const tmpPathFor = (path: string): string => `${path}.tmp-${FIXED_UUID}`;

describe('the temp file an atomic write creates', () => {
  it('refuses a path something else already occupies', async () => {
    expect.hasAssertions();
    const dir = await freshDir();
    const target = join(dir, 'config.toml');
    await writeFile(tmpPathFor(target), 'someone else was here', 'utf8');

    await expect(writeFileAtomic(target, 'refs content')).rejects.toThrow(/EEXIST/u);

    // Not overwritten, and the real target never appeared.
    await expect(readFile(tmpPathFor(target), 'utf8')).resolves.toBe('someone else was here');
  });

  it('refuses to write through a symlink planted at that path', async () => {
    expect.hasAssertions();
    const dir = await freshDir();
    const target = join(dir, 'config.toml');
    const elsewhere = join(dir, 'elsewhere.txt');
    await writeFile(elsewhere, 'not refs business', 'utf8');
    await symlink(elsewhere, tmpPathFor(target));

    await expect(writeFileAtomic(target, 'refs content')).rejects.toThrow(/EEXIST|ELOOP/u);

    // The point: the file the link pointed at is untouched, rather than truncated and rewritten.
    await expect(readFile(elsewhere, 'utf8')).resolves.toBe('not refs business');
  });

  it('writes normally when the path is free', async () => {
    expect.hasAssertions();
    const dir = await freshDir();
    const target = join(dir, 'config.toml');

    await writeFileAtomic(target, 'refs content');

    await expect(readFile(target, 'utf8')).resolves.toBe('refs content');
  });
});
