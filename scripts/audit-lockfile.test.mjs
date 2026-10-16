// Tests for scripts/audit-lockfile.mjs — the lockfile vulnerability check in dependency-audit.yml.
//
//   node --test scripts/audit-lockfile.test.mjs
//
// Node's built-in runner and no network: every case hands the script a saved `pnpm audit --json`
// report (`--report`) and a fixture lockfile (`--lockfile`), so what is under test is the coverage
// arithmetic and the exit-code contract, not the registry.

import { match, strictEqual } from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

const SCRIPT = fileURLToPath(new URL('audit-lockfile.mjs', import.meta.url));
const REPO_LOCKFILE = fileURLToPath(new URL('../pnpm-lock.yaml', import.meta.url));

const EXIT_OK = 0;
const EXIT_ADVISORIES = 1;
const EXIT_UNAVAILABLE = 2;
const EXIT_COVERAGE = 3;
const FIRST_DOCUMENT = 2;
const BOTH_DOCUMENTS = 5;

// The pnpm 12 shape: a first document that only pins pnpm, a second with the project graph. Keys
// appear quoted and bare, and `snapshots:` repeats them — which must not be counted twice.
const LOCKFILE = `---
lockfileVersion: '9.0'

importers:

  .:
    packageManagerDependencies:
      pnpm: {specifier: 12.11.2, version: 12.11.2}

packages:

  '@pnpm/exe.linux-x64@12.11.2':
    resolution: {integrity: sha512-a}

  pnpm@12.11.2:
    resolution: {integrity: sha512-b}

snapshots:

  pnpm@12.11.2: {}
---
lockfileVersion: '9.0'

packages:

  balanced-match@4.0.4:
    resolution: {integrity: sha512-c}

  brace-expansion@5.0.12:
    resolution: {integrity: sha512-d}

  '@types/node@24.0.0':
    resolution: {integrity: sha512-e}

snapshots:

  balanced-match@4.0.4: {}
  brace-expansion@5.0.12:
    dependencies:
      balanced-match: 4.0.4
`;

const report = (totalDependencies, vulnerabilities = {}) =>
  JSON.stringify({
    advisories: {},
    metadata: {
      totalDependencies,
      vulnerabilities: { critical: 0, high: 0, info: 0, low: 0, moderate: 0, ...vulnerabilities },
    },
  });

const run = (argv) => {
  const env = { ...process.env, GITHUB_STEP_SUMMARY: '' };
  // eslint-disable-next-line node/no-sync -- a test shelling out to a CLI; async buys nothing here
  const result = spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: 'utf8', env });
  return { output: result.stdout + result.stderr, status: result.status };
};

/** Runs the script on a fixture report; `lockfile` defaults to the two-document fixture above. */
const audit = async ({ args, lockfile = LOCKFILE, reportText }) => {
  const dir = await mkdtemp(join(tmpdir(), 'audit-lockfile-'));
  try {
    await writeFile(join(dir, 'pnpm-lock.yaml'), lockfile);
    await writeFile(join(dir, 'report.json'), reportText ?? '');
    const argv = args ?? [
      '--lockfile',
      join(dir, 'pnpm-lock.yaml'),
      '--report',
      join(dir, 'report.json'),
    ];
    return run(argv);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

test('passes when the report covers every package in both documents and lists no advisory', async () => {
  const { output, status } = await audit({ reportText: report(BOTH_DOCUMENTS) });
  strictEqual(status, EXIT_OK, output);
  match(output, /per document: 2 \+ 3/u);
  match(output, /audited all 5 packages/u);
});

test('fails with a coverage gap when the report only saw the first document', async () => {
  const { output, status } = await audit({ reportText: report(FIRST_DOCUMENT) });
  strictEqual(status, EXIT_COVERAGE, output);
  match(output, /covered 2 packages but the lockfile lists 5 across 2 document/u);
});

test('fails with a coverage gap on the repository lockfile when the audit saw one package', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'audit-lockfile-repo-'));
  try {
    await writeFile(join(dir, 'report.json'), report(1));
    const { output, status } = run([
      '--lockfile',
      REPO_LOCKFILE,
      '--report',
      join(dir, 'report.json'),
    ]);
    strictEqual(status, EXIT_COVERAGE, output);
    match(output, /across 2 document\(s\)/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test('reports advisories with their severities', async () => {
  const { output, status } = await audit({
    reportText: report(BOTH_DOCUMENTS, { high: 1, low: 2 }),
  });
  strictEqual(status, EXIT_ADVISORIES, output);
  match(output, /high: 1, low: 2/u);
});

test('treats a registry error report as unavailable, never as clean', async () => {
  const reportText = JSON.stringify({
    error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE', message: 'registry responded with 503' },
  });
  const { output, status } = await audit({ reportText });
  strictEqual(status, EXIT_UNAVAILABLE, output);
  match(output, /ERR_PNPM_AUDIT_BAD_RESPONSE/u);
});

test('treats output that is not json as unavailable', async () => {
  const { output, status } = await audit({
    reportText: 'request to https://registry.npmjs.org failed, reason: ETIMEDOUT',
  });
  strictEqual(status, EXIT_UNAVAILABLE, output);
  match(output, /is not JSON/u);
});

test('rejects an unknown option as usage error', async () => {
  const { output, status } = await audit({ args: ['--prod'] });
  strictEqual(status, EXIT_UNAVAILABLE, output);
  match(output, /usage:/u);
});
