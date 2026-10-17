// Tests for scripts/audit-lockfile.mjs.
//
//   node --test scripts/audit-lockfile.test.mjs     after `pnpm install` (the script needs `yaml`)
//
// The script is driven as a process, as CI runs it: from a throwaway workspace holding a fixture
// lockfile, with a fake `pnpm` first on PATH that prints a canned `pnpm audit --json` report. The
// reports are shaped like real pnpm 12 output. POSIX only: the fake is a shell script, and the
// workflow that runs this suite is Linux.

import { after, test } from 'node:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { match, strictEqual } from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const SCRIPT = fileURLToPath(new URL('audit-lockfile.mjs', import.meta.url));
const EXIT_OK = 0;
const EXIT_ADVISORIES = 1;
const EXIT_COVERAGE = 2;
const EXIT_INCOMPLETE = 3;
const EXECUTABLE = 0o755;
const TWO_MIB = 2_097_152;

// The pnpm 12 shape: a first document with only the package manager's own packages, then the
// project's. `shared@1.0.0` sits in both, which the auditor counts once.
const LOCKFILE = `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.11.2
        version: 12.11.2

packages:

  '@pnpm/exe@12.11.2':
    resolution: {integrity: sha512-a}

  shared@1.0.0:
    resolution: {integrity: sha512-b}

---
lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      minimatch:
        specifier: 10.0.0
        version: 10.0.0

packages:

  minimatch@10.0.0:
    resolution: {integrity: sha512-c}

  brace-expansion@5.0.12:
    resolution: {integrity: sha512-d}

  shared@1.0.0:
    resolution: {integrity: sha512-b}

  local@file:local:
    resolution: {directory: local, type: directory}

  ms@git+https://example.test/ms.git#1c6264b:
    resolution: {commit: 1c6264b, repo: 'https://example.test/ms.git', type: git}
`;
// Distinct registry packages across both documents: what pnpm 12.11.2 itself reports for this shape,
// since it skips the git and directory entries and counts `shared` once.
const PACKAGES = 4;
// What a scanner that stops at the first document would report.
const FIRST_DOCUMENT_ONLY = 2;
// pnpm also counts some entries that are not registry packages, such as `node@runtime:`.
const MORE_THAN_REGISTRY = 5;
const IGNORED_MODERATE = 2;
const IGNORED_HIGH = 3;

const severities = (moderate) => ({ critical: 0, high: 0, info: 0, low: 0, moderate });

const clean = (total) => ({
  advisories: {},
  metadata: { totalDependencies: total, vulnerabilities: severities(0) },
});

const advisory = {
  advisories: {
    1: {
      findings: [{ paths: ['.>minimatch>brace-expansion'], version: '5.0.11' }],
      module_name: 'brace-expansion',
      severity: 'moderate',
      title: 'Unbounded recursion',
      url: 'https://github.com/advisories/GHSA-0000-0000-0000',
    },
  },
  metadata: { totalDependencies: PACKAGES, vulnerabilities: severities(1) },
};

const roots = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
});

// `pnpm: false` leaves pnpm off PATH entirely; node itself is spawned by absolute path.
// A workspace holding the lockfile, plus a fake pnpm in `bin/` that replays the canned output.
const workspace = async ({ stdout, status, stderr, lockfile }) => {
  const root = await mkdtemp(join(tmpdir(), 'audit-lockfile-'));
  roots.push(root);
  await mkdir(join(root, 'bin'));
  await writeFile(join(root, 'pnpm-lock.yaml'), lockfile);
  await writeFile(
    join(root, 'stdout'),
    typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
  );
  await writeFile(join(root, 'stderr'), stderr);
  const fake = `#!/bin/sh\n[ "$1 $2" = "audit --json" ] || exit 99\ncat stdout\ncat stderr >&2\nexit ${status}\n`;
  await writeFile(join(root, 'bin', 'pnpm'), fake);
  await chmod(join(root, 'bin', 'pnpm'), EXECUTABLE);
  return root;
};

const run = async ({ stdout = '', status = 0, stderr = '', lockfile = LOCKFILE, pnpm = true }) => {
  const root = await workspace({ lockfile, status, stderr, stdout });
  const bin = join(root, 'bin');
  const env = {
    ...process.env,
    PATH: pnpm ? `${bin}${delimiter}${process.env.PATH}` : join(root, 'empty'),
  };
  // eslint-disable-next-line node/no-sync -- a test shelling out to a CLI; async buys nothing here
  return spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8', env });
};

