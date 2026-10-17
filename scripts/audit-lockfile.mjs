#!/usr/bin/env node
// Audits every package in the pnpm lockfile for known advisories, and proves the audit saw them all.
//
//   node scripts/audit-lockfile.mjs     run from the workspace root, after `pnpm install`
//
// Why this exists. Since pnpm 12, `pnpm-lock.yaml` holds two YAML documents: the first carries only
// the package manager's own install graph, the second everything the project depends on. A tool that
// reads only the first document reports a project with almost no dependencies and no
// vulnerabilities, and does not fail. GitHub's dependency graph has been seen doing exactly that for
// this repository (#212): its SBOM listed the pnpm platform binaries and the direct dependencies and
// nothing transitive, so Dependabot alerts no longer cover the transitive packages bundled into the
// CLI. pnpm's own documentation names `pnpm audit` as the scanner that reads both documents.
//
// "Reads both documents" is checked, not assumed. Every registry package in every document, counted
// here independently with a real YAML parser, must be within the number the audit reports. Should a
// future pnpm, or a lockfile split into a third document, leave a document unaudited, the audit
// reports fewer and this fails instead of passing over a partial inventory. The check is a floor,
// not an equality, on purpose: pnpm audit skips git and directory packages (no npm advisory can
// name them) and counts some non-registry ones, such as a `node@runtime:` entry, so only the
// registry packages are a number both sides agree must be covered.
//
// Exit codes keep the three failures apart, because they call for different responses:
//   0  every package audited, no advisory at severity low or above
//   1  advisories found
//   2  the audit covered fewer packages than the lockfile's registry packages
//   3  the audit did not complete (registry or network error): NOT a clean result
// Tests: scripts/audit-lockfile.test.mjs.

import { once } from 'node:events';
import { parseAllDocuments } from 'yaml';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const LOCKFILE = 'pnpm-lock.yaml';
const EXIT_ADVISORIES = 1;
const EXIT_COVERAGE = 2;
const EXIT_INCOMPLETE = 3;
// `info` is reported but never fails the run: it is not a vulnerability.
const FAILING_SEVERITIES = ['low', 'moderate', 'high', 'critical'];
// Lines of pnpm's own error output quoted when the audit did not complete.
const DETAIL_LINES = 5;

class AuditFailureError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = 'AuditFailureError';
    this.exitCode = exitCode;
  }
}

// A registry package's resolution is its integrity hash alone. Git, directory, tarball-URL and
// runtime entries carry more (`type`, `tarball`, `commit`, variants) and stay out of the floor.
const isRegistryPackage = (entry) => {
  const keys = Object.keys(entry?.resolution ?? {});
  return keys.length === 1 && keys[0] === 'integrity';
};

const registryKeys = (document) => {
  if (document.errors.length > 0) {
    const [first] = document.errors;
    throw new AuditFailureError(`${LOCKFILE} is not valid YAML: ${first.message}`, EXIT_INCOMPLETE);
  }
  const entries = Object.entries(document.toJS()?.packages ?? {});
  return entries.filter(([, entry]) => isRegistryPackage(entry)).map(([key]) => key);
};

// Distinct registry package keys (`name@version`) across every document. A key in more than one
// document is one package to the auditor too (checked against pnpm 12.11.2), so it counts once.
const lockfileInventory = (text) => {
  const perDocument = parseAllDocuments(text).map((document) => registryKeys(document));
  return {
    packages: new Set(perDocument.flat()),
    perDocument: perDocument.map((keys) => keys.length),
  };
};

const countFailing = (vulnerabilities) =>
  FAILING_SEVERITIES.reduce((sum, severity) => sum + (Number(vulnerabilities[severity]) || 0), 0);

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: no `metadata`, so parseReport calls the audit incomplete.
    return {};
  }
};

const firstLines = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, DETAIL_LINES)
    .join(' | ');

// The audit's JSON, or a failure that says the audit did not finish. A non-zero exit with a report
// that shows no advisories is a transport error dressed as a result, so it counts as incomplete.
const parseReport = ({ status, stdout, stderr }) => {
  const report = parseJson(stdout);
  const metadata = report?.metadata;
  const complete =
    typeof metadata?.totalDependencies === 'number' && typeof metadata.vulnerabilities === 'object';
  if (!complete || (status !== 0 && countFailing(metadata.vulnerabilities) === 0)) {
    const detail = firstLines(stderr || stdout) || 'no output';
    throw new AuditFailureError(
      `pnpm audit did not complete (exit ${status}): ${detail}. This is not a clean result.`,
      EXIT_INCOMPLETE,
    );
  }
  return report;
};

// "15 + 178 across 2 documents"; a pre-pnpm-12 lockfile is "211 in 1 document".
const perDocument = ({ perDocument: counts }) =>
  counts.length === 1
    ? `${counts[0]} in 1 document`
    : `${counts.join(' + ')} across ${counts.length} documents`;

const checkCoverage = (inventory, report) => {
  const audited = report.metadata.totalDependencies;
  if (audited < inventory.packages.size) {
    throw new AuditFailureError(
      `pnpm audit covered ${audited} packages, but ${LOCKFILE} holds ${inventory.packages.size} registry packages ` +
        `(${perDocument(inventory)}). ` +
        'Part of the lockfile went unaudited.',
      EXIT_COVERAGE,
    );
  }
};

const describeAdvisories = (report) =>
  Object.values(report.advisories ?? {}).map((advisory) => {
    const versions = [...new Set((advisory.findings ?? []).map((finding) => finding.version))];
    const at = versions.length > 0 ? `@${versions.join(',')}` : '';
    return `${advisory.severity}: ${advisory.module_name}${at} ${advisory.title} ${advisory.url ?? ''}`.trim();
  });

// Streamed, not buffered with a size cap: a large workspace with many advisories prints megabytes of
// JSON (TanStack Query's report is 1.2 MB), past what spawnSync and execFile buffer by default, and
// a truncated report would read as an incomplete audit.
const collect = async (stream) => {
  let text = '';
  for await (const chunk of stream.setEncoding('utf8')) {
    text += chunk;
  }
  return text;
};

// A spawn failure (no pnpm on PATH) rejects `once`, and lands in main's catch as incomplete.
const runAudit = async () => {
  const child = spawn('pnpm', ['audit', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const [stdout, stderr, [status]] = await Promise.all([
    collect(child.stdout),
    collect(child.stderr),
    once(child, 'close'),
  ]);
  return { status, stderr, stdout };
};

const report = (inventory, { metadata }) => {
  console.log(
    `pnpm audit covered ${metadata.totalDependencies} packages; ${LOCKFILE} holds ${inventory.packages.size} ` +
      `registry packages (${perDocument(inventory)}).`,
  );
  console.log(`advisories by severity: ${JSON.stringify(metadata.vulnerabilities)}`);
};

const main = async () => {
  const inventory = lockfileInventory(await readFile(LOCKFILE, 'utf8'));
  const audit = parseReport(await runAudit());
  checkCoverage(inventory, audit);
  report(inventory, audit);
  if (countFailing(audit.metadata.vulnerabilities) > 0) {
    for (const line of describeAdvisories(audit)) {
      console.error(`::error::${line}`);
    }
    process.exitCode = EXIT_ADVISORIES;
  }
};

// Anything unforeseen is still a failure to look, never a pass.
try {
  await main();
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exitCode = error instanceof AuditFailureError ? error.exitCode : EXIT_INCOMPLETE;
}
