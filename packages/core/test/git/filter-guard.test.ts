import { GUARD_LINE, ensureFilterGuard, hasFilterGuard } from '../../src/git/filter-guard.ts';
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const checkoutWith = async (attributes?: string): Promise<string> => {
  const dest = await mkdtemp(join(tmpdir(), 'refs-filter-guard-'));
  await mkdir(join(dest, '.git', 'info'), { recursive: true });
  if (attributes !== undefined) {
    await writeFile(join(dest, '.git', 'info', 'attributes'), attributes);
  }
  return dest;
};

const attributesOf = (dest: string): Promise<string> =>
  readFile(join(dest, '.git', 'info', 'attributes'), 'utf8');

describe('the content-filter guard in a checkout', () => {
  it('is written when the attributes file does not exist', async () => {
    expect.hasAssertions();
    const dest = await checkoutWith();
    await expect(hasFilterGuard(dest)).resolves.toBe(false);

    await ensureFilterGuard(dest);

    await expect(hasFilterGuard(dest)).resolves.toBe(true);
    await expect(attributesOf(dest)).resolves.toMatch(/\n\* -filter\n$/u);
  });

  it('keeps existing lines and is appended after them, where it wins', async () => {
    expect.hasAssertions();
    const dest = await checkoutWith('*.bin binary');

    await ensureFilterGuard(dest);

    const text = await attributesOf(dest);
    expect(text.startsWith('*.bin binary\n#')).toBe(true);
    expect(text.trimEnd().endsWith(GUARD_LINE)).toBe(true);
  });
});

describe('the content-filter guard, written again', () => {
  it('is not written twice', async () => {
    expect.hasAssertions();
    const dest = await checkoutWith();
    await ensureFilterGuard(dest);
    const once = await attributesOf(dest);

    await ensureFilterGuard(dest);

    await expect(attributesOf(dest)).resolves.toBe(once);
  });

  it('is appended again when a later line could re-enable a filter', async () => {
    expect.hasAssertions();
    const dest = await checkoutWith(`${GUARD_LINE}\n*.txt filter=lfs\n`);
    await expect(hasFilterGuard(dest)).resolves.toBe(false);

    await ensureFilterGuard(dest);

    await expect(hasFilterGuard(dest)).resolves.toBe(true);
  });

  it('creates the info directory when git did not', async () => {
    expect.hasAssertions();
    const dest = await mkdtemp(join(tmpdir(), 'refs-filter-guard-'));
    await mkdir(join(dest, '.git'));

    await ensureFilterGuard(dest);

    await expect(hasFilterGuard(dest)).resolves.toBe(true);
  });
});
