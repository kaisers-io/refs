import { dirname, join } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// Content filters off in every refs checkout, for every git command run there.
//
// A filter driver (`filter.<name>.smudge`/`clean`/`process`) is a command from the user's git
// configuration; a checkout's own `.gitattributes` decides which files go through it, and git runs
// it on checkout, reset and the index refresh `status` does. git-lfs installs one; a user can also
// name `./tools/smudge.sh`, which resolves inside the checkout. refs never runs code from or for a
// checkout, so it unsets the attribute for every path in `$GIT_DIR/info/attributes`, the
// attributes file git ranks above everything a tree carries (gitattributes(5)). `-filter` (unset)
// means "no filter", so a `required` driver is not consulted either. Tested on git 2.30, 2.39,
// 2.47, 2.53 and 2.55. A one-off `-c` cannot do this: switching a driver off by configuration
// needs its name, and names can come from `includeIf` sections evaluated inside the checkout.
//
// What a reader sees: files exactly as committed. For git-lfs that is the pointer file, not the
// object; `git lfs pull` in the checkout fetches the content when an agent really needs it.
//
// The file stays in place after refs is done, so an agent's own `git status` in the checkout agrees
// with what refs checked out instead of reporting every filtered file as modified.

const GUARD_LINE = '* -filter';
const GUARD_BLOCK =
  '# refs: content filters stay off in this checkout; refs never runs filter commands.\n' +
  `${GUARD_LINE}\n`;

const LAST = -1;

const attributesFile = (gitDir: string): string => join(gitDir, 'info', 'attributes');

/** Whether the guard is the last effective line, so no later line can re-enable a filter. */
const endsWithGuard = (content: string): boolean => {
  const lines = content.split(/\r?\n/u).map((line) => line.trim());
  const effective = lines.filter((line) => line !== '' && !line.startsWith('#'));
  return effective.at(LAST) === GUARD_LINE;
};

const readAttributes = async (file: string): Promise<string> => {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
};

/** Whether the checkout at `dest` already has filters switched off. */
const hasFilterGuard = async (dest: string): Promise<boolean> => {
  const content = await readAttributes(attributesFile(join(dest, '.git')));
  return endsWithGuard(content);
};

/** Appends the guard to `dest`'s `info/attributes` unless it already ends with it. Existing lines
 * are kept: a later line wins in an attributes file, so appending is enough. */
const ensureFilterGuard = async (dest: string): Promise<void> => {
  const file = attributesFile(join(dest, '.git'));
  const content = await readAttributes(file);
  if (endsWithGuard(content)) {
    return;
  }
  const separator = content === '' || content.endsWith('\n') ? '' : '\n';
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${content}${separator}${GUARD_BLOCK}`);
};

/** Runs `fn` with a private clone template that carries only the guard. `git clone --template`
 * copies it into the new `.git` BEFORE the initial checkout, the one checkout a guard written
 * afterwards would miss. It also replaces `init.templateDir`, so no template hooks are copied. */
const withCloneTemplate = async <Result>(
  run: (templateDir: string) => Promise<Result>,
): Promise<Result> => {
  const templateDir = await mkdtemp(join(tmpdir(), 'refs-clone-template-'));
  try {
    await mkdir(join(templateDir, 'info'));
    await writeFile(attributesFile(templateDir), GUARD_BLOCK);
    return await run(templateDir);
  } finally {
    await rm(templateDir, { force: true, recursive: true });
  }
};

export { GUARD_LINE, ensureFilterGuard, hasFilterGuard, withCloneTemplate };
