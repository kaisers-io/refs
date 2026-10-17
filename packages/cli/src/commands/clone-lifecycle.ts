import type { RefsHome, Runner } from '@kaisers-io/refs-core';
import {
  assertInsideSources,
  conflictError,
  isEnoent,
  validationError,
} from '@kaisers-io/refs-core';
import { basename, dirname, join } from 'node:path';
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rmCommand } from '../shell-quote.ts';

const incompleteMarker = (dest: string): string =>
  join(
    dirname(dest),
    `.refs-clone-${createHash('sha256').update(basename(dest)).digest('hex')}.incomplete`,
  );

// Outside the destination because `git clone` requires an empty directory. A hard interrupt
// cannot run finally blocks; leaving this marker makes the next invocation fail closed even
// when the partial clone already carries .git and core.hooksPath.
const hasIncompleteClone = (dest: string): boolean =>
  // eslint-disable-next-line node/no-sync -- small existence guard before any checkout adoption
  existsSync(incompleteMarker(dest));

const assertCloneComplete = (dest: string): void => {
  if (hasIncompleteClone(dest)) {
    throw conflictError(
      `interrupted clone at ${dest}; stop any remaining Git/helper processes, then remove the directory and its incomplete ` +
        `marker before retrying (${rmCommand(dest) ?? 'remove the directory by hand'}; ${rmCommand(incompleteMarker(dest)) ?? 'remove the marker by hand'})`,
    );
  }
};

const removeOwnedClone = async (home: RefsHome, dest: string, owned: Stats): Promise<void> => {
  assertInsideSources(home, dest);
  const current = await lstat(dest).catch((error: unknown) => {
    if (!isEnoent(error)) {
      throw error;
    }
  });
  if (current?.dev === owned.dev && current.ino === owned.ino && !current.isSymbolicLink()) {
    await rm(dest, { force: true, recursive: true });
  } else if (current !== undefined) {
    throw conflictError(`clone destination changed at ${dest}; incomplete marker retained`);
  }
};

const reserveDestination = async (dest: string): Promise<Stats> => {
  try {
    await mkdir(dest);
  } catch (error) {
    throw conflictError(
      `cannot create a fresh clone at ${dest}; existing paths are never ` +
        `removed automatically: ${String(error)}`,
    );
  }
  return lstat(dest);
};

const assertSafeTermination = (runner: Runner | undefined): void => {
  if (runner?.terminationFailed === true) {
    throw validationError(
      'subprocess termination unconfirmed; checkout quarantined until its helpers are stopped',
    );
  }
};

// Keep quarantine inside the per-ref lock, including a failed fetch of an existing checkout.
// A later process must not start another writer or hand this checkout out as verified source.
const withCheckoutProtection = async <Result>(
  runner: Runner,
  opts: { home: RefsHome; dest: string },
  operation: () => Promise<Result>,
): Promise<Result> => {
  assertSafeTermination(runner);
  assertCloneComplete(opts.dest);
  try {
    const result = await operation();
    assertSafeTermination(runner);
    return result;
  } finally {
    if (runner.terminationFailed === true) {
      assertInsideSources(opts.home, opts.dest);
      await writeFile(incompleteMarker(opts.dest), 'subprocess termination unconfirmed\n');
    }
  }
};

const completeClone = async <Result>(
  opts: { dest: string; runner?: Runner },
  result: Result,
): Promise<Result> => {
  assertSafeTermination(opts.runner);
  await rm(incompleteMarker(opts.dest));
  return result;
};

// Called only under the per-ref lock, after the normal containment check. Exclusive mkdir
// establishes ownership: a failed clone must never delete an existing directory or checkout.
const withFreshClone = async <Result>(
  opts: { home: RefsHome; dest: string; runner?: Runner },
  clone: () => Promise<Result>,
): Promise<Result> => {
  assertSafeTermination(opts.runner);
  const owned = await reserveDestination(opts.dest);
  await writeFile(incompleteMarker(opts.dest), '', { flag: 'wx' }).catch(async (error: unknown) => {
    await removeOwnedClone(opts.home, opts.dest, owned);
    throw error;
  });
  try {
    return await completeClone(opts, await clone());
  } catch (error) {
    if (opts.runner?.terminationFailed !== true) {
      await removeOwnedClone(opts.home, opts.dest, owned);
      await rm(incompleteMarker(opts.dest), { force: true });
    }
    throw error;
  }
};

export {
  assertCloneComplete,
  hasIncompleteClone,
  incompleteMarker,
  withCheckoutProtection,
  withFreshClone,
};
