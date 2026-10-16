import { checkoutRoot, git, regularText } from './behavior-files.mjs';
import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';

const verifyExcerpt = (expected, citation, source) => {
  const { start_line: start, end_line: end } = citation;
  const lines = source.split('\n');
  strictEqual(
    Number.isInteger(start) &&
      Number.isInteger(end) &&
      start > 0 &&
      end >= start &&
      end <= lines.length,
    true,
    'citation line range does not exist',
  );
  const excerpt = lines
    .slice(start - 1, end)
    .join('\n')
    .trim();
  strictEqual(citation.quote, excerpt, 'quoted evidence does not match cited source lines');
  strictEqual(
    excerpt.includes(expected.needle),
    true,
    'cited lines do not support the claimed fact',
  );
};

const verifyCitation = async (expected, citation, cwd) => {
  const root = await checkoutRoot(cwd, expected.repo);
  strictEqual(
    await realpath(resolve(cwd, citation.root)),
    root,
    'citation names the wrong checkout',
  );
  strictEqual(citation.path, expected.path, 'citation names the wrong source file');
  strictEqual(citation.revision, expected.revision, 'citation names the wrong revision');
  await regularText(join(root, expected.path));
  const source = await git(root, ['show', `${expected.revision}:${expected.path}`]);
  verifyExcerpt(expected, citation, source);
};

const verifyAnswer = async (spec, answer, cwd) => {
  deepStrictEqual(answer.facts, spec.facts, 'answer facts differ from the fixture behavior');
  strictEqual(answer.citations.length, spec.citations.length, 'all facts need their own evidence');
  await Promise.all(
    spec.citations.map(async (expected) => {
      const found = answer.citations.filter(({ id }) => id === expected.id);
      strictEqual(found.length, 1, `expected one citation for ${expected.id}`);
      await verifyCitation(expected, found[0], cwd);
    }),
  );
};

const verifyDiff = async (root, { before, after, path }) => {
  const diff = await git(root, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    before,
    after,
    '--',
    path,
  ]);
  strictEqual(diff.includes('-export const retryDelay = (attempt, delayMs = 100)'), true);
  strictEqual(diff.includes('+export const retryDelay = (attempt, delayMs = 250)'), true);
};

const verifyHistory = async (expected, answer, cwd) => {
  const { repo, before_revision: beforeRevision, ...fields } = expected;
  deepStrictEqual(answer.history, fields, 'history must identify the actual change and tags');
  const root = await checkoutRoot(cwd, repo);
  const [before, after, later] = await Promise.all(
    [fields.from_tag, fields.to_tag, fields.later_tag].map((tag) =>
      git(root, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]),
    ),
  );
  strictEqual(before, beforeRevision, 'starting release tag does not match its cited revision');
  strictEqual(after, fields.commit, 'release tag does not name the expected change');
  strictEqual(later, after, 'the misleading release tag must be verified as zero-diff');
  const history = await git(root, ['log', '--format=%H', `${before}..${after}`, '--', fields.path]);
  strictEqual(
    history.split('\n').includes(fields.commit),
    true,
    'the cited commit is absent from scoped history',
  );
  await verifyDiff(root, { after, before, path: fields.path });
};

export { verifyAnswer, verifyHistory };
