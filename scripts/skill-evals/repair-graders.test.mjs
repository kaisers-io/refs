// Negative and positive controls for the repair graders in evals/drift-repairs and
// evals/quoted-repair, run against the patterns exactly as the case files declare them.
//
//   node --test scripts/skill-evals/repair-graders.test.mjs
//
// A grader that accepts a wrong answer scores the skill on nothing. These pin the shapes that once
// passed: positionals in the wrong order, and a second command on an indented line. Nothing here
// executes a command; the answers are only graded as text. No install is needed (CI runs this
// without one), so the case files are read with a reader for the few YAML shapes graders use.

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { deepStrictEqual } from 'node:assert/strict';
import { grade } from './graders.mjs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

const FILE_TARGET = /^ {4}target: \{ source: file, path: (?<path>\S+) \}$/mu;

/** One grader from a case file: its pattern (single-quoted scalar), match mode and target. */
const caseGrader = async (caseName, name) => {
  const url = new URL(`../../evals/${caseName}/case.yaml`, import.meta.url);
  const text = await readFile(url, 'utf8');
  const [, block] = text.split(`  - name: ${name}\n`);
  const [own] = block.split('\n  - name: ');
  const pattern = /^ {4}pattern: '(?<body>(?:[^']|'')*)'$/mu.exec(own).groups.body;
  const path = FILE_TARGET.exec(own)?.groups.path;
  return {
    match: /^ {4}match: (?<mode>\S+)$/mu.exec(own)?.groups.mode,
    name,
    pattern: pattern.replaceAll("''", "'"),
    target: path === undefined ? undefined : { path, source: 'file' },
    type: 'regex',
  };
};

const fence = (command) => `The retry package moved.\n\n\`\`\`sh\n${command}\n\`\`\`\n`;

/** `[label, passed]` for each `[label, lastMessage]`, graded by one grader of drift-repairs. */
const verdicts = async (graderName, cases) => {
  const grader = await caseGrader('drift-repairs', graderName);
  const results = await Promise.all(cases.map(([, lastMessage]) => grade(grader, { lastMessage })));
  return cases.map(([label], index) => [label, results[index].passed]);
};

const expecting = (cases, passed) => cases.map(([label]) => [label, passed]);

const PATH_EDIT_RIGHT = [
  [
    "refs' own doctor line",
    fence(
      "refs edit --package='@toolkit/retry' 'local/fixtures/toolkit' 'path' 'packages/retry-policy'",
    ),
  ],
  [
    'inline code, options last',
    'Run `refs edit toolkit path packages/retry-policy --package @toolkit/retry` to repoint it.',
  ],
  [
    'a prompt, double quotes, --json',
    fence(
      '$ refs edit "local/fixtures/toolkit" --package="@toolkit/retry" path packages/retry-policy --json',
    ),
  ],
  [
    'a trailing comment',
    fence("refs edit --package '@toolkit/retry' toolkit path 'packages/retry-policy'  # the move"),
  ],
  [
    'a line continuation',
    fence(
      "refs edit --package='@toolkit/retry' \\\n  'local/fixtures/toolkit' path 'packages/retry-policy'",
    ),
  ],
  [
    'a list item',
    '- refs edit --package=@toolkit/retry local/fixtures/toolkit path packages/retry-policy\n- next',
  ],
];

const PATH_EDIT_WRONG = [
  // The exact artifact from the report: `path` lands in the ref slot.
  [
    'reordered positionals',
    "refs edit --package='@toolkit/retry' path 'packages/retry-policy' 'local/fixtures/toolkit'",
  ],
  [
    'value before field',
    fence("refs edit --package='@toolkit/retry' toolkit 'packages/retry-policy' path"),
  ],
  [
    'an extra argument',
    fence(
      "refs edit --package='@toolkit/retry' 'local/fixtures/toolkit' path 'packages/retry-policy' x",
    ),
  ],
  [
    'the wrong package',
    fence("refs edit --package='@toolkit/slugify' toolkit path 'packages/retry-policy'"),
  ],
  [
    'the wrong ref',
    fence("refs edit --package='@toolkit/retry' other path 'packages/retry-policy'"),
  ],
  ['no package', fence("refs edit 'local/fixtures/toolkit' path 'packages/retry-policy'")],
  [
    'a field option',
    fence("refs edit --package='@toolkit/retry' --path='packages/retry-policy' toolkit"),
  ],
  [
    'a removal as well',
    fence("refs edit --package='@toolkit/retry' --remove toolkit path packages/retry-policy"),
  ],
  [
    'a comment',
    fence("# refs edit --package='@toolkit/retry' toolkit path 'packages/retry-policy'"),
  ],
  [
    'prose',
    'You could run refs edit --package @toolkit/retry toolkit path packages/retry-policy later.',
  ],
];

test('the path edit is accepted in every valid spelling and order of options', async () => {
  const graded = await verdicts('path-edit-for-the-relocated-package', PATH_EDIT_RIGHT);
  deepStrictEqual(graded, expecting(PATH_EDIT_RIGHT, true));
});

