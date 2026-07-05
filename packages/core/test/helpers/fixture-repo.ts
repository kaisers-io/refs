import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { execa } from 'execa';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Test-only fixture builder: a real local git repo used as a `file://` "remote" for the
// Integration suite in `test/git/repo.test.ts`. Uses execa directly (not the production Runner
// Abstraction) because this is test infrastructure, not code under test — see the task brief.

interface FixtureOpts {
  monorepo?: boolean;
  tags?: string[];
}

interface FixtureRepo {
  dir: string;
  url: string;
}

interface PackageSpec {
  folder: string;
  pkgName: string;
  description?: string;
}

const JSON_INDENT = 2;
const SUCCESS_EXIT_CODE = 0;

// Runs a git command in `dir`, local (never --global) config only, and throws with the captured
// Stderr on failure so a broken fixture fails loudly at setup time rather than surfacing as a
// Confusing failure deep in the code under test.
const git = async (dir: string, args: readonly string[]): Promise<string> => {
  const result = await execa('git', args, { cwd: dir, reject: false });
  if (result.exitCode === SUCCESS_EXIT_CODE) {
    return result.stdout;
  }
  throw new Error(`fixture git ${args.join(' ')} failed (${result.exitCode}): ${result.stderr}`);
};

const initFixtureGit = async (dir: string): Promise<void> => {
  await git(dir, ['init', '-q', '-b', 'main']);
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

const seedMonorepo = async (dir: string): Promise<void> => {
  await writePackageJson(dir, {
    name: 'fixture-root',
    private: true,
    version: '0.0.0',
    workspaces: ['packages/*'],
  });
  // `@fixture/b` deliberately ships WITHOUT a description — later tasks (metadata detection) rely
  // On this exact asymmetry between the two fixture packages.
  await writePackage(dir, { description: 'Fixture package A', folder: 'a', pkgName: '@fixture/a' });
  await writePackage(dir, { folder: 'b', pkgName: '@fixture/b' });
};

/**
 * Creates a throwaway local git repo (`git init -b main`, LOCAL user.email/name only) that acts
 * As the "remote" for the integration suite: clones/fetches point at its `file://` URL. Seeds one
 * README commit; with `opts.monorepo` also seeds a root `package.json` (workspaces) plus
 * `packages/a` (`@fixture/a`, with description) and `packages/b` (`@fixture/b`, without) — and
 * creates any requested tags on the initial commit.
 */
const createFixtureRepo = async (opts?: FixtureOpts): Promise<FixtureRepo> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-fixture-'));
  await initFixtureGit(dir);
  await writeFile(join(dir, 'README.md'), '# fixture repo\n');
  if (opts?.monorepo === true) {
    await seedMonorepo(dir);
  }
  await commitAll(dir, 'init');
  await Promise.all((opts?.tags ?? []).map((tag) => git(dir, ['tag', tag])));
  return { dir, url: `file://${dir}` };
};

/** Adds one commit writing `content` to `file` (relative to `dir`) — used to simulate upstream progress between a clone and a later `syncRef`. */
const addCommit = async (dir: string, file: string, content: string): Promise<void> => {
  await writeFile(join(dir, file), content);
  await commitAll(dir, `update ${file}`);
};

/**
 * Simulates a force-push by rewriting the fixture's own last commit in place (amend with new
 * Content, giving it a new sha). The fixture repo IS the remote for its clones — there is no
 * Separate push step; a clone's `origin/<branch>` diverges from its local history the next time
 * It fetches this rewritten tip, exactly as a real force-push would look from a downstream clone.
 */
const forcePushRewrite = async (dir: string): Promise<void> => {
  await writeFile(join(dir, 'REWRITTEN.md'), `rewritten at ${Date.now()}\n`);
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '--amend', '-m', 'rewritten history']);
};

export { addCommit, createFixtureRepo, forcePushRewrite };
export type { FixtureRepo };
