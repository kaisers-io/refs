import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveInside } from './fs-containment.ts';

// What a package's manifest DECLARES as its entry points, and what is actually there.
//
// The question this answers is the one an agent asks immediately after `refs resolve` hands it a
// directory: which file do I open? The manifest's own answer is frequently wrong in a source
// checkout, because a source checkout is not built — measured on the repositories refs tracks,
// zod's `types`/`import`/`require` all point at files that do not exist, and astro's `.` points at
// `dist/index.js`, which does not either. Nothing in either manifest says where the source is;
// zod happens to declare a non-standard `@zod/source` condition that does, and that is only
// visible if every condition is reported rather than the standard ones.
//
// So this REPORTS a declaration; it does not resolve one. Resolving means choosing conditions, and
// which condition is right depends on the consumer — a decision refs has no standing to make, and
// the reason no resolver library appears here. `resolve.exports` and `resolve-pkg-maps` both
// require the caller to supply the conditions; that is precisely the input refs does not have.
//
// Prior art for the observation half: publint's `FILE_DOES_NOT_EXIST` checks the same thing for a
// package about to be published, where an absent target IS a defect. Here it is the ordinary case,
// which is why nothing in this file calls it one.

/** What was observed at a declared target. A boolean would force unrelated outcomes together: "the
 * file is not there" and "I was not allowed to look" send a reader to different places, and
 * `not_checked` is neither — it is a shape this does not interpret. */
type TargetObservation = 'absent' | 'directory' | 'file' | 'not_checked' | 'unverifiable';

/** One node of a declaration, preserving the structure Node gives it meaning by.
 *
 * Condition ORDER decides resolution — publint lints for `types` first and `default` last — so the
 * branches are an ordered array, never an object whose keys a consumer might sort. Alternatives are
 * their own node for the same reason: `["./missing.js", "./existing.js"]` does NOT mean "the first
 * one that exists". Node takes the first string; an absent file does not fall through. Flattening
 * the two into one list would imply a fallback that does not happen. */
type TargetNode =
  | { alternatives: TargetNode[]; kind: 'alternatives' }
  | { branches: { condition: string; value: TargetNode }[]; kind: 'conditions' }
  | { kind: 'excluded' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'target'; observed: TargetObservation; target: string };

type EntryPoint = { from: string; subpath: string; value: TargetNode };

/** `status` is about reading the DECLARATION, not about the package's health and not about whether
 * every target was found. `unverifiable` means the manifest could not be read or parsed — never an
 * empty `entries` presented as "this package declares none". */
type EntryPoints = {
  entries: EntryPoint[];
  manifest: string;
  reason?: string;
  status: 'complete' | 'unverifiable';
};

const MANIFEST_FILE = 'package.json';
// A declaration nested deeper than this is not something this reports on; it says so rather than
// walking further.
const MAX_DEPTH = 8;

/** A relative target this will inspect: `./` plus a path, with nothing that would make a naive
 * join look somewhere else. A URL query, a fragment or an absolute or protocol-ish form is
 * reported as declared and NOT probed — statting the wrong filename confidently is worse than
 * saying the shape was not interpreted. */
