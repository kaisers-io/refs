import { mkdir, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// `O_NOFOLLOW` is POSIX; Windows has no equivalent constant and Node leaves it undefined there.
// `|` would coerce that to 0 anyway — the explicit fallback is here to say so, not to avoid a
// numeric accident. Windows has no symlink-following flag to ask for; `O_CREAT | O_EXCL` maps to
// `CREATE_NEW`, which still refuses an existing name.
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

// Shared low-level fs helpers used by both `config-io.ts` and `state-io.ts` — kept in one place so
// the atomic-write contract (see below) and the ENOENT check can't drift between the two callers.

/** The `errno` string an fs or child-process failure carries, or `undefined` when it carries none.
 * The one place that shape is decoded — a caller asking `error.message.startsWith(...)` instead is
 * sniffing refs' own wording, and cannot tell an EACCES from an ENOENT at all. */
const errnoCode = (err: unknown): string | undefined => {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const { code } = err as { code: unknown };
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
};

const isEnoent = (err: unknown): boolean => errnoCode(err) === 'ENOENT';

// `wx` plus no-follow: create exclusively, and refuse a symlink. The default flags
// (`O_CREAT|O_TRUNC`, following links) would happily write THROUGH a symlink planted at the tmp
// path, and truncate whatever was already there. The `randomUUID` in the name makes planting one
// impractical, so this is defence in depth rather than a reachable hole — but it costs nothing and
// removes the argument. A collision now fails loudly instead of silently overwriting.
const TMP_FILE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW;

// Writes via a same-directory tmp file + rename so a reader never observes a partial write and a
// crash mid-write never leaves the target file truncated/corrupt. The tmp name embeds a random id
// (not just pid) so concurrent writers in the same process can't collide on the same tmp path.
const writeFileAtomic = async (path: string, contents: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, contents, { encoding: 'utf8', flag: TMP_FILE_FLAGS });
  await rename(tmpPath, path);
};

export { errnoCode, isEnoent, writeFileAtomic };
