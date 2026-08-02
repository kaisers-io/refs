#!/usr/bin/env node
// Keeps the version this repo releases identical across the five files that carry it:
//
//   packages/cli/package.json        .version   (the source of truth)
//   .claude-plugin/plugin.json       .version
//   .claude-plugin/marketplace.json  .plugins[].version — every entry
//   .codex-plugin/plugin.json        .version
//   skills/refs/SKILL.md             frontmatter metadata.cli_version
//
//   node scripts/versions.mjs --check          report every disagreement, exit 1 if any
//   node scripts/versions.mjs --set <version>  write <version> to all five sites
//
// Why they must agree. The skill ships from git (`npx skills add`) while the CLI ships from npm,
// so the two can drift; `refs doctor`'s `skill` check and the skill's own capability gate compare
// the pinned `cli_version` against the running CLI, so a release whose skill still pinned the
// previous version would make every user's doctor report a false mismatch. The plugin manifests
// are what the Claude Code / Codex marketplaces show users, yet nothing else in the publish path
// reads them: a release carrying a stale manifest would publish cleanly while advertising an old
// version alongside the current skill — the same drift, one layer out. (`.agents/plugins/
// marketplace.json` is deliberately not in the list: it carries no version field at all, so
// nothing there can drift.)
//
// Two release-workflow guards checked the four non-source sites, but only on a tag push — after
// the release commit was already on `main`. Every value here is knowable on a pull request, so
// `--check` also runs in CI on every PR. Plain Node with zero dependencies, so CI can run it
// before `pnpm install` — the property the guards it replaces relied on. Every problem is
// reported in one run, never just the first: at release time nobody should need a second CI run
// to find the next stale file, so an unreadable file, malformed JSON or a non-object entry
// becomes one `::error::` line instead of a stack trace and never stops the other sites from
// being checked.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Resolved from this file, not `cwd` or `git rev-parse`: it must work from any directory, and
// when the tree is copied somewhere without a `.git` directory.
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SOURCE_OF_TRUTH = 'packages/cli/package.json';
const MARKETPLACE = '.claude-plugin/marketplace.json';
const SKILL = 'skills/refs/SKILL.md';
const JSON_SITES = [SOURCE_OF_TRUTH, '.claude-plugin/plugin.json', MARKETPLACE, '.codex-plugin/plugin.json'];

const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const ARGV_START = 2;

// A JSON `"version": "…"` entry at the start of a line, at any indentation. Anchoring to the line
// start is what keeps this off a `version` substring inside a description or a URL — and a JSON
// string can never contain a raw newline, so a match is always a real key.
const JSON_VERSION_LINE = /^(?<prefix>[ \t]*"version"[ \t]*:[ \t]*)"(?:[^"\\]|\\.)*"/gmu;

