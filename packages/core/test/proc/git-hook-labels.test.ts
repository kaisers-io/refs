import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { RunResult } from '../../src/proc/runner.ts';
import { execFile } from 'node:child_process';
import { hookLabelArgs } from '../../src/proc/git-hook-labels.ts';
import { hookLabelPolicy } from '../../src/proc/git-hook-label-policy.ts';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

// The git 2.54 label inventory (`git-hook-labels.ts`) reading real configuration files through
// real git. git's own parsing is the boundary here, and any git reads these files the same way,
// so this runs on whatever git is installed. That the labels then disable hooks on 2.54 is
// `repo-exec-policy.test.ts`'s job.

type Scene = { dir: string; global: string };
type Outcome = { args: string[] } | { refusal: string };

const execGit = promisify(execFile);
const CHAIN_LENGTH = 12;

/** Plain git with `GIT_CONFIG_GLOBAL` pointed at the scene — not `SpawnRunner`, which on a 2.54
 * would run this same inventory around every read. */
const reader =
  (scene: Scene, cwd?: string) =>
  async (args: readonly string[], base: NodeJS.ProcessEnv = process.env): Promise<RunResult> => {
    const env = { ...base, GIT_CONFIG_GLOBAL: scene.global, GIT_CONFIG_NOSYSTEM: '1' };
    try {
      const { stderr, stdout } = await execGit('git', [...args], { cwd: cwd ?? scene.dir, env });
      return { exitCode: 0, stderr, stdout };
    } catch (error) {
      const failed = error as { code: number; stderr: string; stdout: string };
      return { exitCode: failed.code, stderr: failed.stderr, stdout: failed.stdout };
    }
  };

const sceneWith = async (files: Readonly<Record<string, string>>): Promise<Scene> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-hooklabels-'));
  for (const [name, content] of Object.entries(files)) {
    // eslint-disable-next-line no-await-in-loop -- a handful of fixture files
    await mkdir(join(dir, name, '..'), { recursive: true });
    // eslint-disable-next-line no-await-in-loop -- a handful of fixture files
    await writeFile(join(dir, name), content);
  }
  return { dir, global: join(dir, 'gitconfig') };
};

// A condition that never holds. git itself dies on a cycle or an over-deep chain of ACTIVE includes
// — every command, `--version` included — so only inactive ones reach refs' own bounds.
const INACTIVE = '[includeIf "gitdir:/nowhere/at/all/"]\n';

