import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { SpawnRunner } from '@kaisers-io/refs-core';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

// Local copy of `packages/core/test/helpers/fixture-repo.ts` — deliberately duplicated rather than
// imported cross-package: `packages/cli/tsconfig.json` only `include`s `src`/`test` inside this
// package, and cross-package relative test imports (`../../../core/test/helpers/...`) would also
// trip this repo's `import/no-relative-parent-imports` lint rule. This test-only fixture builder
// creates a throwaway local git repo used as a `file://` "remote" for `add.test.ts`'s integration
// suite — never the code under test.

const setupRunner = new SpawnRunner();

type FixtureOpts = {
  monorepo?: boolean;
  // When `true` (alongside `monorepo: true`), `@fixture/b` also ships a description. Now a
  // NEGATIVE control: every manifest carrying one must not help the one-shot, because refs no
  // longer reads any of them. Default (`false`/omitted) keeps the original asymmetric monorepo,
  // whose `@fixture/b` ships WITHOUT one (see `packageBSpec`'s own comment).
  monorepoAllDescribed?: boolean;
  objectFormat?: 'sha256';
  // When `true` (alongside `monorepo: true`), the root declares `packages/**` instead of
  // `packages/*`. The classifier cannot expand a doubled wildcard, so the scan selects no member and
  // reports `unsupported_pattern` — an ordinary spelling that used to produce a proposal missing
  // every member, with no indication why (#106). The named root is still detected, so the result
  // looks complete rather than empty.
  unsupportedPattern?: boolean;
  // When `true`, the repo declares workspaces that select NOTHING (no `packages/` directory) and
  // its root manifest names a package and describes itself. Boundary coverage rather than a
  // common upstream shape: it is the narrow case where detection registers a root and no member,
  // which is the only one with a package that the one-shot still finalizes. The ordinary
  // single-package repo declares no workspaces at all, detects nothing, and is covered separately.
  rootOnlyWorkspace?: boolean;
  tags?: string[];
};

type FixtureRepo = {
  dir: string;
  url: string;
};

type PackageSpec = {
  folder: string;
  pkgName: string;
  description?: string;
};

const JSON_INDENT = 2;
const SUCCESS_EXIT_CODE = 0;

const git = async (dir: string, args: readonly string[]): Promise<string> => {
  const result = await setupRunner.run('git', args, { cwd: dir });
  if (result.exitCode === SUCCESS_EXIT_CODE) {
    return result.stdout;
  }
  throw new Error(`fixture git ${args.join(' ')} failed (${result.exitCode}): ${result.stderr}`);
};

// `opts.objectFormat` is undefined for the vast majority of fixtures (the default SHA-1 hash
// algorithm); only the finalize-time head-sha-shape guard test needs a `--object-format=sha256`
// repo, whose 64-character HEAD sha does not fit `zState`'s 40-character `head_sha` regex.
const initFixtureGit = async (dir: string, objectFormat: 'sha256' | undefined): Promise<void> => {
  const args = ['init', '-q', '-b', 'main'];
  if (objectFormat !== undefined) {
    args.push(`--object-format=${objectFormat}`);
  }
  await git(dir, args);
  await git(dir, ['config', 'user.email', 'fixture@example.com']);
  await git(dir, ['config', 'user.name', 'Fixture']);
};

const commitAll = async (dir: string, message: string): Promise<void> => {
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', message]);
};

const writePackageJson = async (dir: string, content: object): Promise<void> => {
  const text = JSON.stringify(content, undefined, JSON_INDENT);
  await writeFile(join(dir, 'package.json'), `${text}\n`);
};

const packageJsonFor = (spec: PackageSpec): Record<string, unknown> => {
  const base: Record<string, unknown> = { name: spec.pkgName, version: '1.0.0' };
  if (spec.description === undefined) {
    return base;
  }
  return { ...base, description: spec.description };
};

