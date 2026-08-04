#!/usr/bin/env node
// Keeps the version this repo releases identical across the two files that carry it:
//
//   packages/cli/package.json  .version   (the source of truth)
//   skills/refs/SKILL.md       frontmatter metadata.cli_version
//
//   node scripts/versions.mjs --check          report every disagreement, exit 1 if any
//   node scripts/versions.mjs --set <version>  write <version> to both sites
//
// Why they must agree. The skill ships from git (`npx skills add`) while the CLI ships from npm, so
// the two can drift; `refs doctor`'s `skill` check and the skill's own capability gate both compare
// the pinned `cli_version` against the running CLI, so a release whose skill still pins the previous
// version makes every user's doctor report a false mismatch.
//
// Every value here is knowable on a pull request, so `--check` runs in CI on every PR as well as at
// release — earlier than the two tag-push guards it replaced. Plain Node with zero dependencies, so
// CI can run it before `pnpm install`. Every problem is reported in one run, never just the first: an
// unreadable file, malformed JSON or a missing version field becomes one `::error::` line, not a
// stack trace, and never stops the other site being checked. Tests: scripts/versions.test.mjs.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Resolved from this file, not `cwd` or `git rev-parse`: it must work from any directory, and when
// the tree is copied somewhere without a `.git` directory. That is also the test suite's only hook:
// it copies this file into a fixture tree's `scripts/`, so no root override exists to be misused.
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SOURCE_OF_TRUTH = 'packages/cli/package.json';
const SKILL = 'skills/refs/SKILL.md';
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const ARGV_START = 2;

// A JSON `"version": "…"` entry at the start of a line, at any indentation. Anchoring to the line
// start keeps this off a `version` substring inside a description or a URL — and a JSON string can
// never contain a raw newline, so a match is always a real key.
const JSON_VERSION_LINE = /^(?<prefix>[ \t]*"version"[ \t]*:[ \t]*)"(?:[^"\\]|\\.)*"/gmu;