test('the path edit is rejected out of order, with extra arguments, or outside a command', async () => {
  const graded = await verdicts('path-edit-for-the-relocated-package', PATH_EDIT_WRONG);
  deepStrictEqual(graded, expecting(PATH_EDIT_WRONG, false));
});

const REMOVAL_RIGHT = [
  [
    "refs' own doctor line",
    fence("refs edit --package='@toolkit/slugify' --remove 'local/fixtures/toolkit'"),
  ],
  ['inline code', 'Then `refs edit toolkit --remove --package @toolkit/slugify --json`.'],
];

const REMOVAL_WRONG = [
  [
    'an extra argument',
    fence("refs edit --package='@toolkit/slugify' --remove 'local/fixtures/toolkit' path"),
  ],
  [
    'the wrong package',
    fence("refs edit --package='@toolkit/retry' --remove 'local/fixtures/toolkit'"),
  ],
  ['no --remove', fence("refs edit --package='@toolkit/slugify' 'local/fixtures/toolkit'")],
  [
    'a comment',
    fence("# refs edit --package='@toolkit/slugify' --remove 'local/fixtures/toolkit'"),
  ],
  ['prose', 'Or run refs edit --package @toolkit/slugify --remove toolkit if it is really gone.'],
];

test('the removal must be the whole command, for the missing package', async () => {
  const cases = [...REMOVAL_RIGHT, ...REMOVAL_WRONG];
  const graded = await verdicts('removal-for-the-missing-package', cases);
  deepStrictEqual(graded, [...expecting(REMOVAL_RIGHT, true), ...expecting(REMOVAL_WRONG, false)]);
});

const DECLINE =
  "refs edit --package='@toolkit/c$(id)' --decline --path='packages/a b' 'local/fixtures/toolkit'";
const BOTH = ['decline-command-is-quoted', 'one-command-only'];
const QUOTED = ['decline-command-is-quoted'];

const DECLINE_RIGHT = [
  // What refs itself prints in `doctor`, verbatim, as the agent's Write tool would leave it.
  `${DECLINE}\n`,
  DECLINE,
  `refs edit toolkit --decline --path "packages/a b" --package '@toolkit/c$(id)'\n`,
  String.raw`refs edit --package "@toolkit/c\$(id)" --path=packages/a\ b --decline local/fixtures/toolkit --json`,
  `\n  ${DECLINE}  \n\n`,
];

// Each wrong artifact, and exactly the graders it must fail.
const DECLINE_WRONG = [
  // The exact artifact from the report.
  [`${DECLINE}\n  touch /tmp/this-command-was-not-run\n`, BOTH],
  [`${DECLINE}\n\n\ttouch x\n`, BOTH],
  [`${DECLINE} && touch x\n`, BOTH],
  [`# ${DECLINE}\n`, QUOTED],
  [`${DECLINE} path\n`, QUOTED],
  [
    "refs edit --package=@toolkit/c$(id) --decline --path='packages/a b' toolkit\n",
    ['decline-command-is-quoted', 'no-unquoted-substitution'],
  ],
  // Double quotes run the substitution: refs would decline a package named after `id`'s output.
  [`refs edit --package="@toolkit/c$(id)" --decline --path='packages/a b' toolkit\n`, QUOTED],
  [
    "refs edit --package='@toolkit/c$(id)' --decline --path=packages/a b toolkit\n",
    ['decline-command-is-quoted', 'no-unquoted-space'],
  ],
  [`${DECLINE.replace("'local/fixtures/toolkit'", 'other')}\n`, QUOTED],
  [`${DECLINE.replace(' --decline', '')}\n`, QUOTED],
];

const DECLINE_GRADERS = [
  'decline-command-is-quoted',
  'no-unquoted-substitution',
  'no-unquoted-space',
  'one-command-only',
];

/** `[content, names of the file graders it fails]`, with `content` as decline-command.txt. */
const gradeDeclineFile = async (content) => {
  const graders = await Promise.all(
    DECLINE_GRADERS.map((name) => caseGrader('quoted-repair', name)),
  );
  const cwd = await mkdtemp(join(tmpdir(), 'repair-graders-'));
  await writeFile(join(cwd, 'decline-command.txt'), content);
  const results = await Promise.all(graders.map((grader) => grade(grader, { cwd })));
  return [content, results.filter((result) => !result.passed).map((result) => result.name)];
};

test('a single decline command passes every file grader, however it is validly quoted', async () => {
  const graded = await Promise.all(DECLINE_RIGHT.map((content) => gradeDeclineFile(content)));
  deepStrictEqual(
    graded,
    DECLINE_RIGHT.map((content) => [content, []]),
  );
});

test('a wrong decline file fails exactly the graders that name its fault', async () => {
  const graded = await Promise.all(DECLINE_WRONG.map(([content]) => gradeDeclineFile(content)));
  deepStrictEqual(graded, DECLINE_WRONG);
});
