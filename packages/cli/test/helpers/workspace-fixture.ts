import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Fixture builders for the CLI's checkout-shaped tests. Deliberately a sibling copy of core's
// `test/helpers/workspace-fixture.ts` rather than a cross-package import: `vitest.config.ts`
// declares `projects: ['packages/*']`, so each package's suite resolves within its own project.

// eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
const freshRepo = (): string => mkdtempSync(join(tmpdir(), 'refs-cli-workspace-'));

const writeJson = (path: string, data: unknown): void => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(path, JSON.stringify(data));
};

// Creates `rel` under `repo` and writes its package.json manifest.
const addPackage = (repo: string, rel: string, manifest: Record<string, unknown>): void => {
  const dir = join(repo, ...rel.split('/'));
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'package.json'), manifest);
};

/** Makes `repo` look like a managed checkout. `isGitCheckout` is a plain
 * `existsSync(join(dir, '.git'))` (`core/src/git/managed-checkout.ts`), so a bare directory is
 * enough — no real git repo needed. Mirrors `ref-fixtures.ts#markCheckoutPresent`. */
const asCheckout = (repo: string): string => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(join(repo, '.git'), { recursive: true });
  return repo;
};

export { addPackage, asCheckout, freshRepo, writeJson };
