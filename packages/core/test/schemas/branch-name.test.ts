import { describe, expect, it } from 'vitest';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { isBranchName } from '../../src/schemas/branch-name.ts';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { zConfig } from '../../src/schemas/config.ts';

// `isBranchName` reimplements a rule that lives in git, so the thing worth asserting is not what it
// does — it is that it AGREES with git. Being stricter is the dangerous direction: the predicate
// guards `default_branch` in `zConfig`, which is read as well as written, so a rule tighter than
// git's would make an existing config unreadable rather than merely refuse a new ref.
//
// The comparison runs against the real `git check-ref-format --branch`, over names assembled from
// the pieces git's rules talk about rather than a handful chosen by hand. Measured while writing
// this: git reads the argument after `--branch` as a name even when it is shaped like one of its
// own flags (`--quiet` reports an invalid branch name rather than parsing a flag), so an
// option-shaped name is a fair comparison rather than an argument-parsing accident.

const SUCCESS = 0;
/** Enough combinations that a broken generator cannot pass by producing none. */
const CANDIDATE_FLOOR = 1000;
/** A literal NUL would be an invisible byte in this file. */
const NUL = String.fromCodePoint(0);
/** The pieces git's own rules are phrased in terms of, plus a few ordinary ones. */
const PIECES = [
  'a',
  'b',
  '.',
  '..',
  '/',
  '-',
  '@',
  '{',
  '}',
  '.lock',
  '~',
  '^',
  ':',
  '?',
  '*',
  '[',
  '\\',
  ' ',
  '\t',
  '\n',
  'é',
  '1',
  'HEAD',
  '@{',
];

/** Every one- and two-piece combination, plus the same with an `a` wedged in the middle — enough to
 * reach each rule from both ends without hand-picking the cases that happen to pass. */
const candidates = (): string[] => {
  const names = new Set(['main', 'HEAD', '@', 'a', '', 'feature/foo', 'refs/heads/x']);
  for (const left of PIECES) {
    names.add(left);
    for (const right of PIECES) {
      names.add(left + right);
      names.add(`${left}a${right}`);
      names.add(`a${left}${right}`);
    }
  }
  return [...names];
};

/** git's own answer, from a throwaway repository. */
const gitAccepts = async (runner: SpawnRunner, cwd: string, name: string): Promise<boolean> => {
  const result = await runner.run('git', ['check-ref-format', '--branch', name], { cwd });
  return result.exitCode === SUCCESS;
};

/** Every name where this repository's rule and git's disagree. Empty is the assertion. */
const disagreementsWithGit = async (names: readonly string[]): Promise<string[]> => {
  const runner = new SpawnRunner();
  const dir = await mkdtemp(join(tmpdir(), 'refs-branch-'));
  await runner.run('git', ['init', '-q', '.'], { cwd: dir });
  const found: string[] = [];
  for (const name of names) {
    // Serial on purpose: one `git` per name, and the point is the comparison rather than speed.
    // eslint-disable-next-line no-await-in-loop -- see above
    const fromGit = await gitAccepts(runner, dir, name);
    found.push(
      ...(fromGit === isBranchName(name)
        ? []
        : [`${JSON.stringify(name)}: git=${String(fromGit)}`]),
    );
  }
  return found;
};

describe('the branch-name rule, against git itself', () => {
  it(
    'gives the same answer as git check-ref-format --branch, for every candidate',
    async () => {
      expect.hasAssertions();
      const names = candidates();

      await expect(disagreementsWithGit(names)).resolves.toStrictEqual([]);
      // A guard on the comparison itself: a harness that silently generated nothing would also
      // report no disagreements.
      expect(names.length).toBeGreaterThan(CANDIDATE_FLOOR);
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('the branch name a real repository can supply', () => {
  it.each([
    ['a leading dash, which is how it reaches an argv unterminated', '--upload-pack=id'],
    ['a plain leading dash', '-main'],
    ['a space', 'my branch'],
    ['a control character', `a${NUL}b`],
    ['the reserved name', 'HEAD'],
    ['a component beginning with a dot', 'a/.b'],
    ['a trailing .lock', 'main.lock'],
  ])('is refused: %s', (_label, name) => {
    expect.hasAssertions();

    expect(isBranchName(name)).toBe(false);
  });

  it.each([
    ['an ordinary name', 'main'],
    ['a hierarchical one', 'feature/some-thing'],
    ['a version-shaped one', 'v1.0.0'],
    ['non-ASCII, which git allows', 'bäume'],
    ['an at sign inside', 'feat/a@b'],
  ])('is accepted: %s', (_label, name) => {
    expect.hasAssertions();

    expect(isBranchName(name)).toBe(true);
  });
});

/** A config that differs from a good one only in its branch name. */
const configWithBranch = (branch: string): unknown => ({
  meta: { cli_version: '0.17.0', schema_version: 1 },
  refs: {
    'example.com/o/r': {
      default_branch: branch,
      description: 'a ref',
      url: 'https://example.com/o/r.git',
    },
  },
  settings: { clone_mode: 'blobless', git_transport: 'https', sync_ttl: '1h' },
});

describe('the config schema', () => {
  it('refuses a default_branch git would not accept', () => {
    expect.hasAssertions();

    // The whole point of the rule: this value reaches refs from a real repository's own `HEAD`,
    // and before it was refused here it was stored and every later sync failed.
    expect(zConfig.safeParse(configWithBranch('--upload-pack=id')).success).toBe(false);
  });

  it('still accepts the ordinary ones, so an existing config keeps parsing', () => {
    expect.hasAssertions();

    // Being STRICTER than git is the dangerous direction — a config that parsed yesterday has to
    // parse today. These are the shapes real repositories use.
    for (const branch of ['main', 'master', 'develop', 'release/2.x', 'v1', 'trunk']) {
      expect(zConfig.safeParse(configWithBranch(branch)).success).toBe(true);
    }
  });
});