const hook = (label: string): string =>
  `[hook "${label.replaceAll('"', String.raw`\"`)}"]\n\tevent = post-checkout\n\tcommand = ./x\n`;

const labelsOf = (result: Outcome): string[] =>
  'refusal' in result ? [result.refusal] : result.args.filter((arg) => arg !== '-c').toSorted();

const refusalOf = (result: Outcome): string =>
  'refusal' in result ? result.refusal : `no refusal: ${result.args.join(' ')}`;

const inventory = async (files: Readonly<Record<string, string>>): Promise<Outcome> => {
  const scene = await sceneWith(files);
  return hookLabelArgs(reader(scene), { args: ['status'] });
};

describe('the configured-hook label inventory', () => {
  it('finds labels behind includes whose condition does not hold yet', async () => {
    expect.hasAssertions();
    const result = await inventory({
      'a/one': `${hook('a.dotted name')}[include]\n\tpath = two\n`,
      'a/two': hook(''),
      gitconfig: `${hook('top')}[includeIf "hasconfig:remote.*.url:https://**"]\n\tpath = a/one\n`,
    });
    expect(labelsOf(result)).toStrictEqual([
      'hook..enabled=false',
      'hook.a.dotted name.enabled=false',
      'hook.top.enabled=false',
    ]);
  });

  it('skips a missing include outside the checkout and survives an inactive cycle', async () => {
    expect.hasAssertions();
    const result = await inventory({
      gitconfig: `${hook('top')}[include]\n\tpath = absent\n${INACTIVE}\tpath = loop\n`,
      loop: `${hook('looped')}${INACTIVE}\tpath = gitconfig\n`,
    });
    expect(labelsOf(result)).toStrictEqual(['hook.looped.enabled=false', 'hook.top.enabled=false']);
  });
});

// A runner wrapper may prepend `-c core.hooksPath=…`, or `-C`, before the subcommand. Each case
// builds the argv in front of `clone` and the destination from the scene's directory.
type Prefixed = (dir: string) => { dest: string; globals: string[] };
const PREFIXED_CLONES: readonly (readonly [string, Prefixed])[] = [
  [
    '-c core.hooksPath',
    (dir) => ({ dest: join(dir, 'dest'), globals: ['-c', 'core.hooksPath=/x'] }),
  ],
  [
    'several globals',
    (dir) => ({ dest: join(dir, 'dest'), globals: ['-c', 'a=b', '-p', '-c', 'c=d'] }),
  ],
  [
    '-C and a relative destination',
    (dir) => ({ dest: '../dest', globals: ['-C', join(dir, 'sub')] }),
  ],
];

describe('the label inventory refusing a clone behind global options', () => {
  it.each(PREFIXED_CLONES)('with %s', async (_label, build) => {
    expect.hasAssertions();
    const scene = await sceneWith({ gitconfig: '[include]\n\tpath = dest/planted\n' });
    const { dest, globals } = build(scene.dir);
    const ctx = { args: [...globals, 'clone', '-q', '--', 'file:///x', dest] };
    const result = await hookLabelArgs(reader(scene), ctx);
    expect(refusalOf(result)).toMatch(/inside the checkout/u);
  });
});

describe('the label inventory refusing', () => {
  it('a missing include inside the destination of a clone', async () => {
    expect.hasAssertions();
    const scene = await sceneWith({ gitconfig: '[include]\n\tpath = dest/planted\n' });
    const ctx = { args: ['clone', '-q', '--', 'file:///x', join(scene.dir, 'dest')] };
    const result = await hookLabelArgs(reader(scene), ctx);
    expect(refusalOf(result)).toMatch(/inside the checkout/u);
  });

  it('an existing include inside the working directory refs set', async () => {
    expect.hasAssertions();
    const scene = await sceneWith({
      'checkout/tracked': hook('tracked'),
      gitconfig: '[include]\n\tpath = checkout/tracked\n',
    });
    const ctx = { args: ['status'], cwd: join(scene.dir, 'checkout') };
    const result = await hookLabelArgs(reader(scene, ctx.cwd), ctx);
    expect(refusalOf(result)).toMatch(/inside the checkout/u);
  });

  it('an include it cannot read', async () => {
    expect.hasAssertions();
    const result = await inventory({ 'adir/x': '', gitconfig: '[include]\n\tpath = adir\n' });
    expect(refusalOf(result)).toMatch(/reading the configuration failed/u);
  });

  it('a label that -c cannot spell', async () => {
    expect.hasAssertions();
    const result = await inventory({ gitconfig: hook('a=b') });
    expect(refusalOf(result)).toMatch(/contains '='/u);
  });

  it('a graph deeper than git follows', async () => {
    expect.hasAssertions();
    const chain = Object.fromEntries(
      Array.from({ length: CHAIN_LENGTH }, (_unused, depth) => [
        `c${String(depth)}`,
        `${INACTIVE}\tpath = c${String(depth + 1)}\n`,
      ]),
    );
    const result = await inventory({ ...chain, gitconfig: `${INACTIVE}\tpath = c0\n` });
    expect(refusalOf(result)).toMatch(/deeper or wider/u);
  });
});

describe('the label policy by git version', () => {
  it.each(['git version 2.53.0\n', 'git version 1.99.0\n', ''])(
    'reads nothing before git 2.54 or without a version: %j',
    async (version) => {
      expect.hasAssertions();
      const reads: string[] = [];
      const result = await hookLabelPolicy(
        (args) => {
          reads.push(args.join(' '));
          return Promise.resolve({ exitCode: 0, stderr: '', stdout: '' });
        },
        { args: ['status'], version },
      );
      expect({ reads, result }).toStrictEqual({ reads: [], result: { args: [] } });
    },
  );
});

describe('the label policy on gits after 2.54', () => {
  // 2.55 has an event-level switch, but a label named after the event takes it over (`hook.c`).
  it.each(['git version 2.55.0\n', 'git version 2.60.1.windows.1\n', 'git version 3.0.0\n'])(
    'inventories on later gits too: %j',
    async (version) => {
      expect.hasAssertions();
      const scene = await sceneWith({
        gitconfig: `[hook "post-checkout"]\n\tcommand = ./x\n${hook('other')}`,
      });
      const result = await hookLabelPolicy((args, env) => reader(scene)(args, env), {
        args: ['status'],
        version,
      });
      expect(labelsOf(result)).toStrictEqual([
        'hook.other.enabled=false',
        'hook.post-checkout.enabled=false',
      ]);
    },
  );

  it('inventories on git 2.54, without GIT_CONFIG', async () => {
    expect.hasAssertions();
    const scene = await sceneWith({ gitconfig: hook('found') });
    // Set, `git config --list` would read only this missing file and fail.
    vi.stubEnv('GIT_CONFIG', join(scene.dir, 'elsewhere'));
    const read = reader(scene);
    try {
      const result = await hookLabelPolicy((args, env) => read(args, env), {
        args: ['status'],
        version: 'git version 2.54.1\n',
      });
      expect(labelsOf(result)).toStrictEqual(['hook.found.enabled=false']);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