// The frontmatter block, captured with its opening delimiter so the body's offset is exact. Bounding
// matters: SKILL.md's body discusses version handling in prose, and an unbounded replace would break
// it. Same shape as the CLI's own parser in src/commands/doctor-checks-basic.ts.
const FRONTMATTER = /^(?<open>---\r?\n)(?<body>[\s\S]*?)(?:\r?\n---)/u;
// Loose form: counts `cli_version` entries including one whose value cannot be parsed, so a
// malformed pin is reported as malformed rather than as missing.
const CLI_VERSION_KEY = /^[ \t]*cli_version[ \t]*:/gmu;
// Strict form: the value itself, single-quoted, double-quoted or bare.
const CLI_VERSION_LINE =
  /^(?<indent>[ \t]*)cli_version:[ \t]*(?<quote>['"]?)(?<version>[^'"\s]+)\k<quote>[ \t]*$/mu;

// `--set`'s argument is validated rather than trusted: a typo written into both files is exactly
// the mess this script exists to prevent. SemVer proper (semver.org's own regex, minus its capture
// groups), not a laxer `\d+.\d+.\d+`: no leading zeros in the numeric components or in a numeric
// prerelease identifier, so `01.2.3` and `1.2.3-01` are refused here rather than at `npm publish`.
const VERSION_ARGUMENT =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

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

/** Readers return `undefined` after recording why, so one broken file never hides the other. */
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

/**
 * Rewrites the `"version"` line in a JSON file, surgically: parsing and re-serialising could
 * reorder keys or restyle indentation, and `git diff` after a bump must show only the version line.
 * A file with a different number of matching lines than expected (exactly one) is left alone, not
 * half-edited — and the result is re-parsed before it is accepted.
 */
const rewriteJson = ({ file, text, version }) => {
  const found = text.match(JSON_VERSION_LINE) ?? [];
  if (found.length !== 1) {
    problem(
      `${file} has ${found.length} quoted "version" line(s), expected exactly one — refusing to edit it, fix the file by hand`,
    );
    return;
  }
  const updated = text.replaceAll(JSON_VERSION_LINE, (_m, prefix) => `${prefix}"${version}"`);
  const data = parseJsonObject(`${file} (after the edit)`, updated);
  if (data !== undefined && data.version === version) {
    return updated;
  }
  problem(`${file} would not carry version ${version} after the edit — left untouched`);
};

/** The source-of-truth site: its declared version, and how to rewrite it. */
const readJsonSite = async (file) => {
  const text = await readText(file);
  const data = text === undefined ? undefined : parseJsonObject(file, text);
  if (data === undefined) {
    return;
  }
  return { file, rewrite: (version) => rewriteJson({ file, text, version }), values: [{ label: `${file} .version`, value: data.version }] };
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

// The pin is written back single-quoted on purpose: oxfmt (`pnpm fmt:check`) normalises
// double-quoted YAML scalars to single quotes, so any other form would fail formatting.
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
  const jsonSite = await readJsonSite(SOURCE_OF_TRUTH);
  const skillText = await readText(SKILL);
  const skill = skillText === undefined ? undefined : skillSite(skillText);
  return [jsonSite, skill].filter((site) => site !== undefined);
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
  for (const { label, value } of expected === undefined ? [] : sites.flatMap((site) => site.values)) {
    if (value !== expected) {
      problem(`${label} says ${describe(value)}, but ${SOURCE_OF_TRUTH} is ${expected}`);
    }
  }
  if (problems.length > 0) {
    reportProblems();
  } else {
    console.log(`version ${expected} is consistent across both sites (source ${SOURCE_OF_TRUTH})`);
  }
};

/**
 * Sequential, not `Promise.all`: two separate files cannot be written atomically, so the next best
 * thing is damage that is bounded and nameable. Each file is announced as it lands, and a failure
 * names what already carries the new version and what may be half-written — enough for whoever is
 * mid-release to know exactly what to revert.
 */
const writeEdits = async (edits, version) => {
  for (const [index, { before, file, text }] of edits.entries()) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential is the point: it bounds the damage
      await writeFile(join(ROOT, file), text);
    } catch (error) {
      const done = edits.slice(0, index).map((edit) => edit.file).join(', ') || 'nothing';
      problem(`${file} could not be written: ${error.message}`);
      problem(`the tree is half-bumped: ${done} already at ${version}, ${file} possibly partly written, every site after it untouched — revert those before retrying`);
      return;
    }
    console.log(`${file}: ${before === version ? `already ${version}` : `${before} -> ${version}`}`);
  }
  console.log(`both version sites now declare ${version}`);
};

/** Returns whether writing began — only then is "nothing was written" a lie the caller must not tell. */
const writeSites = async (sites, version) => {
  const edits = sites.map((site) => ({
    before: [...new Set(site.values.map((entry) => entry.value))].join(', '),
    file: site.file,
    text: site.rewrite(version),
  }));
  // Every site is rewritten in memory — and every problem with it reported — before the first byte
  // is written, so an unrewritable file refuses the bump rather than half-applying it.
  if (problems.length > 0) {
    return false;
  }
  await writeEdits(edits, version);
  return true;
};

const set = async (version) => {
  if (!VERSION_ARGUMENT.test(version)) {
    console.error(`::error::"${version}" is not a valid semantic version (expected e.g. 1.2.3)`);
    process.exitCode = EXIT_USAGE;
    return;
  }
  // Reading surfaces malformed files; rewriting one piles follow-on errors onto the real problem.
  const sites = await readSites();
  const started = problems.length === 0 && (await writeSites(sites, version));
  if (problems.length > 0) {
    // Claimed only when true: once writing has begun, `writeEdits` names what it changed instead.
    if (!started) {
      problem('nothing was written — every version site must be updatable before any of them is');
    }
    reportProblems();
  }
};

const main = async () => {
  const [mode, ...rest] = process.argv.slice(ARGV_START);
  if (mode === '--check' && rest.length === 0) {
    await check();
  } else if (mode === '--set' && rest.length === 1) {
    await set(rest[0]);
  } else {
    console.error('usage: node scripts/versions.mjs --check | --set <version>');
    process.exitCode = EXIT_USAGE;
  }
};

// Last-resort net: anything unforeseen still leaves an `::error::` line, never a stack trace.
try {
  await main();
} catch (error) {
  console.error(`::error::scripts/versions.mjs failed unexpectedly: ${error.message}`);
  process.exitCode = EXIT_PROBLEMS;
}
