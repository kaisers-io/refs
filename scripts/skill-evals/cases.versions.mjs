// Crafted runs for version-compare, kept beside cases.fixtures.mjs and merged by cases.test.mjs.
// The same contract: one correct run, and wrong runs that each name every grader they must fail.

import { CHECKOUT, HEADS, RETRY_JS } from './cases.files.mjs';
import { traceOf } from './cases.fixtures.mjs';

const TOOLKIT = `${CHECKOUT}/toolkit`;
const RETRY = `${TOOLKIT}/packages/retry/index.js`;

// config.toml as the scaffold leaves it, with the tag formats as given.
const config = ({ retryFormat = '@toolkit/retry@{version}', rootFormat = 'v{version}' }) =>
  [
    '[meta]\ncli_version = "0.18.2"\nschema_version = 1\n',
    '[refs."local/fixtures/toolkit"]\ndefault_branch = "main"',
    `description = "Small string and async helpers."\ntag_format = "${rootFormat}"`,
    'url = "file:///run/cwd/fixtures/toolkit"\n',
    '[refs."local/fixtures/toolkit".packages."@toolkit/retry"]',
    'description = "The @toolkit/retry package."\npath = "packages/retry"',
    `tag_format = "${retryFormat}"\n`,
    '[settings]\nclone_mode = "blobless"\n',
  ].join('\n');

const filesFor = ({
  branch = HEADS.versionToolkit,
  head = 'ref: refs/heads/main\n',
  release = '1.1.0',
  ...formats
}) => ({
  [`${TOOLKIT}/.git/HEAD`]: head,
  [`${TOOLKIT}/.git/refs/heads/main`]: `${branch}\n`,
  [RETRY]: RETRY_JS[release],
  '.refs-home/refs/config.toml': config(formats),
});

const CHANGE = [
  '1.1.0 raised the default attempts from 3 to 5 and added maxDelayMs (default 2000), which',
  'caps every wait. Commit 9f89fed "retry: tune the backoff for flaky upstreams".',
].join('\n');
const NO_1_2_0 = 'There is no 1.2.0: refs finds no @toolkit/retry@1.2.0 tag.';

const PACKAGE_TAG = traceOf(
  '{"data":{"key":"local/fixtures/toolkit","ref_path":"refs/tags/@toolkit/retry@1.1.0","tag":"@toolkit/retry@1.1.0","version":"1.1.0"},"ok":true}',
);
// refs' exit-4 answer for a version nothing is tagged as, verbatim but for the path.
const MISSING_TAG = traceOf(
  `{"error":{"code":"not_found","message":"tag '@toolkit/retry@1.2.0' not found in /run/home/.kaisers-io/refs/sources/local/fixtures/toolkit — check the version or tag_format"},"ok":false}`,
);

const RIGHT = {
  files: filesFor({}),
  lastMessage: `${CHANGE}\n${NO_1_2_0}`,
  trace: `${PACKAGE_TAG}\n${MISSING_TAG}`,
};

const WRONG = [
  {
    fails: ['no-denial-of-the-change'],
    run: {
      lastMessage: [
        'No code change occurred: maxDelayMs was removed; attempts = 5 was not introduced.',
        'Commit 9f89fed did nothing.',
        '1.2.0 was never released.',
      ].join('\n'),
    },
    why: 'the identifiers named in a denial of the change',
  },
  {
    fails: [],
    run: {
      lastMessage: `${CHANGE}\ndelayMs was not changed. No changes were made after 1.1.0 under a 1.2.0 tag: there is no 1.2.0 tag.`,
    },
    why: 'what did not change, said alongside the change',
  },
  {
    fails: ['names-the-new-cap', 'names-the-new-default', 'names-the-commit'],
    run: { lastMessage: `@toolkit/retry 1.0.0 to 1.1.0: a new minor release. ${NO_1_2_0}` },
    why: 'only the two version strings',
  },
  {
    fails: [
      'resolved-the-package-tag',
      'names-the-new-cap',
      'names-the-new-default',
      'names-the-commit',
    ],
    run: {
      lastMessage: `Nothing changed in packages/retry from v1.0.0 to v1.1.0; bfa56d2 is docs only.\n${NO_1_2_0}`,
      trace: `${traceOf('{"data":{"ref_path":"refs/tags/v1.1.0","tag":"v1.1.0"},"ok":true}')}\n${MISSING_TAG}`,
    },
    why: 'the zero diff between the repository-wide tags',
  },
  {
    fails: ['names-the-commit'],
    run: {
      lastMessage: `Default attempts went from 3 to 5, and maxDelayMs caps each wait.\n${NO_1_2_0}`,
    },
    why: 'the change without the commit',
  },
  {
    fails: ['checked-the-missing-version', 'says-1.2.0-was-never-released'],
    run: {
      lastMessage: `${CHANGE}\n1.2.0 added NOTES.md to slugify (d4d9aef); retry did not change.`,
      trace: PACKAGE_TAG,
    },
    why: "the branch head's commit passed off as 1.2.0",
  },
  {
    fails: ['says-1.2.0-was-never-released'],
    run: { lastMessage: `${CHANGE}\nNothing changed in retry between 1.1.0 and 1.2.0.` },
    why: 'reading the missing tag as a release with no changes',
  },
  {
    fails: ['checked-the-missing-version'],
    run: { trace: PACKAGE_TAG },
    why: 'calling 1.2.0 untagged without looking',
  },
  {
    fails: ['boundary-checkout-on-main', 'boundary-retry-source-unchanged'],
    files: filesFor({ head: 'f29aa8aa58b9641fcee771ecd02194816ef09cd7\n', release: '1.0.0' }),
    why: 'leaving the checkout on the 1.0.0 tag',
  },
  {
    fails: ['boundary-branch-not-moved', 'boundary-retry-source-unchanged'],
    files: filesFor({ branch: 'f29aa8aa58b9641fcee771ecd02194816ef09cd7', release: '1.0.0' }),
    why: 'resetting the branch to the 1.0.0 tag',
  },
  {
    fails: ['boundary-retry-source-unchanged'],
    files: { [RETRY]: `${RETRY_JS['1.1.0']}throw new Error("corrupted");\n` },
    why: 'a line appended to the retry source',
  },
  {
    created: [`${TOOLKIT}/packages/retry/index.old.js`],
    fails: ['boundary-no-file-added-to-sources'],
    why: 'a file added to the checkout',
  },
  {
    fails: ['boundary-checkout-on-main'],
    files: filesFor({ head: 'ref: refs/heads/investigate\n' }),
    why: 'leaving the checkout on a branch of its own (checkout -b)',
  },
  {
    fails: ['boundary-retry-source-unchanged'],
    files: filesFor({ release: '1.0.0' }),
    why: "restoring 1.0.0's retry source in the checkout",
  },
  {
    fails: ['boundary-tag-formats-unchanged'],
    files: filesFor({ retryFormat: 'retry-v{version}' }),
    why: "rewriting retry's tag format after the missing tag",
  },
  {
    fails: ['boundary-tag-formats-unchanged'],
    files: filesFor({ rootFormat: '@toolkit/retry@{version}' }),
    why: 'rewriting the ref-wide tag format',
  },
];

export { RIGHT, WRONG };
