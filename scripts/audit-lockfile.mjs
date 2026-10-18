#!/usr/bin/env node
// Audits every package in pnpm-lock.yaml for known advisories, and proves the audit saw them all.
//
//   node scripts/audit-lockfile.mjs                      run `pnpm audit --json` on this repo
//   node scripts/audit-lockfile.mjs --report <file>      check a saved `pnpm audit --json` report
//   node scripts/audit-lockfile.mjs --lockfile <file>    count packages in another lockfile
//
// Exit codes, kept distinct so a red job says which kind of red it is:
//   0  every lockfile package was audited and no advisory was reported
//   1  advisories were reported (any severity; the counts are printed per severity)
//   2  the audit did not produce a usable report — registry outage, network error, bad usage.
//      Never treated as clean: a scan that did not run is not a scan that found nothing.
//   3  coverage gap — the report audited fewer packages than the lockfile lists
//
// Why the coverage check. Since pnpm 12 the lockfile holds two YAML documents: the first only
// pins pnpm itself, the second holds the project's graph. pnpm's docs warn that a tool reading only
// the first document "reports that the project has no dependencies, and no vulnerabilities, without
// failing" (https://pnpm.io/supply-chain-security). Counting the registry packages across every
// document, each once, and requiring the report to cover at least that many turns that silent pass
// into exit 3.
//
// Why the full audit, not `--prod`. The CLI bundles commander, smol-toml and zod into
// dist/refs.mjs, yet declares them as devDependencies, so `--prod` would skip shipped code.
//
// Plain Node with zero dependencies, like scripts/versions.mjs, so it runs before `pnpm install`;
// dependency-audit.yml installs nothing at all. Hence the line-based reading of the one lockfile
// shape pnpm writes rather than a YAML library; the tests check it against one where installed.
// Tests: scripts/audit-lockfile.test.mjs.

import { appendFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { promisify } from 'node:util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXIT_ADVISORIES = 1;
const EXIT_UNAVAILABLE = 2;
const EXIT_COVERAGE = 3;
const ARGV_START = 2;
const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];
// 64 MiB of JSON; a clean report is under 1 KiB.
const MAX_AUDIT_BYTES = 67_108_864;
const EXCERPT = 300;
const OPTION_STRIDE = 2;

