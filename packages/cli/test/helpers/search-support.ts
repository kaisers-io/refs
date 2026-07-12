import { SpawnRunner, checkoutPath, resolveHome, zRefKey } from '@kaisers-io/refs-core';
import { buildProgram, runProgram } from '../../src/main.ts';
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { CliContext } from '../../src/context.ts';
import { seedConfig } from './ref-fixtures.ts';
import { testContext } from './context.ts';

// Shared scaffolding for `search.test.ts`, mirroring the `add-support.ts`/`tag.test.ts` split. A
// Real (unmanaged) git repo is built directly at the ref's checkout path — `git grep` only ever
// Searches TRACKED files, so every fixture file below is committed, never just written to disk.
// The command is driven through the registry-built program via `runProgram` (`search` is wired
// in through `registrars-extra.ts`, so `buildProgram` already carries it).

const SEARCH_REF_KEY = 'github.com/acme/widget';
const SEARCH_PACKAGE_NAME = 'pkg';
// A package whose configured path embeds fnmatch metacharacters — `--package` must treat it as
// A literal directory (never a glob: as a pathspec, `br[a]ckets` would match `brackets`).
const BRACKETS_PACKAGE_NAME = 'brackets';
const BRACKETS_PACKAGE_PATH = 'packages/br[a]ckets';
// A registered package whose configured path exists in NO fixture file — its directory is
// Absent from the checkout, pinning the config-drift guard (not_found, never a spawn error).
const GHOST_PACKAGE_NAME = 'ghost';
// A registered package whose directory the guards suite replaces with a SYMLINK pointing
// Outside the checkout — pinning the physical-containment guard (validation, never an external
// Cwd handed to git). No fixture file creates it; the test plants the link itself.
const ESCAPE_PACKAGE_NAME = 'escape';
const ESCAPE_PACKAGE_PATH = 'packages/escape';
const SEARCH_REF_ENTRY = {
  default_branch: 'main',
  description: 'Widget',
  packages: {
    [BRACKETS_PACKAGE_NAME]: { description: 'Brackets package', path: BRACKETS_PACKAGE_PATH },
    [ESCAPE_PACKAGE_NAME]: { description: 'Escape package', path: ESCAPE_PACKAGE_PATH },
    [GHOST_PACKAGE_NAME]: { description: 'Ghost package', path: 'packages/ghost' },
    [SEARCH_PACKAGE_NAME]: { description: 'Widget package', path: 'packages/pkg' },
  },
  tag_format: 'v{version}',
  url: 'https://github.com/acme/widget',
};

// The exact exclude pathspec entries `search.ts` derives from its default exclude list —
// Duplicated here (rather than imported) so a regression in the command's list is caught by the
// Test instead of silently agreed with. Directory and literal-file entries carry glob magic
// (`**/`) so they match at ANY depth, not just the repo root; bare fnmatch wildcards already do.
const EXPECTED_DEFAULT_EXCLUDES = [
  ':(glob,exclude)**/dist/**',
  ':(glob,exclude)**/build/**',
  ':(glob,exclude)**/out/**',
  ':(glob,exclude)**/vendor/**',
  ':(glob,exclude)**/node_modules/**',
  ':(glob,exclude)**/coverage/**',
  ':(exclude)*.min.*',
  ':(exclude)*.lock',
  ':(glob,exclude)**/package-lock.json',
  ':(glob,exclude)**/pnpm-lock.yaml',
  ':(glob,exclude)**/yarn.lock',
];

// Fixture file contents are exact — tests assert full `matches` arrays (path, 1-based line,
// Trimmed snippet) against them. `alpha2`'s deliberate leading indentation proves snippets are
// Trimmed; `dist/bundle.js` carries its needle only under a default-excluded directory; and
// `needle_scoped` appears in BOTH packages so `--package pkg` returning exactly one match proves
// Real pathspec scoping, not just a lucky single hit.
const ALPHA_SOURCE = [
  "const alpha1 = 'needle_alpha';",
  "  const alpha2 = 'needle_alpha';",
  "const alpha3 = 'needle_alpha';",
  '',
].join('\n');