// The frontmatter block, captured with its opening delimiter so the body's offset is exact.
// Bounding matters: SKILL.md's body discusses version handling in prose, and an unbounded replace
// would corrupt it. Same shape as the CLI's own parser in src/commands/doctor-checks-basic.ts.
const FRONTMATTER = /^(?<open>---\r?\n)(?<body>[\s\S]*?)(?:\r?\n---)/u;
// Loose form: counts `cli_version` entries including one whose value cannot be parsed, so a
// malformed pin is reported as malformed rather than as missing.
const CLI_VERSION_KEY = /^[ \t]*cli_version[ \t]*:/gmu;
// Strict form: the value itself, single-quoted, double-quoted or bare.
const CLI_VERSION_LINE =
  /^(?<indent>[ \t]*)cli_version:[ \t]*(?<quote>['"]?)(?<version>[^'"\s]+)\k<quote>[ \t]*$/mu;

// `--set`'s argument is validated rather than trusted: a typo written into five files is exactly
// the mess this script exists to prevent. Semver core, a superset of the `x.y.z` this repo ships.
const VERSION_ARGUMENT =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

/** Collected `::error::` lines. Nothing throws out of a read, a parse or a rewrite — it lands here. */
const problems = [];

const problem = (message) => problems.push(message);

const reportProblems = () => {
  for (const message of problems) {
    console.error(`::error::${message}`);
  }
  process.exitCode = EXIT_PROBLEMS;
};

const describe = (value) => (value === undefined ? '(no version field)' : JSON.stringify(value));

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Readers return `undefined` after recording why, so one broken file never hides the others. */
const readText = async (file) => {
  try {
    return await readFile(join(ROOT, file), 'utf8');
  } catch (error) {
    problem(`${file} could not be read: ${error.message}`);
  }
};

const parseJsonObject = (file, text) => {
  try {
    const data = JSON.parse(text);
    if (isPlainObject(data)) {
      return data;
    }
    problem(`${file} is not a JSON object`);
  } catch (error) {
    problem(`${file} is not valid JSON: ${error.message}`);
  }
};

// Every entry, not just [0] — a second plugin added later must not slip through. A missing
// `version` key reads as `undefined`, so it fails exactly like a wrong one.
const marketplaceValues = (plugins) => {
  if (!Array.isArray(plugins) || plugins.length === 0) {
    problem(`${MARKETPLACE} has no .plugins entries to check`);
    return [];
  }
  return plugins.flatMap((plugin, index) => {
    const label = `${MARKETPLACE} .plugins[${index}]`;
    if (!isPlainObject(plugin)) {
      problem(`${label} is not a JSON object`);
      return [];
    }
    return [{ label: `${label} (${plugin.name ?? 'unnamed'})`, value: plugin.version }];
  });
};

/** Every version-carrying value of one parsed JSON file, as `{ label, value }`. */
const versionValues = (file, data) =>
  file === MARKETPLACE ? marketplaceValues(data.plugins) : [{ label: `${file} .version`, value: data.version }];

/**
 * Rewrites every `"version"` line in a JSON file, surgically: parsing and re-serialising could
 * reorder keys or restyle indentation, and `git diff` after a bump must show only version lines.
 * `count` is how many version fields the read found, so a file with a different number of matching
 * lines (missing key, non-string value, a `version` nested elsewhere) is left alone rather than
 * half-edited — and the rewritten text is re-parsed and re-read before it is accepted.
 */
const rewriteJson = ({ count, file, text, version }) => {
  const found = text.match(JSON_VERSION_LINE) ?? [];
  if (found.length !== count) {
    problem(`${file} has ${found.length} quoted "version" line(s) but ${count} version field(s) to update — refusing to edit it, fix the file by hand`);
    return;
  }
  const updated = text.replaceAll(JSON_VERSION_LINE, (_m, prefix) => `${prefix}"${version}"`);
  const data = parseJsonObject(`${file} (after the edit)`, updated);
  const after = data === undefined ? [] : versionValues(file, data);
  if (after.length === count && after.every((entry) => entry.value === version)) {
    return updated;
  }
  problem(`${file} would not carry version ${version} after the edit — left untouched`);
};

/** A site is one file: the version value(s) it declares, and how to rewrite them. */
const readJsonSite = async (file) => {
  const text = await readText(file);
  const data = text === undefined ? undefined : parseJsonObject(file, text);
  if (data === undefined) {
    return;
  }
  const values = versionValues(file, data);
  const rewrite = (version) => rewriteJson({ count: values.length, file, text, version });
  return { file, rewrite, values };
};

const parseSkillPin = (body) => {
  const keys = body.match(CLI_VERSION_KEY) ?? [];
  if (keys.length !== 1) {
    problem(`${SKILL} frontmatter has ${keys.length} metadata.cli_version entries, expected one`);
    return;
  }
  const line = CLI_VERSION_LINE.exec(body);
  if (line) {
    return line.groups.version;
  }
  problem(`${SKILL} frontmatter has a cli_version entry whose value could not be parsed`);
};

/**
 * The pin is written back single-quoted on purpose: oxfmt (`pnpm fmt:check`) normalises
 * double-quoted YAML scalars to single quotes, so any other form would fail formatting.
 */
const skillSite = (source) => {
  const frontmatter = FRONTMATTER.exec(source);
  if (!frontmatter) {
    problem(`${SKILL} has no YAML frontmatter block to read metadata.cli_version from`);
    return;
  }
  const { body, open } = frontmatter.groups;
  const pin = parseSkillPin(body);
  if (pin === undefined) {
    return;
  }
  const start = frontmatter.index + open.length;
  return {
    file: SKILL,
    rewrite: (version) =>
      source.slice(0, start) +
      body.replace(CLI_VERSION_LINE, (_m, indent) => `${indent}cli_version: '${version}'`) +
      source.slice(start + body.length),
    values: [{ label: `${SKILL} metadata.cli_version`, value: pin }],
  };
};

const readSites = async () => {
  const sites = [];
  for (const file of JSON_SITES) {
    // eslint-disable-next-line no-await-in-loop -- four tiny files; sequential keeps error order
    const site = await readJsonSite(file);
    if (site !== undefined) {
      sites.push(site);
    }
  }
  const source = await readText(SKILL);
  const skill = source === undefined ? undefined : skillSite(source);
  if (skill !== undefined) {
    sites.push(skill);
  }
  return sites;
};

/** The value every other site must equal. Unusable on its own means there is nothing to check. */
const expectedFrom = (sites) => {
  const version = sites.find((site) => site.file === SOURCE_OF_TRUTH)?.values[0]?.value;
  if (typeof version === 'string' && version.length > 0) {
    return version;
  }
  problem(`${SOURCE_OF_TRUTH} has no usable .version — found ${describe(version)}; without it there is nothing to check the other sites against`);
};

const check = async () => {
  const sites = await readSites();
  const expected = expectedFrom(sites);
  if (expected !== undefined) {
    for (const { label, value } of sites.flatMap((site) => site.values)) {
      if (value !== expected) {
        problem(`${label} says ${describe(value)}, but ${SOURCE_OF_TRUTH} is ${expected}`);
      }
    }
  }
  if (problems.length > 0) {
    reportProblems();
    return;
  }
  console.log(`version ${expected} is consistent across all five sites (source ${SOURCE_OF_TRUTH})`);
};

const writeSites = async (sites, version) => {
  const edits = sites.map((site) => ({
    before: [...new Set(site.values.map((entry) => entry.value))].join(', '),
    file: site.file,
    text: site.rewrite(version),
  }));
  // All-or-nothing: a half-written bump is worse than a refused one, so every site is rewritten
  // in memory — and every problem with it reported — before the first byte is written.
  if (problems.length > 0) {
    return;
  }
  await Promise.all(edits.map(({ file, text }) => writeFile(join(ROOT, file), text)));
  for (const { before, file } of edits) {
    console.log(`${file}: ${before === version ? `already ${version}` : `${before} -> ${version}`}`);
  }
  console.log(`all five version sites now declare ${version}`);
};

const set = async (version) => {
  if (!VERSION_ARGUMENT.test(version)) {
    console.error(`::error::"${version}" is not a valid version (expected e.g. 1.2.3)`);
    process.exitCode = EXIT_USAGE;
    return;
  }
  // Reading surfaces malformed files; rewriting one piles follow-on errors onto the real problem.
  const sites = await readSites();
  if (problems.length === 0) {
    await writeSites(sites, version);
  }
  if (problems.length > 0) {
    // Said however `--set` failed: whoever is mid-release must know the tree is not half-bumped.
    problem('nothing was written — every version site must be updatable before any of them is');
    reportProblems();
  }
};

const main = async () => {
  const [mode, ...rest] = process.argv.slice(ARGV_START);
  if (mode === '--check' && rest.length === 0) {
    await check();
    return;
  }
  if (mode === '--set' && rest.length === 1) {
    await set(rest[0]);
    return;
  }
  console.error('usage: node scripts/versions.mjs --check | --set <version>');
  process.exitCode = EXIT_USAGE;
};

// Last-resort net: anything unforeseen still leaves an `::error::` line, never a stack trace.
try {
  await main();
} catch (error) {
  console.error(`::error::scripts/versions.mjs failed unexpectedly: ${error.message}`);
  process.exitCode = EXIT_PROBLEMS;
}