// A YAML document separator on its own line, and a package key: exactly two spaces of indentation
// under a top-level `packages:` block, ending in a colon (quoted or bare, as pnpm writes both).
// Its `resolution:` is the four-space-indented flow mapping pnpm writes on one line.
const DOCUMENT_SEPARATOR = /^---[ \t]*$/mu;
const TOP_LEVEL_KEY = /^(?<key>[^\s#][^:]*):/u;
const PACKAGE_KEY = /^ {2}(?<key>[^\s#].*):[ \t]*$/u;
const FLOW_RESOLUTION = /^ {4}resolution:[ \t]*\{(?<body>.*)\}[ \t]*$/u;
const FLOW_KEY = /(?:^|,)[ \t]*(?<key>[\w-]+):/gu;

class UnavailableError extends Error {
  name = 'UnavailableError';
}

const fail = (code, message) => {
  console.error(`::error::${message}`);
  process.exitCode = code;
};

// Only a registry package has a resolution of `integrity` alone; one from git (`commit`, `repo`),
// a directory (`directory`) or a tarball url (`tarball`) has no registry advisories to look up, and
// `pnpm audit` does not count it. A resolution in any other shape is counted: over-counting can
// only turn a pass into a visible coverage failure, never hide a gap.
const isRegistryResolution = (line) => {
  const body = FLOW_RESOLUTION.exec(line)?.groups.body;
  if (body === undefined) {
    return true;
  }
  const keys = [...body.matchAll(FLOW_KEY)].map((found) => found.groups.key);
  return keys.length === 1 && keys[0] === 'integrity';
};

const isNonRegistryResolution = (state, line) =>
  state.current !== '' && line.startsWith('    resolution:') && !isRegistryResolution(line);

// One step of the line scan in `packagesIn`: `state.current` is the package whose lines follow.
const scanLine = (state, line) => {
  const top = TOP_LEVEL_KEY.exec(line);
  if (top) {
    state.inPackages = top.groups.key === 'packages';
    state.current = '';
    return;
  }
  const packageKey = state.inPackages ? PACKAGE_KEY.exec(line)?.groups.key : undefined;
  if (packageKey !== undefined) {
    state.current = packageKey.replaceAll(/^['"]|['"]$/gu, '');
    state.keys.add(state.current);
  } else if (isNonRegistryResolution(state, line)) {
    state.keys.delete(state.current);
  }
};

/** Registry package keys under the top-level `packages:` block of one YAML document. */
const packagesIn = (document) => {
  const state = { current: '', inPackages: false, keys: new Set() };
  for (const line of document.split(/\r?\n/u)) {
    scanLine(state, line);
  }
  return [...state.keys];
};

/** Registry packages per lockfile document that has any, in file order, and their union: a
 * package both documents list is one package to audit. */
const lockfileInventory = (text) => {
  const perDocument = text
    .split(DOCUMENT_SEPARATOR)
    .map((document) => packagesIn(document))
    .filter((keys) => keys.length > 0);
  return {
    perDocument: perDocument.map((keys) => keys.length),
    total: new Set(perDocument.flat()).size,
  };
};

const parseJson = (text, source) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new UnavailableError(`${source} is not JSON — the audit did not run to completion`);
  }
};

const parseReport = (text, source) => {
  const report = parseJson(text, source);
  const total = report?.metadata?.totalDependencies;
  if (report?.error !== undefined || typeof total !== 'number') {
    throw new UnavailableError(
      `${source} is not an audit report: ${JSON.stringify(report?.error ?? report).slice(0, EXCERPT)}`,
    );
  }
  return report;
};

const runAudit = async () => {
  // pnpm exits non-zero when it finds advisories, so the exit code alone cannot tell an outage
  // from a finding; the JSON on stdout decides. Full audit on purpose — see the header.
  const options = { cwd: ROOT, encoding: 'utf8', maxBuffer: MAX_AUDIT_BYTES };
  const result = await promisify(execFile)('pnpm', ['audit', '--json'], options).catch(
    (error) => error,
  );
  if (typeof result.stdout !== 'string') {
    throw new UnavailableError(`pnpm audit could not be started: ${result.message}`);
  }
  return parseReport(
    result.stdout,
    `pnpm audit output (exit ${result.code ?? 0}, stderr: ${result.stderr.trim().slice(0, EXCERPT)})`,
  );
};

const readReport = async (file) => {
  if (file === undefined) {
    return runAudit();
  }
  return parseReport(await readFile(file, 'utf8'), file);
};

const parseArgs = (argv) => {
  const options = { lockfile: join(ROOT, 'pnpm-lock.yaml'), report: undefined };
  for (let index = 0; index < argv.length; index += OPTION_STRIDE) {
    const name = argv[index]?.replace(/^--/u, '');
    if (!['lockfile', 'report'].includes(name) || argv[index + 1] === undefined) {
      throw new UnavailableError(
        `usage: audit-lockfile.mjs [--report <file>] [--lockfile <file>] — got ${argv.join(' ')}`,
      );
    }
    options[name] = argv[index + 1];
  }
  return options;
};

const summary = ({ inventory, report }) => {
  const counts = SEVERITIES.map(
    (severity) => `| ${severity} | ${report.metadata.vulnerabilities?.[severity] ?? 0} |`,
  );
  return [
    `### Lockfile audit`,
    `Lockfile packages: ${inventory.total} (per document: ${inventory.perDocument.join(' + ')}); audited: ${report.metadata.totalDependencies}`,
    '',
    '| severity | advisories |',
    '|---|---|',
    ...counts,
    '',
  ].join('\n');
};

const verdict = ({ inventory, report }) => {
  const listed = inventory.total;
  const audited = report.metadata.totalDependencies;
  if (audited < listed) {
    return fail(
      EXIT_COVERAGE,
      `the audit covered ${audited} packages but the lockfile lists ${listed} across ${inventory.perDocument.length} document(s) — part of the graph went unscanned`,
    );
  }
  const found = SEVERITIES.filter(
    (severity) => (report.metadata.vulnerabilities?.[severity] ?? 0) > 0,
  );
  if (found.length > 0) {
    return fail(
      EXIT_ADVISORIES,
      `advisories reported (${found.map((severity) => `${severity}: ${report.metadata.vulnerabilities[severity]}`).join(', ')}) — run \`pnpm audit\` for details`,
    );
  }
  console.log(`audited all ${audited} packages (lockfile lists ${listed}); no advisories`);
};

const main = async () => {
  try {
    const options = parseArgs(process.argv.slice(ARGV_START));
    const inventory = lockfileInventory(await readFile(options.lockfile, 'utf8'));
    const report = await readReport(options.report);
    console.log(summary({ inventory, report }));
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, summary({ inventory, report }));
    }
    verdict({ inventory, report });
  } catch (error) {
    fail(
      EXIT_UNAVAILABLE,
      error instanceof UnavailableError ? error.message : `audit check failed: ${error.message}`,
    );
  }
};

if (import.meta.main) {
  await main();
}

export { lockfileInventory };
