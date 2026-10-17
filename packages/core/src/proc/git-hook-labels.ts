// Configured-hook labels, disabled one by one on every git that has configured hooks (2.54 and
// later). 2.54 has no event-level switch, so there a hook can be disabled only by its label,
// `hook.<label>.enabled=false`. 2.55 has one (`git-exec-policy.ts`), but git decides what
// `hook.<name>.enabled` means by the name: it is a LABEL's switch whenever the configuration gives
// that name a `command`, `event` or `parallel` (`build_hook_config_map` in git's `hook.c`). So
// `[hook "post-checkout"] command = …` turns refs' event switch for `post-checkout` into a switch
// for that one label, and every other label on the event still runs — measured on 2.55.0 through
// `refs add --dry-run`. Disabling each label holds whatever the names, so refs has to know every
// label before it starts git.
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

import type { HookLabelCache, Snapshot } from './git-hook-label-cache.ts';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { RunResult } from './runner.ts';
import { commandOf } from './git-command-of.ts';
import { realpath } from 'node:fs/promises';
import { snapshotOf } from './git-hook-label-cache.ts';

type ReadGit = (args: readonly string[]) => Promise<RunResult>;
type LabelContext = {
  args: readonly string[];
  cache?: { key: string; store: HookLabelCache };
  cwd?: string;
};

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

// `snapshots` holds what every path looked at contained, and `includes` the paths reached through
// an include: what the cache compares, and what it checks against the next command's checkout.
type Inventory = {
  files: Set<string>;
  includes: string[];
  labels: Set<string>;
  roots: readonly string[];
  snapshots: Map<string, Snapshot>;
};
type Visit = { depth: number; file: string; direct: boolean };

const refuse = (why: string): never => {
  throw new InventoryRefusalError(
    `refs did not start git: refs disables configured hooks by label, and ${why}`,
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

const assertOutsideCheckout = async (path: string, roots: readonly string[]): Promise<void> => {
  const real = await canonical(path);
  if (roots.some((root) => isInside(path, root) || isInside(real, root))) {
    refuse(`the include ${path} lies inside the checkout this command writes`);
  }
};

/** Whether `path` exists, keeping what it holds for the cache: taken before git reads it, and only
 * the first time, so a change after any read leaves a snapshot that no longer matches. */
const exists = async (inventory: Inventory, path: string): Promise<boolean> => {
  let snapshot: Snapshot = undefined;
  try {
    snapshot = await snapshotOf(path);
  } catch {
    refuse(`the include ${path} cannot be inspected`);
  }
  if (!inventory.snapshots.has(path)) {
    inventory.snapshots.set(path, snapshot);
  }
  return snapshot !== undefined;
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

/** Keeps an include for the cache's own checkout test, and refuses one inside this checkout. */
const noteInclude = async (inventory: Inventory, at: Visit): Promise<void> => {
  if (!at.direct) {
    inventory.includes.push(at.file);
    await assertOutsideCheckout(at.file, inventory.roots);
  }
};

/** Whether `at` is a file not yet read, after the bounds and the checkout test — which files git
 * reads directly skip: the checkout's own `.git/config` is one, out of a tracked file's reach. */
const admit = async (inventory: Inventory, at: Visit): Promise<boolean> => {
  if (at.depth > MAX_DEPTH || inventory.files.size >= MAX_FILES) {
    refuse('the include graph is deeper or wider than refs follows');
  }
  await noteInclude(inventory, at);
  const present = await exists(inventory, at.file);
  const real = await canonical(at.file);
  if (inventory.files.has(real) || !present) {
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
  const { dir, rest } = commandOf(ctx.args, ctx.cwd);
  const dest = rest[0] === 'clone' ? rest.at(LAST) : undefined;
  return [
    ...(dir === undefined ? [] : [dir]),
    ...(dest === undefined ? [] : [resolve(dir ?? '.', dest)]),
  ];
};

const inventoryLabels = async (
  read: ReadGit,
  ctx: LabelContext,
  roots: readonly string[],
): Promise<Inventory> => {
  const inventory: Inventory = {
    files: new Set(),
    includes: [],
    labels: new Set(),
    roots,
    snapshots: new Map(),
  };
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
  return inventory;
};

/** The labels, from the cache when nothing the inventory read has changed. A cached inventory's
 * includes are checked against THIS command's checkout, which no cache entry can answer for. */
const labelsFor = async (read: ReadGit, ctx: LabelContext): Promise<ReadonlySet<string>> => {
  const roots = checkoutRoots(ctx);
  const cached = await ctx.cache?.store.lookup(ctx.cache.key);
  if (cached !== undefined) {
    for (const include of cached.includes) {
      // eslint-disable-next-line no-await-in-loop -- refusal order follows the graph's
      await assertOutsideCheckout(include, roots);
    }
    return cached.labels;
  }
  const inventory = await inventoryLabels(read, ctx, roots);
  ctx.cache?.store.store(ctx.cache.key, inventory);
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
    const labels = await labelsFor(read, ctx);
    return { args: [...labels].flatMap((label) => ['-c', `hook.${label}.enabled=false`]) };
  } catch (error) {
    if (error instanceof InventoryRefusalError) {
      return { refusal: error.message };
    }
    throw error;
  }
};

export { hookLabelArgs };
export type { LabelContext };
