import { addCommit, createFixtureRepo } from '../helpers/fixture-repo.ts';
import { changelogAtTag, extractChangelogExcerpt } from '../../src/git/changelog.ts';
import {
  countRangeCommits,
  listRangeCommits,
  rangeNameStatus,
  rangeShortstat,
  showFileAtTag,
} from '../../src/git/range.ts';
import { describe, expect, it } from 'vitest';
import { SpawnRunner } from '../../src/proc/runner.ts';

// Integration suite for the bounded range queries (git/range.ts) and the changelog excerpt
// helpers (git/changelog.ts), against one shared real git fixture: `v1.0.0` on the initial
// commit, then a CHANGELOG.md commit, a feature.txt commit, and a commit adding a file whose
// name embeds a literal TAB (legal on APFS/POSIX — pins the NUL-delimited `--name-status -z`
// parsing), then `v2.0.0` — so `v1.0.0..v2.0.0` spans exactly three commits with three added
// files. The fixture is built once at module load and shared read-only across every case (all
// queries here are read-only by design).

const runner = new SpawnRunner();

// Real git work under parallel suite load can exceed vitest's 5s default — mirrors
// `git/repo.test.ts`'s `SUITE_OPTS` idiom.
const TEST_TIMEOUT_MS = 30_000;
const SUITE_OPTS = { timeout: TEST_TIMEOUT_MS };

const OLD_TAG = 'v1.0.0';
const NEW_TAG = 'v2.0.0';
const BOUNDS = { newTag: NEW_TAG, oldTag: OLD_TAG };
const RANGE_COMMITS = 3;
const TAB_FILE = 'ta\tb.txt';
const SINGLE = 1;
const NONE = 0;
const WIDE_LIMIT = 200;
const MAX_CHARS = 4000;
const TINY_CAP = 10;
const SUCCESS_EXIT_CODE = 0;

const CHANGELOG = [
  '# Changelog',
  '',
  '## 2.0.0',
  '',
  '- Added feature X',
  '',
  '## 1.0.0',
  '',
  '- Initial release',
  '',
].join('\n');

const gitTag = async (dir: string, tag: string): Promise<void> => {
  const result = await runner.run('git', ['tag', tag], { cwd: dir });
  if (result.exitCode !== SUCCESS_EXIT_CODE) {
    throw new Error(`test setup: git tag ${tag} failed: ${result.stderr}`);
  }
};

const buildRangeFixture = async (): Promise<string> => {
  const fixture = await createFixtureRepo({ tags: [OLD_TAG] });
  await addCommit(fixture.dir, 'CHANGELOG.md', CHANGELOG);
  await addCommit(fixture.dir, 'feature.txt', 'feature\n');
  await addCommit(fixture.dir, TAB_FILE, 'tabbed\n');
  await gitTag(fixture.dir, NEW_TAG);
  return fixture.dir;
};

// Built once at module load (top-level await) and shared read-only by every git-backed case
// below — each query under test only ever reads from the fixture, so sharing is safe and keeps
// the suite from rebuilding an identical repo per test.
const fixtureDir = await buildRangeFixture();

