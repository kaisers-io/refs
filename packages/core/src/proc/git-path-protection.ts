import { lstat, realpath } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { configFailure } from './git-config-records.ts';
import { dirname } from 'node:path';

const existingLink = async (path: string): Promise<Stats | undefined> => {
  try {
    return await lstat(path);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw configFailure();
    }
    return undefined;
  }
};

const nearestExisting = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw configFailure();
    }
    const entry = await existingLink(path);
    if (entry?.isSymbolicLink() === true || dirname(path) === path) {
      throw configFailure();
    }
    return nearestExisting(dirname(path));
  }
};

// macOS case/Unicode aliases and Windows future 8.3 names cannot be modeled by string folding.
// A missing protected name cannot be canonicalized yet. Conservatively protect its nearest
// existing ancestor against missing configuration/helper paths, including spelling aliases.
const missingProtectionRoots = (
  roots: readonly string[],
  platform: NodeJS.Platform = process.platform,
): Promise<readonly string[]> =>
  platform === 'darwin' || platform === 'win32'
    ? Promise.all(roots.map((root) => nearestExisting(root)))
    : Promise.resolve(roots);

export { missingProtectionRoots };
