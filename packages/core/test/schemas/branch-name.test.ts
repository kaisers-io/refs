import { describe, expect, it } from 'vitest';
import { join, sep } from 'node:path';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { isBranchName } from '../../src/schemas/branch-name.ts';
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
const CANDIDATE_FLOOR = 900;
/** The ranges where the rule turns, rather than every codepoint: one git invocation per name, and
 * the boundaries are where a wrong rule shows. `0x01-0x30` covers the ASCII controls, space and the
 * punctuation git reserves; `0x7e-0xa1` covers DEL and the start of the C1 block, which is exactly
 * where `\p{Cc}` was wrong; `0x9e-0xff` covers the rest of C1 and the first accented letters.
 * NUL is excluded — argv cannot carry it, so git cannot be asked and it is asserted separately. */
// The boundaries the rule turns on, named one by one: one git invocation per name, so sweeping
// every codepoint costs real time while the boundaries are where a wrong rule shows.
/** U+0001, the first codepoint argv can carry: NUL cannot be passed, so git cannot be asked. */
const FIRST_PASSABLE = 1;
/** U+0030, past space and the punctuation git reserves. */
const END_OF_ASCII_PUNCTUATION = 48;
/** U+007F, DEL. */
const DEL = 127;
/** U+00A1, into the C1 block — exactly where the rule was wrong. */
const INTO_C1 = 161;
/** U+009E, the rest of C1. */
const LATE_C1 = 158;
/** U+00FF, the first accented letters, which git accepts. */
const END_OF_LATIN1 = 255;

const SWEEP_RANGES: readonly (readonly [number, number])[] = [
  [FIRST_PASSABLE, END_OF_ASCII_PUNCTUATION],
  [DEL, INTO_C1],
  [LATE_C1, END_OF_LATIN1],
];
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

/** Every one- and two-piece combination, plus the same with an `a` wedged in the middle — enough
 * to reach each rule from both ends without hand-picking the cases that happen to pass. */
const pairsWith = (left: string): string[] =>
  PIECES.flatMap((right) => [left + right, `${left}a${right}`, `a${left}${right}`]);

const pieceCombinations = (): string[] => [...PIECES, ...PIECES.flatMap((left) => pairsWith(left))];

/** A sweep, because the combinations cannot reach a character no piece contains. That gap hid a
 * real defect: the rule was written with `\p{Cc}`, which rejects the 32 C1 controls (U+0080-U+009F)
 * that git ACCEPTS, and no generated pair could tell. */
const sweepNames = (): string[] =>
  SWEEP_RANGES.flatMap(([from, to]) =>
    Array.from({ length: to - from + 1 }, (_unused, offset) =>
      String.fromCodePoint(from + offset),
    ).flatMap((char) => [`topic${char}x`, `${char}topic`, `topic${char}`]),
  );

/** The `.lock` and leading-dot rules are per-COMPONENT, and a rule applied to the whole name
 * instead passed every generated case — so the components are spelled out. */
const STRUCTURAL = ['a.lock/b', 'a/.b/c', 'a./b', 'a/b.lock', 'x/a.lock', '.lock'];

const candidates = (): string[] => [
  ...new Set([
    'main',
    'HEAD',
    '@',
    'a',
    '',
    'feature/foo',
    'refs/heads/x',
    ...pieceCombinations(),
    ...sweepNames(),
    ...STRUCTURAL,
  ]),
];

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

// POSIX only, for cost rather than for correctness: the rule is git's and does not vary by
// platform, and one `git` process per name is an order of magnitude slower on Windows — the same
// corpus that takes ~28s on macOS ran past a 60s timeout there. It is compared against real git on
// Linux and macOS, which is what the claim needs.
describe.skipIf(sep === '\\')('the branch-name rule, against git itself', () => {
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

describe('a config recorded before the rule existed', () => {
  it('still parses, because the read path has to stay permissive', () => {
    expect.hasAssertions();

    // Deliberately NOT refused here. `readConfig` parses the whole document, and `edit` and
    // `remove` both read it before they can change anything — so refusing an old entry would turn
    // one unusable ref into an unusable home, with no way left to repair it. The entry points
    // refuse a NEW bad value instead; this one stays reachable so it can be removed.
    expect(zConfig.safeParse(configWithBranch('--upload-pack=id')).success).toBe(true);
  });

  it('parses beside an ordinary ref, which must not be taken down with it', () => {
    expect.hasAssertions();

    const config = configWithBranch('--upload-pack=id') as {
      refs: Record<string, unknown>;
    };
    config.refs['example.com/o/fine'] = {
      default_branch: 'main',
      description: 'an ordinary ref',
      url: 'https://example.com/o/fine.git',
    };

    expect(zConfig.safeParse(config).success).toBe(true);
  });
});