const FIXTURE_FILES: Record<string, string> = {
  // `needle_docs` lives in a root-level .md AND a package-level .md — `--package pkg --glob
  // '*.md'` must return only the latter (intersection, never a pathspec union).
  'README.md': 'needle_docs\n',
  'dist/bundle.js': 'var needle_dist = 1;\n',
  // The literal `br[a]ckets` directory and its glob-expansion decoy `brackets`: if the package
  // Path ever reached git as a pathspec, fnmatch would match the DECOY instead.
  [`${BRACKETS_PACKAGE_PATH}/inner.ts`]: "const inner = 'needle_brackets';\n",
  'packages/brackets/decoy.ts': "const decoy = 'needle_brackets';\n",
  'packages/other/gamma.ts': "const gamma = 'needle_scoped';\n",
  'packages/pkg/beta.ts': "const beta = 'needle_scoped';\n",
  'packages/pkg/doc.md': 'needle_docs\n',
  // A needle under a NESTED dist/ — a bare `:(exclude)dist` pathspec would miss it, so it pins
  // The glob-magic default excludes filtering build output at any depth.
  'packages/pkg2/dist/nested.js': 'var needle_nested = 1;\n',
  // Colon in a tracked file name is legal on POSIX — pins the NUL-delimited `git grep -z`
  // Parsing (a colon-splitting parser would garble this path).
  'src/a:b.ts': 'needle_colon\n',
  'src/alpha.ts': ALPHA_SOURCE,
  // Non-ASCII file name: with quoting in effect the match path would come back octal-escaped
  // ("src/caf\303\251.txt"); the command must return the real name (`-z` disables quoting).
  'src/café.txt': 'needle_utf8\n',
  // A real NEWLINE in a tracked file name is legal on POSIX too — pins the NUL-token record
  // Walk (a newline-splitting parser would report the bogus `ne.ts` tail as the path).
  'src/li\nne.ts': 'needle_newline\n',
};

const ALPHA_MATCHES = [
  { line: 1, path: 'src/alpha.ts', snippet: "const alpha1 = 'needle_alpha';" },
  { line: 2, path: 'src/alpha.ts', snippet: "const alpha2 = 'needle_alpha';" },
  { line: 3, path: 'src/alpha.ts', snippet: "const alpha3 = 'needle_alpha';" },
];
const DIST_MATCH = { line: 1, path: 'dist/bundle.js', snippet: 'var needle_dist = 1;' };
const NESTED_DIST_MATCH = {
  line: 1,
  path: 'packages/pkg2/dist/nested.js',
  snippet: 'var needle_nested = 1;',
};
const PKG_MATCH = {
  line: 1,
  path: 'packages/pkg/beta.ts',
  snippet: "const beta = 'needle_scoped';",
};
const UTF8_MATCH = { line: 1, path: 'src/café.txt', snippet: 'needle_utf8' };
const COLON_MATCH = { line: 1, path: 'src/a:b.ts', snippet: 'needle_colon' };
const NEWLINE_MATCH = { line: 1, path: 'src/li\nne.ts', snippet: 'needle_newline' };
const ROOT_DOC_MATCH = { line: 1, path: 'README.md', snippet: 'needle_docs' };
const PKG_DOC_MATCH = { line: 1, path: 'packages/pkg/doc.md', snippet: 'needle_docs' };
const BRACKETS_MATCH = {
  line: 1,
  path: `${BRACKETS_PACKAGE_PATH}/inner.ts`,
  snippet: "const inner = 'needle_brackets';",
};

const SUCCESS_EXIT_CODE = 0;
// Test-setup-only `SpawnRunner`, mirroring `tag.test.ts`'s own local `setupRunner`.
const setupRunner = new SpawnRunner();

const git = async (dir: string, args: readonly string[]): Promise<void> => {
  const result = await setupRunner.run('git', args, { cwd: dir });
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    throw new Error(`search fixture: git ${args.join(' ')} failed: ${result.stderr}`);
  }
};

