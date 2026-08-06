import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveHome } from '../../src/home.ts';
import { tmpdir } from 'node:os';

// Shared by `lock.test.ts` and `lock-stress.test.ts`. The stress suite lives in its own file
// because it is the only lock test measured in seconds rather than milliseconds, and because it
// needs platform-dependent timeouts the unit suites do not.

type Home = ReturnType<typeof resolveHome>;

// Above macOS/Linux default pid_max, so it can never name a live process.
const DEAD_PID = 999_999;

const makeHome = (): Home => {
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  const dir = mkdtempSync(join(tmpdir(), 'refs-lock-'));
  return resolveHome({ REFS_HOME: dir });
};

const writeLockDir = (locksDir: string, name: string, meta: object): string => {
  const lockPath = join(locksDir, name);
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  mkdirSync(lockPath, { recursive: true });
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(join(lockPath, 'meta.json'), JSON.stringify(meta));
  return lockPath;
};

export { DEAD_PID, makeHome, writeLockDir };
export type { Home };
