import { afterAll, beforeAll } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveHome } from '../../src/home.ts';
import { tmpdir } from 'node:os';

// Real policy invocations need an owned, existing sources root. Fictional filesystem-root
// markers protect an excessively broad ancestor on filesystems with future name aliases.
const createManagedHome = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-home-'));
  return resolveHome({ REFS_HOME: dir });
};

const managedHooksFixture = (): { hooksDir: string } => {
  const fixture = { hooksDir: '' };
  let root: string | undefined = undefined;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'refs-managed-hooks-'));
    fixture.hooksDir = join(root, 'hooks');
    await Promise.all([mkdir(fixture.hooksDir), mkdir(join(root, 'sources'))]);
  });
  afterAll(async () => {
    if (root !== undefined) {
      await rm(root, { force: true, recursive: true });
    }
  });
  return fixture;
};

export { createManagedHome, managedHooksFixture };