test('a clean audit over every package in both documents passes', async () => {
  const result = await run({ stdout: clean(PACKAGES) });
  strictEqual(result.status, EXIT_OK, result.stderr);
  match(
    result.stdout,
    /covered 4 packages; pnpm-lock\.yaml holds 4 registry packages \(2 \+ 3 across 2 documents\)/u,
  );
});

// TanStack Query's real report is 1.2 MB, past the 1 MiB that spawnSync buffers by default.
test('a report larger than node’s default child-process buffer is read whole', async () => {
  // Padding first: a reader that keeps only the first megabyte loses the report itself.
  const result = await run({ stdout: ' '.repeat(TWO_MIB) + JSON.stringify(clean(PACKAGES)) });
  strictEqual(result.status, EXIT_OK, result.stderr);
});

test('an audit that counts more than the registry packages passes', async () => {
  const result = await run({ stdout: clean(MORE_THAN_REGISTRY) });
  strictEqual(result.status, EXIT_OK, result.stderr);
});

test('an audit that saw only the first document fails, even with no advisories', async () => {
  const result = await run({ stdout: clean(FIRST_DOCUMENT_ONLY) });
  strictEqual(result.status, EXIT_COVERAGE);
  match(
    result.stderr,
    /covered 2 packages, but pnpm-lock\.yaml holds 4 registry packages \(2 \+ 3 across 2 documents\)/u,
  );
});

test('advisories fail the run and name the package, version and advisory', async () => {
  const result = await run({ status: 1, stdout: advisory });
  strictEqual(result.status, EXIT_ADVISORIES);
  match(
    result.stderr,
    /moderate: brace-expansion@5\.0\.11 Unbounded recursion https:\/\/github\.com\/advisories\//u,
  );
});

// pnpm 12.11.2 with `auditConfig.ignoreGhsas` covering every advisory: `advisories` is empty and the
// exit is 0, but `metadata.vulnerabilities` still counts the ignored ones.
test('advisories ignored through pnpm’s auditConfig do not fail the run', async () => {
  const report = clean(PACKAGES);
  // The counts pnpm reported for this repository at 0.18.1 with all five advisories ignored.
  report.metadata.vulnerabilities = { ...severities(IGNORED_MODERATE), high: IGNORED_HIGH };
  const result = await run({ stdout: report });
  strictEqual(result.status, EXIT_OK, result.stderr);
  match(result.stdout, /advisories at low or above, after auditConfig ignores: 0/u);
});

test('an info-level advisory alone does not fail the run', async () => {
  const report = clean(PACKAGES);
  report.metadata.vulnerabilities.info = 1;
  report.advisories = { 2: { ...advisory.advisories[1], severity: 'info' } };
  const result = await run({ stdout: report });
  strictEqual(result.status, EXIT_OK, result.stderr);
});

test('a registry error is reported as an incomplete audit, not a clean one', async () => {
  const result = await run({ status: 1, stderr: 'ERR_PNPM_AUDIT_BAD_RESPONSE 503' });
  strictEqual(result.status, EXIT_INCOMPLETE);
  match(
    result.stderr,
    /did not complete \(exit 1\): ERR_PNPM_AUDIT_BAD_RESPONSE 503\. This is not a clean result\./u,
  );
});

test('a failing exit with a report that shows nothing is incomplete, not clean', async () => {
  const result = await run({ status: 1, stdout: clean(PACKAGES) });
  strictEqual(result.status, EXIT_INCOMPLETE);
});

test('pnpm missing from PATH is an incomplete audit', async () => {
  const result = await run({ pnpm: false, stdout: clean(PACKAGES) });
  strictEqual(result.status, EXIT_INCOMPLETE);
  match(result.stderr, /ENOENT/u);
});

test('an unparseable lockfile is incomplete, never an empty inventory', async () => {
  const result = await run({ lockfile: 'packages: [unclosed\n', stdout: clean(0) });
  strictEqual(result.status, EXIT_INCOMPLETE);
  match(result.stderr, /pnpm-lock\.yaml is not valid YAML/u);
});
