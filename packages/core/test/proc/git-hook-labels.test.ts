import type { ConfigGit, LabelContext } from '../../src/proc/git-hook-labels.ts';
import { describe, expect, it } from 'vitest';
import { hookLabelPolicy, needsLabelPolicy, parseListing } from '../../src/proc/git-hook-labels.ts';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The inventory against a scripted `git config`: `listing` is what the active configuration lists,
// `files` what `git config --file <path>` reads from each include. Include files also exist on disk,
// because a missing include is skipped before git is asked.

const V255 = 'git version 2.55.0\n';
const NUL = '\0';
const CHAIN_DEEPER_THAN_GIT = 12;
// `config --file <path> --no-includes --list -z`: the path is fourth from the end.
const FILE_ARG_FROM_END = 4;

type Script = { listing: string; files?: Record<string, string>; unreadable?: string };

const listed = (origin: string, ...entries: string[]): string =>
  entries.map((entry) => `${origin}${NUL}${entry}${NUL}`).join('');
const fileBody = (...entries: string[]): string =>
  entries.map((entry) => `${entry}${NUL}`).join('');

const scripted = (script: Script, calls: string[][]): ConfigGit => {
  const git: ConfigGit = async (args) => {
    calls.push([...args]);
    await Promise.resolve();
    const [, flag, path = ''] = args;
    if (flag !== '--file') {
      return { exitCode: 0, stderr: '', stdout: script.listing };
    }
    if (path === script.unreadable) {
      return { exitCode: 1, stderr: 'fatal: unable to read config file', stdout: '' };
    }
    return { exitCode: 0, stderr: '', stdout: script.files?.[path] ?? '' };
  };
  return git;
};

const run = async (
  script: Script,
  ctx: Partial<LabelContext> = {},
): Promise<{ calls: string[][]; policy: Awaited<ReturnType<typeof hookLabelPolicy>> }> => {
  const calls: string[][] = [];
  const policy = await hookLabelPolicy(V255, {
    git: scripted(script, calls),
    home: ctx.home ?? '/nonexistent-home',
    sourcesDir: ctx.sourcesDir,
  });
  return { calls, policy };
};

const scratch = (): Promise<string> => mkdtemp(join(tmpdir(), 'refs-labels-'));
const touch = async (path: string): Promise<string> => {
  await writeFile(path, '');
  return path;
};

describe('which git needs the per-label switches', () => {
  it('is git 2.55 and newer only', () => {
    expect.hasAssertions();
    expect(needsLabelPolicy('git version 2.53.0')).toBe(false);
    expect(needsLabelPolicy('git version 2.55.0')).toBe(true);
    expect(needsLabelPolicy('git version 2.56.1.windows.1')).toBe(true);
    expect(needsLabelPolicy('git version 3.0.0')).toBe(true);
    expect(needsLabelPolicy('not git')).toBe(false);
  });

  it('asks older git nothing', async () => {
    expect.hasAssertions();
    const calls: string[][] = [];
    const policy = await hookLabelPolicy('git version 2.53.0', {
      git: scripted({ listing: '' }, calls),
      home: '/h',
      sourcesDir: undefined,
    });
    expect(policy).toStrictEqual({ args: [] });
    expect(calls).toStrictEqual([]);
  });
});

describe('the labels of the active configuration', () => {
  it('switches off every name with a command, event or parallel key, sorted', async () => {
    expect.hasAssertions();
    const listing = listed(
      'file:/u/.gitconfig',
      'hook.post-checkout.command\necho x',
      'hook.a.b c.event\npre-push',
      'hook.par.parallel\ntrue',
      'hook.only-enabled.enabled\nfalse',
      'flag.bare',
    );
    const { calls, policy } = await run({ listing });
    expect(policy).toStrictEqual({
      args: [
        '-c',
        'hook.a.b c.enabled=false',
        '-c',
        'hook.par.enabled=false',
        '-c',
        'hook.post-checkout.enabled=false',
      ],
    });
    expect(calls).toStrictEqual([['config', '--list', '--show-origin', '-z']]);
  });

  it('reads a bare key as a key without a value', () => {
    expect.hasAssertions();
    expect(parseListing(listed('command line:', 'flag.bare', 'x.y\na\nb'))).toStrictEqual([
      { key: 'flag.bare', origin: 'command line:', value: '' },
      { key: 'x.y', origin: 'command line:', value: 'a\nb' },
    ]);
  });
});

// gitconfig -(hasconfig, relative)-> conf/remote-only -(relative)-> conf/nested -> conf/remote-only,
// and gitconfig -(gitdir, ~/)-> from-home.
const includeTree = async (): Promise<
  Record<'dir' | 'homeOne' | 'nested' | 'remoteOnly', string> & { script: Script }
