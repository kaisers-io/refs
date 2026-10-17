// Configured-hook labels for git 2.54, the one release that has configured hooks but no
// event-level switch for them (`git-exec-policy.ts`). There a hook can be disabled only by its
// label, `hook.<label>.enabled=false`, so refs has to know every label before it starts git.
//
// A listing of the configuration in effect is not enough, and was measured not to be: an
// `includeIf "hasconfig:remote.*.url:…"` section is evaluated against the repository being
// cloned, so it is inactive in every listing taken before the clone, and its hook fired during
// `refs add` on 2.54.0. So the inventory ignores conditions and reads EVERY include, active or
// not: a label that never applies costs one inert `-c`, a label missed is a hook that runs.
//
// It fails closed — refs refuses to start the git command — wherever it cannot see the whole
// graph: an include it cannot read, a graph deeper or wider than git would follow, a relative
// include set outside a file, or a label `-c` cannot spell. It also refuses an include inside the
// checkout the command works on (the clone's destination, or the working directory refs set):
// that file is content the command itself may write, so what it holds when read is not what git
// reads later. A missing include anywhere else is skipped: nothing the command does creates it.

import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import type { RunResult } from './runner.ts';

type ReadGit = (args: readonly string[]) => Promise<RunResult>;
type LabelContext = { args: readonly string[]; cwd?: string };

// git itself stops at 10 levels of include; the file cap bounds a wide graph the same way.
const MAX_DEPTH = 10;
const MAX_FILES = 64;
const NOT_FOUND = -1;
const LAST = -1;
const SUCCESS_EXIT_CODE = 0;
const NO_MATCH_EXIT_CODE = 1;
const FIELDS_PER_ORIGIN_ENTRY = 2;

const HOOK_KEY = /^hook\.(?<label>.*)\.(?:command|event)$/u;
const INCLUDE_KEY = /^include(?:if\..*)?\.path$/u;
const INCLUDE_PATTERN = String.raw`^include(if\..*)?\.path$`;
const FILE_ORIGIN = 'file:';

class InventoryRefusalError extends Error {
  override name = 'InventoryRefusalError';
}

type Inventory = { files: Set<string>; labels: Set<string>; roots: readonly string[] };
type Visit = { depth: number; file: string; direct: boolean };

const refuse = (why: string): never => {
  throw new InventoryRefusalError(
    `refs did not start git: on git 2.54 refs disables configured hooks by label, and ${why}`,
  );
};

/** `<key>\n<value>` records, NUL-terminated: the key alone when git wrote no value. */
const keyAndValue = (record: string): { key: string; value: string } => {
  const at = record.indexOf('\n');
  return at === NOT_FOUND
    ? { key: record, value: '' }
    : { key: record.slice(0, at), value: record.slice(at + 1) };
};

const readOrRefuse = async (read: ReadGit, args: readonly string[]): Promise<string> => {
  const result = await read(args);
  // `--get-regexp` exits 1 when nothing matches; that is an answer, not a failure.
  const noMatch = result.exitCode === NO_MATCH_EXIT_CODE && result.stdout === '';
  if (result.exitCode !== SUCCESS_EXIT_CODE && !(noMatch && args.includes('--get-regexp'))) {
    refuse(`reading the configuration failed: ${result.stderr.trim()}`);
  }
  if (result.stdoutTruncated === true) {
    refuse('the configuration listing was cut short');
  }
  return result.stdout;
};

const records = (stdout: string): string[] => stdout.split('\0').filter(Boolean);

const addLabel = (inventory: Inventory, key: string): void => {
  const label = HOOK_KEY.exec(key)?.groups?.['label'];
  if (label === undefined) {
    return;
  }
  // `-c` splits at the FIRST '=', so a label holding one would disable a different key.
  if (label.includes('=')) {
    refuse(`the hook label ${JSON.stringify(label)} contains '=', which -c cannot express`);
  }
  inventory.labels.add(label);
};

const isInside = (path: string, root: string): boolean => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const canonical = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
};

const assertOutsideCheckout = async (path: string, inventory: Inventory): Promise<void> => {
  const real = await canonical(path);
  if (inventory.roots.some((root) => isInside(path, root) || isInside(real, root))) {
    refuse(`the include ${path} lies inside the checkout this command writes`);
  }
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    return refuse(`the include ${path} cannot be inspected`);
  }
};

/** The include paths one file names, as git expands them (`~/`, `%(prefix)/`), made absolute. */
const includesOf = async (read: ReadGit, file: string): Promise<string[]> => {
  const out = await readOrRefuse(read, [
    'config',
    '--file',
    file,
    '--no-includes',
    '--null',
    '--type=path',
    '--get-regexp',
    INCLUDE_PATTERN,
  ]);
  return records(out)
    .map((record) => keyAndValue(record).value)
    .map((path) => (isAbsolute(path) ? path : join(dirname(file), path)));
};

// The files git reads directly are exempt from the checkout test: the checkout's own `.git/config`
// is one of them, written by refs and out of a tracked file's reach.
/** Whether `at` is a file not yet read, after the bounds and the checkout test. */
const admit = async (inventory: Inventory, at: Visit): Promise<boolean> => {
  if (at.depth > MAX_DEPTH || inventory.files.size >= MAX_FILES) {
    refuse('the include graph is deeper or wider than refs follows');
  }
  if (!at.direct) {
    await assertOutsideCheckout(at.file, inventory);
  }
  const real = await canonical(at.file);
  if (inventory.files.has(real) || !(await exists(at.file))) {
    return false;
  }
  inventory.files.add(real);
  return true;
};

