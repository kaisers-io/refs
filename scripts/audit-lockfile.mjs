#!/usr/bin/env node
// Audits every package in the pnpm lockfile for known advisories, and checks that the audit's package
// count is plausible for the whole lockfile.
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
// "Reads both documents" is checked for plausibility, not assumed. The distinct registry packages in
// every document, counted here independently with a real YAML parser, set a floor the audit's
// reported package count must reach. Should a future pnpm, or a lockfile split into a third document,
// leave a document unaudited, the audit reports fewer and this fails instead of passing over a
// partial inventory. The check is a floor, not an equality, on purpose: pnpm audit skips git and
// directory packages (no npm advisory can name them) and counts some non-registry ones, such as a
// `node@runtime:` entry, so only the registry packages are a number both sides agree must be covered.
//
// What the floor does not prove: that each specific package identity was audited. It compares two
// counts, and pnpm reports no list of what it sent. An audit that skipped some registry packages
// while counting as many other entries would pass. It catches the failure #212 is about, a whole
// document left out, and no finer one.
//
// Exit codes keep the three failures apart, because they call for different responses:
//   0  the audit's package count reached the floor, no advisory at severity low or above
//      (advisories ignored through pnpm's `auditConfig.ignoreGhsas` do not count)
//   1  advisories found
//   2  the audit reported fewer packages than the lockfile's registry packages
//   3  the audit did not complete (registry or network error, or a report this script cannot
//      read, such as an unknown severity): NOT a clean result
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
const FAILING_SEVERITIES = new Set(['low', 'moderate', 'high', 'critical']);
// Every severity pnpm reports. Anything else is a report this script cannot read, not a pass.
const KNOWN_SEVERITIES = new Set(['info', ...FAILING_SEVERITIES]);
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

// Read from `advisories`, not `metadata.vulnerabilities`: pnpm drops the advisories a repository
// ignores through `auditConfig.ignoreGhsas` from the first and exits 0, but still counts them in the
// second (pnpm 12.11.2). Counting metadata would keep the run red over an advisory the maintainers
// chose to ignore, with no advisory left to name.
const failingAdvisories = (report) =>
  Object.values(report.advisories).filter((advisory) => FAILING_SEVERITIES.has(advisory.severity));

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// The shape every later step relies on. A filter that skipped an advisory it could not classify
// would turn an unreadable report into a clean one, so an unknown severity rejects the whole report.
const isReadable = (report) => {
  const total = report?.metadata?.totalDependencies;
  return (
    Number.isSafeInteger(total) &&
    total >= 0 &&
    isRecord(report.metadata.vulnerabilities) &&
    isRecord(report.advisories) &&
    Object.values(report.advisories).every(
      (advisory) => isRecord(advisory) && KNOWN_SEVERITIES.has(advisory.severity),
    )
  );
};

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
// that shows no advisories is a transport error dressed as a result, so it counts as incomplete, and
// so does a report whose shape isReadable rejects.
const parseReport = ({ status, stdout, stderr }) => {
  const report = parseJson(stdout);
  if (!isReadable(report) || (status !== 0 && failingAdvisories(report).length === 0)) {
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

// A count floor, not an identity check: see the header for what it can and cannot catch.
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

const describeAdvisories = (advisories) =>
  advisories.map((advisory) => {
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

const report = (inventory, { metadata }, failing) => {
  console.log(
    `pnpm audit covered ${metadata.totalDependencies} packages; ${LOCKFILE} holds ${inventory.packages.size} ` +
      `registry packages (${perDocument(inventory)}).`,
  );
  console.log(`pnpm metadata by severity, ignored advisories included: ${JSON.stringify(metadata.vulnerabilities)}`);
  console.log(`advisories at low or above, after auditConfig ignores: ${failing.length}`);
};

const main = async () => {
  const inventory = lockfileInventory(await readFile(LOCKFILE, 'utf8'));
  const audit = parseReport(await runAudit());
  checkCoverage(inventory, audit);
  const failing = failingAdvisories(audit);
  report(inventory, audit, failing);
  if (failing.length > 0) {
    for (const line of describeAdvisories(failing)) {
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
