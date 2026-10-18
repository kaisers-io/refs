import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { RunResult } from './runner.ts';
import { access } from 'node:fs/promises';

// Configured hooks switched off by LABEL, on git 2.55 and newer.
//
// git-policy.ts turns every documented hook event off with `hook.<event>.enabled=false`. Git 2.55
// reads that key as an EVENT switch only while no hook label carries the same name: a label is any
// name with a `command`, `event` or `parallel` key (`is_friendly_name()` in hook.c, 2.55.0). With
// `[hook "post-checkout"] command = …` in the user's configuration, refs' event switch disables
// that one label and every other label on `post-checkout` still runs. Measured on 2.55.0
// (test/git/hook-label-collision-real.test.ts). So refs also disables each label by name,
// `-c hook.<label>.enabled=false`, which works whatever the names are; the event switches stay as
// the second layer. 2.54 is refused outright (git-version-gate.ts), and 2.53 and older have no
// configured hooks, so this runs on 2.55+ only.
//
// The labels come from the configuration git reads, plus every include it MIGHT read: an
// `includeIf "hasconfig:remote.*.url:…"` or `gitdir:` section is decided by the repository a
// command runs in, and the clone's own repository does not exist yet when this runs. So every
// `include.path`/`includeIf.*.path` is followed whether its condition holds or not. Once per
// configuration environment, not per command (runner.ts): one `git config --list`, plus one read
// per include file the active configuration did not already cover.
//
// It fails closed: if the include graph cannot be read completely, or names a file under refs'
// sources directory (which a clone or sync writes, so a file there can appear or change after
// this inventory), git is not started and the reason is reported. A missing include elsewhere is
// skipped, as git skips it.

type ConfigGit = (args: readonly string[]) => Promise<RunResult>;
type LabelPolicy = { args: readonly string[]; refusal?: undefined } | { refusal: string };
// `home`: what `~/` expands to. `sourcesDir`: refs' checkouts, refused as an include location.
type LabelContext = { git: ConfigGit; home: string; sourcesDir: string | undefined };

const LABELS_SINCE = { major: 2, minor: 55 };
const VERSION = /^git version (?<major>\d+)\.(?<minor>\d+)/u;
// Git follows includes 10 levels deep (MAX_INCLUDE_DEPTH); a wider graph than this is not a
// configuration anyone writes by hand.
const MAX_DEPTH = 10;
const MAX_FILES = 64;
const LABEL_KEY = /^hook\.(?<label>.*)\.(?:command|event|parallel)$/su;
const INCLUDE_KEY = /^(?:include|includeif\..*)\.path$/su;
const FILE_ORIGIN = 'file:';
const HOME_PREFIX = '~/';
const TOKENS_PER_LISTED_ENTRY = 2;

type Entry = { origin: string; key: string; value: string };
type Inventory = { ctx: LabelContext; labels: Set<string>; seen: Set<string>; next: string[] };

class RefusalError extends Error {
  override name = 'RefusalError';
}

/** Whether this git reads configured hooks with the event/label rule above. */
const needsLabelPolicy = (versionOutput: string): boolean => {
  const groups = VERSION.exec(versionOutput.trim())?.groups;
  const major = Number(groups?.['major']);
  const minor = Number(groups?.['minor']);
  return (
    major > LABELS_SINCE.major || (major === LABELS_SINCE.major && minor >= LABELS_SINCE.minor)
  );
};

// One `<key>\n<value>` token; a bare boolean key has no newline and no value.
const toEntry = (origin: string, token: string): Entry => {
  const [key = '', ...value] = token.split('\n');
  return { key, origin, value: value.join('\n') };
};

const tokensOf = (stdout: string): string[] => stdout.split('\0').filter((token) => token !== '');

/** `git config --list --show-origin -z`: `<origin>\0<key>\n<value>\0` per entry. */
const parseListing = (stdout: string): Entry[] =>
  tokensOf(stdout).flatMap((token, index, tokens) =>
    index % TOKENS_PER_LISTED_ENTRY === 0 ? [toEntry(token, tokens[index + 1] ?? '')] : [],
  );

/** `git config --file <path> --list -z`: `<key>\n<value>\0` per entry, all from `path`. */
const parseFile = (stdout: string, path: string): Entry[] =>
  tokensOf(stdout).map((token) => toEntry(`${FILE_ORIGIN}${path}`, token));