const visitFile = async (read: ReadGit, inventory: Inventory, at: Visit): Promise<void> => {
  if (!(await admit(inventory, at))) {
    return;
  }
  const listing = ['config', '--file', at.file, '--no-includes', '--null', '--list'];
  for (const record of records(await readOrRefuse(read, listing))) {
    addLabel(inventory, keyAndValue(record).key);
  }
  for (const file of await includesOf(read, at.file)) {
    // eslint-disable-next-line no-await-in-loop -- depth-first, so the depth bound holds
    await visitFile(read, inventory, { depth: at.depth + 1, direct: false, file });
  }
};

type Origin = { key: string; origin: string; value: string };

/** `git config --list --null --show-origin`: `<origin>\0<key>\n<value>\0` per entry. */
const parseOrigins = (stdout: string): Origin[] => {
  const fields = stdout.split('\0');
  const entries: Origin[] = [];
  for (let index = 0; index + 1 < fields.length; index += FIELDS_PER_ORIGIN_ENTRY) {
    /* v8 ignore next -- the loop guard proves both indices are in range */
    entries.push({ origin: fields[index] ?? '', ...keyAndValue(fields[index + 1] ?? '') });
  }
  return entries;
};

/** Includes set outside any file — `-c` or `GIT_CONFIG_PARAMETERS` — must be absolute: git
 * itself rejects a relative one there. Refusing is the same outcome, said before git starts. */
const nonFileIncludes = (entries: readonly Origin[]): string[] =>
  entries
    .filter((entry) => !entry.origin.startsWith(FILE_ORIGIN) && INCLUDE_KEY.test(entry.key))
    .map((entry) =>
      isAbsolute(entry.value)
        ? entry.value
        : refuse(`the include ${JSON.stringify(entry.value)} is relative but set outside a file`),
    );

// The working directory counts only when the caller set one — refs does, for every command on a
// checkout. The process's own directory may be the user's home, where their includes live.
const checkoutRoots = (ctx: LabelContext): string[] => {
  const dest = ctx.args[0] === 'clone' ? ctx.args.at(LAST) : undefined;
  const cwd = ctx.cwd === undefined ? [] : [resolve(ctx.cwd)];
  return [...cwd, ...(dest === undefined ? [] : [resolve(ctx.cwd ?? '.', dest)])];
};

const inventoryLabels = async (read: ReadGit, ctx: LabelContext): Promise<Set<string>> => {
  const inventory: Inventory = { files: new Set(), labels: new Set(), roots: checkoutRoots(ctx) };
  const listing = ['config', '--list', '--no-includes', '--null', '--show-origin'];
  const entries = parseOrigins(await readOrRefuse(read, listing));
  for (const entry of entries) {
    addLabel(inventory, entry.key);
  }
  const direct = entries
    .filter((entry) => entry.origin.startsWith(FILE_ORIGIN))
    .map((entry) => resolve(ctx.cwd ?? '.', entry.origin.slice(FILE_ORIGIN.length)));
  const visits: Visit[] = [
    ...[...new Set(direct)].map((file) => ({ depth: 0, direct: true, file })),
    ...nonFileIncludes(entries).map((file) => ({ depth: 1, direct: false, file })),
  ];
  for (const visit of visits) {
    // eslint-disable-next-line no-await-in-loop -- sequential keeps the file bound exact
    await visitFile(read, inventory, visit);
  }
  return inventory.labels;
};

/** `-c hook.<label>.enabled=false` for every configured-hook label the include graph can supply,
 * or why refs will not start git. `read` must run git with the same environment and working
 * directory as the command it guards. */
const hookLabelArgs = async (
  read: ReadGit,
  ctx: LabelContext,
): Promise<{ args: string[] } | { refusal: string }> => {
  try {
    const labels = await inventoryLabels(read, ctx);
    return { args: [...labels].flatMap((label) => ['-c', `hook.${label}.enabled=false`]) };
  } catch (error) {
    if (error instanceof InventoryRefusalError) {
      return { refusal: error.message };
    }
    throw error;
  }
};

// The one release line with configured hooks and no event-level switch.
const LABEL_ONLY_HOOKS = /^git version 2\.54(?:\.|\s|$)/u;

// Exit code of a git command refs refused to start; the reason is in `stderr`.
const REFUSED_EXIT_CODE = 1;

type SpawnGit = (args: readonly string[], env: NodeJS.ProcessEnv) => Promise<RunResult>;
type PolicyContext = LabelContext & { version: string };

/** Whether `args` is the version probe, which must not wait on the version. */
const isVersionProbe = (args: readonly string[]): boolean =>
  args.length === 1 && args[0] === '--version';

/** The label arguments for one git command on the git that printed `version`: none outside 2.54.
 *
 * The inventory runs without `GIT_CONFIG`: that variable redirects the `config` subcommand alone,
 * so with it set the listing would describe a file the guarded command never reads. */
const hookLabelPolicy = (
  spawnGit: SpawnGit,
  ctx: PolicyContext,
): Promise<{ args: string[] } | { refusal: string }> => {
  if (!LABEL_ONLY_HOOKS.test(ctx.version.trim())) {
    return Promise.resolve({ args: [] });
  }
  const { GIT_CONFIG: _ignored, ...env } = process.env;
  return hookLabelArgs((args) => spawnGit(args, env), ctx);
};

export { REFUSED_EXIT_CODE, hookLabelArgs, hookLabelPolicy, isVersionProbe };