const PROBEABLE = /^\.\/[^?#\\]*$/u;

const RELATIVE_PREFIX = './'.length;

/** What is at a resolved path, or why that could not be said. */
const observeReal = async (real: string): Promise<TargetObservation> => {
  try {
    const stats = await stat(real);
    return stats.isDirectory() ? 'directory' : 'file';
  } catch {
    return 'unverifiable';
  }
};

const observe = async (packageDir: string, target: string): Promise<TargetObservation> => {
  if (!PROBEABLE.test(target) || target.includes('*')) {
    return 'not_checked';
  }
  const located = await resolveInside(packageDir, join(packageDir, target.slice(RELATIVE_PREFIX)));
  if (located.kind === 'missing') {
    return 'absent';
  }
  return located.kind === 'inside' ? observeReal(located.real) : 'unverifiable';
};

/** The two container shapes, each preserving what gives it meaning: alternatives keep their order
 * because Node takes the first string, conditions keep theirs because resolution walks them in
 * order. */
const containerFor = async (
  packageDir: string,
  value: object,
  depth: number,
): Promise<TargetNode> =>
  Array.isArray(value)
    ? {
        alternatives: await Promise.all(value.map((item) => nodeFor(packageDir, item, depth + 1))),
        kind: 'alternatives',
      }
    : {
        branches: await Promise.all(
          Object.entries(value).map(async ([condition, nested]) => ({
            condition,
            value: await nodeFor(packageDir, nested, depth + 1),
          })),
        ),
        kind: 'conditions',
      };

const nodeFor = async (packageDir: string, value: unknown, depth: number): Promise<TargetNode> => {
  if (value === null) {
    // A legal declaration, and a meaningful one: it excludes a subpath a pattern would otherwise
    // cover. Dropping it would report the opposite of what the manifest says.
    return { kind: 'excluded' };
  }
  if (depth > MAX_DEPTH) {
    return { kind: 'unsupported', reason: 'nested deeper than this reports on' };
  }
  if (typeof value === 'string') {
    return { kind: 'target', observed: await observe(packageDir, value), target: value };
  }
  return typeof value === 'object'
    ? containerFor(packageDir, value, depth)
    : { kind: 'unsupported', reason: `unexpected ${typeof value}` };
};

/** npm's own legacy entry fields, reported BESIDE `exports` rather than instead of it.
 *
 * Suppressing them where `exports` exists would be enforcing a resolver's precedence, which is a
 * decision about what a consumer will do — and the consumer here is an agent reading source, not
 * Node. Each keeps the field it came from, so nobody has to infer it from position. */
const LEGACY_FIELDS = ['main', 'module', 'types', 'typings'] as const;

const legacyEntries = (
  packageDir: string,
  manifest: Record<string, unknown>,
): Promise<EntryPoint[]> => {
  const declared = LEGACY_FIELDS.filter((field) => typeof manifest[field] === 'string');
  return Promise.all(
    declared.map(async (field) => ({
      from: field,
      subpath: '.',
      value: await nodeFor(packageDir, normalizeLegacy(manifest[field] as string), 0),
    })),
  );
};

/** `main` is written without the `./` that `exports` requires — `dist/index.js` and `./dist/index.js`
 * name the same file — so it is brought to the one form the target probe understands. */
const normalizeLegacy = (target: string): string =>
  target.startsWith('./') || target.startsWith('../') ? target : `./${target}`;

const exportEntries = async (packageDir: string, exported: unknown): Promise<EntryPoint[]> => {
  if (typeof exported === 'string' || Array.isArray(exported)) {
    // The sugar form: `exports` is the `.` target itself.
    return [{ from: 'exports', subpath: '.', value: await nodeFor(packageDir, exported, 0) }];
  }
  if (typeof exported !== 'object' || exported === null) {
    return [];
  }
  const keys = Object.keys(exported);
  // A map whose keys are conditions rather than subpaths is also the `.` target. The distinction
  // is npm's own: a subpath starts with `.`.
  if (keys.length > 0 && !keys.some((key) => key.startsWith('.'))) {
    return [{ from: 'exports', subpath: '.', value: await nodeFor(packageDir, exported, 0) }];
  }
  return Promise.all(
    Object.entries(exported).map(async ([subpath, value]) => ({
      from: 'exports',
      subpath,
      value: await nodeFor(packageDir, value, 0),
    })),
  );
};

/** Every entry point a package declares, with what is at each target.
 *
 * `packageDir` is the VERIFIED package directory — the one `resolve` established by reading the
 * manifest's name, not the configured path it started from. Attaching declarations to a directory
 * whose identity was never confirmed would describe some other package. */
const readEntryPoints = async (packageDir: string): Promise<EntryPoints> => {
  const located = await resolveInside(packageDir, join(packageDir, MANIFEST_FILE));
  if (located.kind !== 'inside') {
    return { entries: [], manifest: MANIFEST_FILE, reason: located.kind, status: 'unverifiable' };
  }
  try {
    const manifest = JSON.parse(await readFile(located.real, 'utf8')) as Record<string, unknown>;
    return {
      entries: [
        ...(await exportEntries(packageDir, manifest['exports'])),
        ...(await legacyEntries(packageDir, manifest)),
      ],
      manifest: MANIFEST_FILE,
      status: 'complete',
    };
  } catch (error) {
    // Valid JSON is not the same as a manifest this can read. Either way the answer is "could not
    // look", never an empty list presented as "declares none".
    return {
      entries: [],
      manifest: MANIFEST_FILE,
      reason: (error as NodeJS.ErrnoException).code ?? String(error),
      status: 'unverifiable',
    };
  }
};

export { MANIFEST_FILE, readEntryPoints };
export type { EntryPoint, EntryPoints, TargetNode, TargetObservation };
