import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Shared fixture builders for `workspaces.test.ts` and `workspaces-containment.test.ts`:
// both suites exercise `detectWorkspacePackages` against real temp-dir repos rather than a
// mocked filesystem, so the setup helpers below are plain sync `node:fs` calls.

// eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
const freshRepo = (): string => mkdtempSync(join(tmpdir(), 'refs-workspace-'));

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

export { addPackage, freshRepo, writeJson };