const writePackage = async (root: string, spec: PackageSpec): Promise<void> => {
  const dir = join(root, 'packages', spec.folder);
  await mkdir(dir, { recursive: true });
  await writePackageJson(dir, packageJsonFor(spec));
  await writeFile(join(dir, 'README.md'), `# ${spec.pkgName}\n`);
};

// `@fixture/b` deliberately ships WITHOUT a description by default, mirroring core's fixture —
// `add.test.ts` relies on this exact asymmetry to exercise the "write a description for each
// package" step of the two-phase proposal flow. `monorepoAllDescribed` gives it a real one, which
// must change nothing: a manifest description never reaches refs at all.
const packageBSpec = (opts: FixtureOpts | undefined): PackageSpec =>
  opts?.monorepoAllDescribed === true
    ? { description: 'Fixture package B', folder: 'b', pkgName: '@fixture/b' }
    : { folder: 'b', pkgName: '@fixture/b' };

/** The text a single-package fixture's root manifest says about itself. A test asserts it is NOT
 * what lands in config: the caller's `--description` is. */
const SOLO_MANIFEST_DESCRIPTION = 'What the fixture manifest says about itself.';

const seedMonorepo = async (dir: string, packageB: PackageSpec, pattern: string): Promise<void> => {
  await writePackageJson(dir, {
    name: 'fixture-root',
    private: true,
    version: '0.0.0',
    workspaces: [pattern],
  });
  await writePackage(dir, { description: 'Fixture package A', folder: 'a', pkgName: '@fixture/a' });
  await writePackage(dir, packageB);
};

/** The root manifest a fixture carries, if any: a monorepo's workspace root plus its two member
 * packages, or a workspace root whose patterns select nothing. */
const seedManifests = async (dir: string, opts: FixtureOpts | undefined): Promise<void> => {
  if (opts?.monorepo === true) {
    await seedMonorepo(
      dir,
      packageBSpec(opts),
      opts.unsupportedPattern === true ? 'packages/**' : 'packages/*',
    );
  }
  if (opts?.rootOnlyWorkspace === true) {
    await writePackageJson(dir, {
      description: SOLO_MANIFEST_DESCRIPTION,
      name: 'fixture-solo',
      version: '1.0.0',
      workspaces: ['packages/*'],
    });
  }
};

/** Creates a throwaway local git repo (`git init -b main`, LOCAL user.email/name only) that acts as
 * the "remote" for `add.test.ts`'s integration suite: `refs add <file-url>` clones/fetches point at
 * its `file://` url. Seeds one README commit; with `opts.monorepo` also seeds a root
 * `package.json` (workspaces) plus `packages/a` (`@fixture/a`, with description) and `packages/b`
 * (`@fixture/b`, shaped by `packageBSpec` — no description by default) — and creates any
 * requested tags on the initial commit. */
const createFixtureRepo = async (opts?: FixtureOpts): Promise<FixtureRepo> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-cli-fixture-'));
  await initFixtureGit(dir, opts?.objectFormat);
  // The suites assert on exact file bytes after clone/sync; without this, Git for Windows'
  // default `core.autocrlf=true` turns `\n` into `\r\n` in every clone's working tree and the
  // assertions become platform-dependent.
  await writeFile(join(dir, '.gitattributes'), '* -text\n');
  await writeFile(join(dir, 'README.md'), '# fixture repo\n');
  await seedManifests(dir, opts);
  await commitAll(dir, 'init');
  await Promise.all((opts?.tags ?? []).map((tag) => git(dir, ['tag', tag])));
  // `pathToFileURL`, not string concatenation: on Windows `dir` contains `\` and a drive letter,
  // which only the URL encoder turns into a valid `file:///C:/...` form.
  return { dir, url: pathToFileURL(dir).href };
};

export { SOLO_MANIFEST_DESCRIPTION, createFixtureRepo };
export type { FixtureRepo };