/** Where an include points, as git resolves it: `~/` from the home directory, anything relative
 * from the directory of the file that names it. */
const includeTarget = (entry: Entry, home: string): string => {
  if (entry.value.startsWith(HOME_PREFIX)) {
    return join(home, entry.value.slice(HOME_PREFIX.length));
  }
  if (isAbsolute(entry.value) || !entry.origin.startsWith(FILE_ORIGIN)) {
    // A relative include outside a file (`-c include.path=x`) is an error git reports itself.
    return resolve(entry.value);
  }
  return resolve(dirname(entry.origin.slice(FILE_ORIGIN.length)), entry.value);
};

const isInside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const followInclude = (inventory: Inventory, entry: Entry): void => {
  const target = includeTarget(entry, inventory.ctx.home);
  const { sourcesDir } = inventory.ctx;
  if (sourcesDir !== undefined && isInside(sourcesDir, target)) {
    throw new RefusalError(`an include (${target}) lies under refs' sources, which clones write`);
  }
  if (!inventory.seen.has(target)) {
    inventory.seen.add(target);
    inventory.next.push(target);
  }
};

/** Adds `entries`' labels, and queues the includes they name that have not been read yet. */
const absorb = (inventory: Inventory, entries: readonly Entry[]): void => {
  for (const entry of entries) {
    const label = LABEL_KEY.exec(entry.key)?.groups?.['label'];
    if (label !== undefined) {
      inventory.labels.add(label);
    }
    if (INCLUDE_KEY.test(entry.key)) {
      followInclude(inventory, entry);
    }
  }
};

const readInclude = async (inventory: Inventory, path: string): Promise<Entry[]> => {
  if (!(await exists(path))) {
    return [];
  }
  const read = await inventory.ctx.git(['config', '--file', path, '--no-includes', '--list', '-z']);
  if (read.exitCode !== 0) {
    throw new RefusalError(`an include (${path}) could not be read: ${read.stderr.trim()}`);
  }
  return parseFile(read.stdout, path);
};

// One level of the include graph per call, its files read in parallel.
const readLevels = async (inventory: Inventory, depth: number): Promise<void> => {
  const level = inventory.next.splice(0);
  if (level.length === 0) {
    return;
  }
  if (depth > MAX_DEPTH || inventory.seen.size > MAX_FILES) {
    throw new RefusalError('the include graph is deeper or wider than refs follows');
  }
  const read = await Promise.all(level.map((path) => readInclude(inventory, path)));
  absorb(inventory, read.flat());
  await readLevels(inventory, depth + 1);
};

const labelArgs = (labels: ReadonlySet<string>): readonly string[] => {
  const unusable = [...labels].find((label) => label.includes('='));
  if (unusable !== undefined) {
    throw new RefusalError(`the hook label "${unusable}" contains '=', which -c cannot name`);
  }
  return [...labels].toSorted().flatMap((label) => ['-c', `hook.${label}.enabled=false`]);
};

const inventoryLabels = async (ctx: LabelContext): Promise<readonly string[]> => {
  const listed = await ctx.git(['config', '--list', '--show-origin', '-z']);
  if (listed.exitCode !== 0) {
    throw new RefusalError(`git could not list its configuration: ${listed.stderr.trim()}`);
  }
  const entries = parseListing(listed.stdout);
  const files = entries.filter(({ origin }) => origin.startsWith(FILE_ORIGIN));
  const seen = new Set(files.map(({ origin }) => origin.slice(FILE_ORIGIN.length)));
  const inventory: Inventory = { ctx, labels: new Set(), next: [], seen };
  absorb(inventory, entries);
  await readLevels(inventory, 1);
  return labelArgs(inventory.labels);
};

/** The per-label `-c` options for this git and configuration, or why git must not be started. */
const hookLabelPolicy = async (versionOutput: string, ctx: LabelContext): Promise<LabelPolicy> => {
  if (!needsLabelPolicy(versionOutput)) {
    return { args: [] };
  }
  try {
    return { args: await inventoryLabels(ctx) };
  } catch (error) {
    if (!(error instanceof RefusalError)) {
      throw error;
    }
    return {
      refusal: `refs did not start git: ${error.message}. refs switches every configured hook ([hook "<name>"] in your git configuration) off by name, so it has to see all of them first`,
    };
  }
};

export { hookLabelPolicy, needsLabelPolicy, parseFile, parseListing };
export type { ConfigGit, LabelContext, LabelPolicy };