describe('countRangeCommits() / listRangeCommits()', SUITE_OPTS, () => {
  it('counts every non-merge commit in the range', async () => {
    expect.hasAssertions();
    await expect(countRangeCommits(runner, fixtureDir, BOUNDS)).resolves.toBe(RANGE_COMMITS);
  });

  it('counts an empty range (tag..same-tag) as zero', async () => {
    expect.hasAssertions();
    const emptyBounds = { newTag: OLD_TAG, oldTag: OLD_TAG };
    await expect(countRangeCommits(runner, fixtureDir, emptyBounds)).resolves.toBe(NONE);
    await expect(
      listRangeCommits(runner, fixtureDir, { ...emptyBounds, limit: WIDE_LIMIT }),
    ).resolves.toStrictEqual([]);
  });

  it('lists commits newest first with sha/date/subject fields', async () => {
    expect.hasAssertions();
    const commits = await listRangeCommits(runner, fixtureDir, { ...BOUNDS, limit: WIDE_LIMIT });
    expect(commits.map((commit) => commit.subject)).toStrictEqual([
      `update ${TAB_FILE}`,
      'update feature.txt',
      'update CHANGELOG.md',
    ]);
    for (const commit of commits) {
      expect(commit.sha).toMatch(/^[0-9a-f]{7,}$/u);
      expect(commit.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    }
  });

  it('bounds the list to the given limit', async () => {
    expect.hasAssertions();
    const commits = await listRangeCommits(runner, fixtureDir, { ...BOUNDS, limit: SINGLE });
    expect(commits.map((commit) => commit.subject)).toStrictEqual([`update ${TAB_FILE}`]);
  });
});

describe('rangeShortstat()', SUITE_OPTS, () => {
  it('parses files/insertions/deletions for the whole range', async () => {
    expect.hasAssertions();
    const stat = await rangeShortstat(runner, fixtureDir, BOUNDS);
    expect(stat.files_changed).toBe(RANGE_COMMITS);
    expect(stat.insertions).toBeGreaterThan(NONE);
    expect(stat.deletions).toBe(NONE);
  });

  it('scopes to a path and returns all-zero for an empty diff', async () => {
    expect.hasAssertions();
    const scoped = await rangeShortstat(runner, fixtureDir, {
      ...BOUNDS,
      pathScope: 'feature.txt',
    });
    expect(scoped.files_changed).toBe(SINGLE);
    const empty = await rangeShortstat(runner, fixtureDir, { ...BOUNDS, pathScope: 'no-such-dir' });
    expect(empty).toStrictEqual({ deletions: NONE, files_changed: NONE, insertions: NONE });
  });
});

describe('rangeNameStatus()', SUITE_OPTS, () => {
  it('reports changed paths with statuses, untruncated under the limit', async () => {
    expect.hasAssertions();
    const result = await rangeNameStatus(runner, fixtureDir, { ...BOUNDS, limit: WIDE_LIMIT });
    expect(result.truncated).toBe(false);
    // The TAB-in-name entry comes back verbatim — `-z` NUL parsing, no C-quoting.
    expect(result.paths).toStrictEqual([
      { path: 'CHANGELOG.md', status: 'A' },
      { path: 'feature.txt', status: 'A' },
      { path: TAB_FILE, status: 'A' },
    ]);
  });

  it('bounds the list and flags truncation when more paths exist', async () => {
    expect.hasAssertions();
    const result = await rangeNameStatus(runner, fixtureDir, { ...BOUNDS, limit: SINGLE });
    expect(result.paths).toHaveLength(SINGLE);
    expect(result.truncated).toBe(true);
  });
});

describe('showFileAtTag()', SUITE_OPTS, () => {
  it('reads the file content as committed at the tag', async () => {
    expect.hasAssertions();
    const content = await showFileAtTag(runner, fixtureDir, { path: 'CHANGELOG.md', tag: NEW_TAG });
    expect(content).toBe(CHANGELOG);
  });

  it('returns undefined when the file does not exist at that tag', async () => {
    expect.hasAssertions();
    // CHANGELOG.md was only committed AFTER v1.0.0 — absent at the old tag, present at the new.
    await expect(
      showFileAtTag(runner, fixtureDir, { path: 'CHANGELOG.md', tag: OLD_TAG }),
    ).resolves.toBeUndefined();
    await expect(
      showFileAtTag(runner, fixtureDir, { path: 'nope.md', tag: NEW_TAG }),
    ).resolves.toBeUndefined();
  });
});

describe('extractChangelogExcerpt()', () => {
  it('slices from the new-version heading up to the old-version heading', () => {
    expect.hasAssertions();
    const result = extractChangelogExcerpt(CHANGELOG, {
      maxChars: MAX_CHARS,
      newVersion: '2.0.0',
      oldVersion: '1.0.0',
    });
    expect(result?.truncated).toBe(false);
    expect(result?.excerpt).toContain('## 2.0.0');
    expect(result?.excerpt).toContain('Added feature X');
    expect(result?.excerpt).not.toContain('Initial release');
  });

  it('slices to end-of-file when the old-version heading is absent', () => {
    expect.hasAssertions();
    const result = extractChangelogExcerpt(CHANGELOG, {
      maxChars: MAX_CHARS,
      newVersion: '2.0.0',
      oldVersion: '9.9.9',
    });
    expect(result?.truncated).toBe(false);
    expect(result?.excerpt).toContain('Initial release');
  });

  it('applies the char cap and flags truncation', () => {
    expect.hasAssertions();
    const result = extractChangelogExcerpt(CHANGELOG, {
      maxChars: TINY_CAP,
      newVersion: '2.0.0',
      oldVersion: '1.0.0',
    });
    expect(result?.truncated).toBe(true);
    expect(result?.excerpt).toHaveLength(TINY_CAP);
  });

  it('returns undefined (never the whole file) when no heading mentions the new version', () => {
    expect.hasAssertions();
    const result = extractChangelogExcerpt(CHANGELOG, {
      maxChars: MAX_CHARS,
      newVersion: '9.9.9',
      oldVersion: '1.0.0',
    });
    expect(result).toBeUndefined();
  });
});

describe('changelogAtTag()', SUITE_OPTS, () => {
  it('falls back from a missing package CHANGELOG to the repo root one', async () => {
    expect.hasAssertions();
    const result = await changelogAtTag(runner, fixtureDir, {
      maxChars: MAX_CHARS,
      newTag: NEW_TAG,
      newVersion: '2.0.0',
      oldVersion: '1.0.0',
      packagePath: 'packages/none',
    });
    expect(result?.excerpt).toContain('Added feature X');
  });

  it('returns undefined when no candidate CHANGELOG exists at the tag', async () => {
    expect.hasAssertions();
    const result = await changelogAtTag(runner, fixtureDir, {
      maxChars: MAX_CHARS,
      // At the OLD tag no CHANGELOG.md was committed yet — both candidates miss.
      newTag: OLD_TAG,
      newVersion: '1.0.0',
      oldVersion: '0.0.1',
    });
    expect(result).toBeUndefined();
  });
});
