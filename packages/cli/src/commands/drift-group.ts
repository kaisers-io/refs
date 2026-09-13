// Where a set of discovery candidates belongs, as a path question and nothing else.
//
// Split from `drift-lines.ts` for the 300-line cap, and it splits cleanly: none of this knows what
// a line looks like, and the renderer does not know how a directory is chosen.

/** How many candidates a directory has to hold before it is reported as a group rather than one by
 * one. Below it, the individual lines are the more useful answer; above it they are a wall. */
const GROUP_AT = 3;

const NOT_FOUND = -1;
const CURRENT_DIR = '.';

const dirOf = (path: string | undefined): string => {
  const at = (path ?? '').lastIndexOf('/');
  return at === NOT_FOUND ? CURRENT_DIR : (path ?? '').slice(0, at);
};

/** The directory to name a group of candidates by: the deepest one they all sit under.
 *
 * Rolled up rather than taken as-is, because a repository that puts one fixture per directory has
 * as many directories as candidates — astro has 256 under `packages/astro/test/fixtures`, each in
 * its own — and naming each of them is the wall the grouping exists to avoid. Descending only
 * while every candidate stays under ONE child stops at the directory where the tree actually
 * branches, which is the one a reader recognises. */
const commonDir = (dirs: readonly string[]): string => {
  const [first = CURRENT_DIR, ...rest] = dirs;
  const segments = first.split('/');
  let depth = segments.length;
  for (const dir of rest) {
    const other = dir.split('/');
    let shared = 0;
    while (shared < depth && shared < other.length && segments[shared] === other[shared]) {
      shared += 1;
    }
    depth = shared;
  }
  return depth === 0 ? CURRENT_DIR : segments.slice(0, depth).join('/');
};

export { CURRENT_DIR, GROUP_AT, commonDir, dirOf };
