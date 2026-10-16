// Tests for the repair-command graders in evals/drift-repairs and evals/quoted-repair.
//
//   node --test scripts/skill-evals/repair-graders.test.mjs
//
// The patterns are read from the case files themselves, so what is pinned here is what both eval
// runners (Codex through graders.mjs, Claude through `claude plugin eval`) grade with. The negative
// controls are commands refs rejects or that are not one command: they must FAIL their grader.

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { grade } from './graders.mjs';
import { graderFrom } from './case-graders.mjs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

const inReply = async (grader, lastMessage) => {
  const result = await grade(grader, { commands: [], cwd: tmpdir(), lastMessage, trace: '' });
  return result.passed;
};

const inFile = async (grader, content) => {
  const cwd = await mkdtemp(join(tmpdir(), 'refs-grader-'));
  await writeFile(join(cwd, grader.target.path), content);
  const result = await grade(grader, { commands: [], cwd, lastMessage: '', trace: '' });
  return result.passed;
};

// The replies whose grade is not `expected`, so a failure names them.
const failingOf = async (grader, replies, expected) => {
  const grades = await Promise.all(replies.map((reply) => inReply(grader, reply)));
  return replies.filter((_reply, index) => grades[index] !== expected);
};

const PATH_EDIT_GOOD = [
  "refs edit 'local/fixtures/toolkit' --package='@toolkit/retry' path 'packages/retry-policy'",
  'refs edit toolkit --package=@toolkit/retry path packages/retry-policy --json',
  "Run `refs edit --package '@toolkit/retry' toolkit path packages/retry-policy` to move it.",
  "```sh\n$ refs edit toolkit path 'packages/retry-policy' --package='@toolkit/retry'\n```",
  String.raw`refs edit toolkit --package='@toolkit/retry' path 'packages/retry-policy' --description='it'\''s $(x) a b'`,
];

const PATH_EDIT_BAD = [
  // The ref after the field pair: refs reads `path` as the ref and exits 4.
  "refs edit --package='@toolkit/retry' path 'packages/retry-policy' 'local/fixtures/toolkit'",
  "refs edit other --package='@toolkit/retry' path 'packages/retry-policy'",
  "refs edit toolkit --package='@toolkit/retry' path 'packages/retry-policy' extra",
  "# refs edit toolkit --package='@toolkit/retry' path 'packages/retry-policy'",
  "refs edit toolkit --package='@toolkit/other' path 'packages/retry-policy'",
  "refs edit toolkit --package='@toolkit/retry' --path='packages/retry-policy'",
];

test('the path-edit grader accepts the command in any option order and quoting', async () => {
  const grader = await graderFrom('drift-repairs', 'path-edit-for-the-relocated-package');
  deepStrictEqual(await failingOf(grader, PATH_EDIT_GOOD, true), []);
});

test('the path-edit grader fails commands refs rejects or that edit something else', async () => {
  const grader = await graderFrom('drift-repairs', 'path-edit-for-the-relocated-package');
  deepStrictEqual(await failingOf(grader, PATH_EDIT_BAD, false), []);
});

test('the removal grader wants the ref as the only positional', async () => {
  const grader = await graderFrom('drift-repairs', 'removal-for-the-missing-package');
  strictEqual(await inReply(grader, 'refs edit toolkit --package=@toolkit/slugify --remove'), true);
  const reordered = "refs edit --remove --package='@toolkit/slugify' 'local/fixtures/toolkit' --json";
  strictEqual(await inReply(grader, reordered), true);
  const extra = "refs edit --package='@toolkit/slugify' --remove toolkit extra";
  strictEqual(await inReply(grader, extra), false);
  const wrongRef = 'refs edit other toolkit --package=@toolkit/slugify --remove';
  strictEqual(await inReply(grader, wrongRef), false);
});

const DECLINE = "refs edit --package='@toolkit/c$(id)' --decline --path='packages/a b' 'local/fixtures/toolkit'";

test('the decline grader keeps quoted spaces and $() and refuses an extra argument', async () => {
  const grader = await graderFrom('quoted-repair', 'decline-command-is-quoted');
  strictEqual(await inFile(grader, `${DECLINE}\n`), true);
  const spaced = "refs edit toolkit --decline --package '@toolkit/c$(id)' --path 'packages/a b'";
  strictEqual(await inFile(grader, spaced), true);
  strictEqual(await inFile(grader, `${DECLINE} extra\n`), false);
  const unquoted = DECLINE.replace("'@toolkit/c$(id)'", "'@toolkit/c'$(id)");
  strictEqual(await inFile(grader, unquoted), false);
});

test('one-command-only fails any second non-blank line, indented or a comment', async () => {
  const grader = await graderFrom('quoted-repair', 'one-command-only');
  strictEqual(await inFile(grader, `${DECLINE}\n`), true);
  strictEqual(await inFile(grader, `\n  ${DECLINE}  \n\n`), true);
  strictEqual(await inFile(grader, `${DECLINE}\n  touch /tmp/pwned\n`), false);
  strictEqual(await inFile(grader, `${DECLINE}\n# decline it\n`), false);
  strictEqual(await inFile(grader, `${DECLINE} && echo done\n`), false);
});
