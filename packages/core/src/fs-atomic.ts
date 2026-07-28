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
const writeFileAtomic = async (path: string, contents: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, contents, 'utf8');
  await rename(tmpPath, path);
};

export { isEnoent, writeFileAtomic };