> => {
  const dir = await scratch();
  await mkdir(join(dir, 'conf'));
  const remoteOnly = await touch(join(dir, 'conf', 'remote-only'));
  const nested = await touch(join(dir, 'conf', 'nested'));
  const homeOne = await touch(join(dir, 'from-home'));
  const listing = listed(
    `file:${join(dir, 'gitconfig')}`,
    'includeif.hasconfig:remote.*.url:**.path\nconf/remote-only',
    'includeif.gitdir:/never/.path\n~/from-home',
  );
  const files = {
    [homeOne]: fileBody('hook.h.command\nh'),
    [nested]: fileBody('hook.n.command\nn', `include.path\n${remoteOnly}`),
    [remoteOnly]: fileBody('hook.y.event\nreference-transaction', 'include.path\nnested'),
  };
  return { dir, homeOne, nested, remoteOnly, script: { files, listing } };
};

describe('includes the active configuration does not apply yet', () => {
  it('follows every include, relative to its file or the home directory, and nested', async () => {
    expect.hasAssertions();
    const { dir, homeOne, nested, remoteOnly, script } = await includeTree();
    const { calls, policy } = await run(script, { home: dir });
    expect(policy).toStrictEqual({
      args: [
        '-c',
        'hook.h.enabled=false',
        '-c',
        'hook.n.enabled=false',
        '-c',
        'hook.y.enabled=false',
      ],
    });
    // Each include read once, the cycle back to remote-only included.
    const read = calls.slice(1).map((args) => args.at(-FILE_ARG_FROM_END));
    expect(read.toSorted()).toStrictEqual([homeOne, nested, remoteOnly].toSorted());
  });
});

describe('includes the active configuration already applied or cannot apply', () => {
  it('does not read again a file the active configuration already listed', async () => {
    expect.hasAssertions();
    const dir = await scratch();
    const active = await touch(join(dir, 'active'));
    const listing =
      listed(`file:${join(dir, 'gitconfig')}`, `include.path\n${active}`) +
      listed(`file:${active}`, 'hook.a.command\na');
    const { calls, policy } = await run({ listing });
    expect(policy).toStrictEqual({ args: ['-c', 'hook.a.enabled=false'] });
    expect(calls).toHaveLength(1);
  });

  it('skips a missing include, as git does', async () => {
    expect.hasAssertions();
    const dir = await scratch();
    const listing = listed(`file:${join(dir, 'gitconfig')}`, 'include.path\nnot-there');
    const { calls, policy } = await run({ listing });
    expect(policy).toStrictEqual({ args: [] });
    expect(calls).toHaveLength(1);
  });
});

const refused = (policy: unknown, reason: RegExp): void => {
  expect(policy).toStrictEqual({ refusal: expect.stringMatching(reason) });
};

const brokenGit: ConfigGit = () =>
  Promise.resolve({ exitCode: 128, stderr: 'fatal: bad config line 1', stdout: '' });

// `level-0` includes `level-1` and so on, `levels` files deep.
const includeChain = async (dir: string, levels: number): Promise<Script> => {
  const chain = await Promise.all(
    Array.from({ length: levels }, (_unused, index) => touch(join(dir, `level-${String(index)}`))),
  );
  const links = [...chain.slice(1), join(dir, 'end')];
  const files = Object.fromEntries(
    chain.map((path, index) => [path, fileBody(`include.path\n${links[index]}`)]),
  );
  return {
    files,
    listing: listed(`file:${join(dir, 'gitconfig')}`, `include.path\n${join(dir, 'level-0')}`),
  };
};

describe('refusing to start git when an include cannot be read', () => {
  it('refuses an include it cannot read', async () => {
    expect.hasAssertions();
    const dir = await scratch();
    const locked = await touch(join(dir, 'locked'));
    const listing = listed(`file:${join(dir, 'gitconfig')}`, `include.path\n${locked}`);
    const { policy } = await run({ listing, unreadable: locked });
    refused(policy, /^refs did not start git: an include \(.*locked\) could not be read: fatal/u);
  });

  it('refuses an include under refs’ sources, present or not', async () => {
    expect.hasAssertions();
    const listing = listed('file:/u/.gitconfig', 'include.path\n/refs/sources/x/y.cfg');
    const { calls, policy } = await run({ listing }, { sourcesDir: '/refs/sources' });
    refused(policy, /an include \(.*y\.cfg\) lies under refs' sources/u);
    expect(calls).toHaveLength(1);
  });
});

describe('refusing to start git for an unusable configuration', () => {
  it('refuses a label a -c option cannot name', async () => {
    expect.hasAssertions();
    const { policy } = await run({ listing: listed('file:/u/.gitconfig', 'hook.a=b.command\nx') });
    refused(policy, /the hook label "a=b" contains '='/u);
  });

  it('refuses when git cannot list its configuration', async () => {
    expect.hasAssertions();
    const policy = await hookLabelPolicy(V255, {
      git: brokenGit,
      home: '/h',
      sourcesDir: undefined,
    });
    refused(policy, /git could not list its configuration: fatal: bad config line 1/u);
  });

  it('refuses an include chain deeper than git follows', async () => {
    expect.hasAssertions();
    const dir = await scratch();
    const { policy } = await run(await includeChain(dir, CHAIN_DEEPER_THAN_GIT));
    refused(policy, /the include graph is deeper or wider than refs follows/u);
  });
});
