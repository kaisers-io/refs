import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveHome } from '../../src/home.ts';
import { tmpdir } from 'node:os';

// Shared by `lock.test.ts` and `lock-stress.test.ts`. The stress suite lives in its own file
// because it is the only lock test measured in seconds rather than milliseconds, and because it
// needs platform-dependent timeouts the unit suites do not.

type Home = ReturnType<typeof resolveHome>;

// Above macOS/Linux default pid_max, so it can never name a live process.
const DEAD_PID = 999_999;

// A token in the exact `randomUUID()` shape the implementation validates before building a sidecar
// filename from it. Two of them, so a fixture can prove a sidecar belonging to one acquisition is
// ignored when the lock's meta names another.
const TOKEN_A = '11111111-2222-4333-8444-555555555555';
const TOKEN_B = '99999999-8888-4777-8666-555555555555';

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

/** Writes the lease sidecar for `token`'s acquisition and backdates its mtime by `ageMs`. The
 * mtime IS the lease timestamp, so this is how a fixture expresses "this holder last renewed N ms
 * ago" without any waiting. */
const writeLeaseSidecar = (lockPath: string, token: string, ageMs: number): void => {
  const path = join(lockPath, `lease-${token}`);
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  writeFileSync(path, '');
  const stamped = new Date(Date.now() - ageMs);
  // eslint-disable-next-line node/no-sync -- test fixture setup, sync is fine
  utimesSync(path, stamped, stamped);
};

export { DEAD_PID, TOKEN_A, TOKEN_B, makeHome, writeLeaseSidecar, writeLockDir };
export type { Home };
