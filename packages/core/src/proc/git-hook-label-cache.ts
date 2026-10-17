// The configured-hook label inventory (`git-hook-labels.ts`), kept between git commands. Taking it
// costs one `git config` for the listing and two per configuration file, around EVERY git command
// refs starts: measured on 2.55.0, a test that runs one `git check-ref-format` per candidate went
// from 11s to 55s, and macOS CI ran past its 60s timeout. One `SpawnRunner` serves a whole refs
// process, so the inventory is taken once and reused while nothing it read has changed.
//
// What it reads is fixed by three inputs, and an entry is reused only when all three still match:
//
// - The working directory and the environment, which select the files git reads directly (the
//   repository's own `.git/config`, `GIT_CONFIG_GLOBAL`, `HOME`, `GIT_CONFIG_PARAMETERS`, ...).
//   Both are the entry's key.
// - The CONTENT of every path the inventory looked at — each file git reads directly and each
//   include, the ones it found missing as well — read through the path as named, so a rewritten
//   file, a retargeted symlink or a missing include that now exists each force a new inventory.
//   Content, not timestamps: a rewrite within one timestamp tick keeps the timestamp, and git's
//   own reading of a file depends on nothing else (a relative include resolves against the named
//   path, `~` and `%(prefix)` against the environment in the key). Each snapshot is taken BEFORE
//   git reads the file, so a change in between leaves a snapshot that no longer matches.
// - The checkout the command writes: an include inside it is refused, and that depends on the
//   command, not on the configuration. The entry keeps every include path and `git-hook-labels.ts`
//   checks them against each command's own checkout, so a cached inventory refuses what a fresh one
//   would.
//
// What reuse can miss is a configuration file git reads directly that did not exist, or held no
// entry, when the inventory was taken and gains one later in the same refs process — the listing
// names only files with entries. Nothing refs or a checkout writes is such a file: a clone creates
// its `.git/config` in a directory that has no entry yet (the destination did not exist, so no
// command ran there), and git writes no hook or include key into it. That leaves a user creating a
// global or system configuration file while refs runs, which is the same race as editing it a
// moment after git read it — as is a file edited and restored within the inventory itself.

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// What a path held: its content, `NOT_A_FILE` for something git cannot read as one (the command
// then fails on it, so no inventory is kept), `undefined` when it does not exist.
type Snapshot = string | undefined;
type Entry = {
  includes: readonly string[];
  labels: ReadonlySet<string>;
  snapshots: ReadonlyMap<string, Snapshot>;
};

const NOT_A_FILE = '\0not a regular file';

/** The path's snapshot. Anything but its absence that stops reading it throws. */
const snapshotOf = async (path: string): Promise<Snapshot> => {
  try {
    const found = await stat(path);
    return found.isFile() ? await readFile(path, 'latin1') : NOT_A_FILE;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};

const unchanged = async (snapshots: ReadonlyMap<string, Snapshot>): Promise<boolean> => {
  try {
    const now = await Promise.all([...snapshots.keys()].map((path) => snapshotOf(path)));
    return [...snapshots.values()].every((snapshot, index) => now[index] === snapshot);
  } catch {
    return false;
  }
};

/** The key an inventory is filed under: what selects the files git reads directly. */
const inventoryKey = (cwd: string | undefined, env: NodeJS.ProcessEnv): string =>
  JSON.stringify([
    resolve(cwd ?? '.'),
    Object.entries(env).toSorted(([left], [right]) => left.localeCompare(right)),
  ]);

class HookLabelCache {
  readonly #entries = new Map<string, Entry>();

  /** The inventory filed under `key`, when nothing it read has changed since. */
  async lookup(key: string): Promise<Omit<Entry, 'snapshots'> | undefined> {
    const entry = this.#entries.get(key);
    if (entry === undefined || !(await unchanged(entry.snapshots))) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Files `entry`, unless it read something that is not a regular file — a FIFO or a device
   * git read through — whose content a later snapshot cannot vouch for. */
  store(key: string, entry: Entry): void {
    if (![...entry.snapshots.values()].includes(NOT_A_FILE)) {
      this.#entries.set(key, entry);
    }
  }
}

export { HookLabelCache, inventoryKey, snapshotOf };
export type { Snapshot };
