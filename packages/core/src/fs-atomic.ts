import { DIR_MODE, FILE_MODE } from './fs-modes.ts';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Shared low-level fs helpers used by both `config-io.ts` and `state-io.ts` — kept in one place so
// the atomic-write contract (see below) and the ENOENT check can't drift between the two callers.

const isEnoent = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code: unknown }).code === 'ENOENT';

// Writes via a same-directory tmp file + rename so a reader never observes a partial write and a
// crash mid-write never leaves the target file truncated/corrupt. The tmp name embeds a random id
// (not just pid) so concurrent writers in the same process can't collide on the same tmp path.
const writeFileAtomic = async (path: string, contents: string, mode = FILE_MODE): Promise<void> => {
  await mkdir(dirname(path), { mode: DIR_MODE, recursive: true });
  const tmpPath = `${path}.tmp-${randomUUID()}`;
  // The mode goes on the TMP file, before the rename that publishes it. A caller wanting something
  // other than `FILE_MODE` passes it here rather than chmod'ing afterwards: the point of the
  // rename is that no reader sees an intermediate state, and a chmod after it reintroduces exactly
  // that — a window in which the published file has the wrong mode. `installHooksGuard` is the
  // case that makes it concrete: a guard hook briefly not executable is a guard briefly absent.
  await writeFile(tmpPath, contents, { encoding: 'utf8', mode });
  await rename(tmpPath, path);
};

export { isEnoent, writeFileAtomic };