const writeFixtureFile = async (root: string, relPath: string, content: string): Promise<void> => {
  const path = join(root, relPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

/** Builds a real git repo (with all `FIXTURE_FILES` committed) directly at `dest` — a stand-in
 * for a synced checkout without running the full add/sync pipeline, like `tag.test.ts`'s clone. */
const seedSearchCheckout = async (dest: string): Promise<void> => {
  await mkdir(dest, { recursive: true });
  await git(dest, ['init', '-q', '-b', 'main']);
  await git(dest, ['config', 'user.email', 'fixture@example.com']);
  await git(dest, ['config', 'user.name', 'Fixture']);
  await Promise.all(
    Object.entries(FIXTURE_FILES).map(([rel, content]) => writeFixtureFile(dest, rel, content)),
  );
  await git(dest, ['add', '-A']);
  await git(dest, ['commit', '-q', '-m', 'init']);
};

interface SearchFixture {
  ctx: CliContext;
  stdout: string[];
}

/** Bootstraps a fresh temp home, builds the committed search fixture at `SEARCH_REF_KEY`'s
 * checkout path, and seeds the matching config entry (with the `pkg` package registered). */
const setupSearchFixture = async (homeDir: string): Promise<SearchFixture> => {
  const { ctx, stdout } = testContext();
  ctx.runner = new SpawnRunner();
  ctx.env['REFS_HOME'] = homeDir;
  const home = resolveHome(ctx.env);
  await seedSearchCheckout(checkoutPath(home, zRefKey.parse(SEARCH_REF_KEY)));
  await seedConfig(home, { [SEARCH_REF_KEY]: SEARCH_REF_ENTRY });
  return { ctx, stdout };
};

/** Runs `refs search <argv...>` through the registry-built program — `search` is registered via
 * `registrars-extra.ts`, so no manual wiring is needed here. */
const runSearchCli = async (ctx: CliContext, argv: readonly string[]): Promise<void> => {
  const program = buildProgram(ctx);
  await runProgram(ctx, program, ['node', 'refs', 'search', ...argv]);
};

interface SearchEnvelopeMatch {
  line: number;
  path: string;
  snippet: string;
}

interface SearchEnvelopeData {
  excludes_applied: string[];
  key: string;
  match_count: number;
  matches: SearchEnvelopeMatch[];
  package: string | null;
  pattern: string;
  truncated: boolean;
}

interface SearchEnvelope {
  data?: SearchEnvelopeData;
  error?: { code: string; message: string };
  ok: boolean;
}

const parseSoleSearchEnvelope = (stdout: readonly string[]): SearchEnvelope => {
  const [line] = stdout;
  if (line === undefined) {
    throw new Error('expected exactly one json envelope line, got none');
  }
  return JSON.parse(line) as SearchEnvelope;
};

// Pins the command's JSON contract: an unscoped search reports an explicit `package: null`,
// Never a dropped key (mirroring `range`/`resolve`).
// eslint-disable-next-line unicorn/no-null -- see comment above
const JSON_NULL = null;

/** The full expected `data` payload for a search over the fixture: default excludes applied,
 * `package: null`, `truncated: false`, `match_count` derived from `matches` — individual cases
 * override only what their scenario changes (e.g. `truncated`, `excludes_applied`, `package`). */
const expectedSearchData = (
  pattern: string,
  matches: SearchEnvelopeMatch[],
  overrides?: Partial<SearchEnvelopeData>,
): SearchEnvelopeData => ({
  excludes_applied: EXPECTED_DEFAULT_EXCLUDES,
  key: SEARCH_REF_KEY,
  match_count: matches.length,
  matches,
  package: JSON_NULL,
  pattern,
  truncated: false,
  ...overrides,
});

export {
  ALPHA_MATCHES,
  BRACKETS_MATCH,
  BRACKETS_PACKAGE_NAME,
  COLON_MATCH,
  DIST_MATCH,
  ESCAPE_PACKAGE_NAME,
  ESCAPE_PACKAGE_PATH,
  GHOST_PACKAGE_NAME,
  NESTED_DIST_MATCH,
  NEWLINE_MATCH,
  PKG_DOC_MATCH,
  PKG_MATCH,
  ROOT_DOC_MATCH,
  SEARCH_PACKAGE_NAME,
  SEARCH_REF_KEY,
  UTF8_MATCH,
  expectedSearchData,
  parseSoleSearchEnvelope,
  runSearchCli,
  setupSearchFixture,
};
export type { SearchEnvelope, SearchEnvelopeData, SearchEnvelopeMatch };
