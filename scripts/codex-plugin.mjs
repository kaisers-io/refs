#!/usr/bin/env node
// Keeps the Codex plugin in codex-plugin/ in step with the skill and the CLI it ships with:
//
//   node scripts/codex-plugin.mjs --check   report every difference, exit 1 if any
//   node scripts/codex-plugin.mjs --write   copy skills/refs into the plugin, set its version
//
// Why a copy. Codex installs a plugin by copying its directory into its own cache, and that copy
// leaves out symbolic links, so codex-plugin/skills/refs cannot point at skills/refs. Pointing the
// plugin at the repository root instead would install the whole repository. skills/refs stays the
// one place the skill is edited; this script writes the copy and CI fails while it differs.
//
// It also holds the plugin to the project's principle that refs is for git clones only, not for
// running code: the plugin carries instructions and images, and nothing Codex could execute. A
// hook file, an MCP server or app configuration, a scripts directory or an executable file in the
// plugin, or a manifest key that declares one, is a problem, not a warning.
//
// Plain Node, no dependencies, so CI can run it before `pnpm install`. Tests:
// scripts/codex-plugin.test.mjs.

import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file, so the tests can run a copy of it inside a fixture tree.
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SKILL = 'skills/refs';
const PLUGIN = 'codex-plugin';
const COPY = `${PLUGIN}/skills/refs`;
const MANIFEST = `${PLUGIN}/plugin.json`;
const PACKAGE = 'packages/cli/package.json';
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const ARGV_START = 2;
const EXECUTE_BITS = 0o111;
const FILE_MODE = 0o644;

// What Codex would load and run from a plugin root, and the manifest keys that declare it.
const FORBIDDEN_ENTRIES = new Set(['hooks', 'hooks.json', 'mcp.json', '.mcp.json', '.app.json', 'scripts']);
const FORBIDDEN_KEYS = ['hooks', 'mcpServers', 'apps'];
const JSON_VERSION_LINE = /^(?<prefix>[ \t]*"version"[ \t]*:[ \t]*)"(?:[^"\\]|\\.)*"/gmu;

const problems = [];
const problem = (message) => problems.push(message);

/** Every file under `dir`, as paths relative to it, sorted; `[]` for a missing directory. */
const filesUnder = async (dir) => {
  const entries = await readdir(join(ROOT, dir), { recursive: true, withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(join(ROOT, dir), join(entry.parentPath, entry.name)))
    .toSorted();
};

/** `fn()`, or `undefined` when it throws: for reads where absence is an answer, not an error. */
const orNothing = async (fn) => {
  try {
    return await fn();
  } catch {
    // Absent or unreadable: the caller treats both as "nothing there".
  }
};

const readJson = async (file) => {
  try {
    return JSON.parse(await readFile(join(ROOT, file), 'utf8'));
  } catch (error) {
    problem(`${file} could not be read as JSON: ${error.message}`);
  }
};

const sameBytes = async (left, right) => {
  const [leftBytes, rightBytes] = await Promise.all([
    readFile(join(ROOT, left)),
    readFile(join(ROOT, right)),
  ]);
  return leftBytes.equals(rightBytes);
};

const checkCopy = async () => {
  const [source, copy] = await Promise.all([filesUnder(SKILL), filesUnder(COPY)]);
  const missing = source.filter((file) => !copy.includes(file));
  const extra = copy.filter((file) => !source.includes(file));
  const shared = source.filter((file) => copy.includes(file));
  const same = await Promise.all(shared.map((file) => sameBytes(`${SKILL}/${file}`, `${COPY}/${file}`)));
  const changed = shared.filter((_file, index) => !same[index]);
  for (const [what, list] of [['missing from', missing], ['not in', extra], ['differs in', changed]]) {
    if (list.length > 0) {
      problem(`${list.join(', ')}: ${what} ${what === 'not in' ? SKILL : COPY} — run: node scripts/codex-plugin.mjs --write`);
    }
  }
};

const checkVersion = async (manifest) => {
  const pkg = await readJson(PACKAGE);
  if (manifest !== undefined && pkg !== undefined && manifest.version !== pkg.version) {
    problem(`${MANIFEST} .version is ${JSON.stringify(manifest.version)}, ${PACKAGE} is ${JSON.stringify(pkg.version)} — run: node scripts/codex-plugin.mjs --write`);
  }
};

const RUNS_NOTHING = 'a plugin for refs carries nothing Codex could run';

const checkEntries = async () => {
  const top = await readdir(join(ROOT, PLUGIN)).catch(() => []);
  for (const entry of top.filter((name) => FORBIDDEN_ENTRIES.has(name))) {
    problem(`${PLUGIN}/${entry}: ${RUNS_NOTHING}`);
  }
};

const checkKeys = (manifest) => {
  const declared = { ...manifest, ...manifest?.extensions?.['com.openai'] };
  for (const key of FORBIDDEN_KEYS.filter((name) => name in declared)) {
    problem(`${MANIFEST} declares "${key}": ${RUNS_NOTHING}`);
  }
};

const checkModes = async () => {
  const skillFiles = await filesUnder(SKILL);
  const files = [...skillFiles.map((file) => `${SKILL}/${file}`), MANIFEST];
  const modes = await Promise.all(files.map((file) => orNothing(() => stat(join(ROOT, file)))));
  for (const [index, info] of modes.entries()) {
    if (info !== undefined && (info.mode & EXECUTE_BITS) !== 0) {
      problem(`${files[index]} is executable: ${RUNS_NOTHING}`);
    }
  }
};

const checkNothingRuns = async (manifest) => {
  await checkEntries();
  checkKeys(manifest);
  await checkModes();
};

const check = async () => {
  const manifest = await readJson(MANIFEST);
  await checkCopy();
  await checkVersion(manifest);
  await checkNothingRuns(manifest);
};

const writeVersion = async () => {
  const pkg = await readJson(PACKAGE);
  const text = await orNothing(() => readFile(join(ROOT, MANIFEST), 'utf8'));
  if (pkg === undefined || text === undefined || (text.match(JSON_VERSION_LINE) ?? []).length !== 1) {
    problem(`${MANIFEST} needs exactly one "version" line and ${PACKAGE} a version`);
    return;
  }
  const updated = text.replaceAll(JSON_VERSION_LINE, (_line, prefix) => `${prefix}"${pkg.version}"`);
  await writeFile(join(ROOT, MANIFEST), updated);
};

const copyFile = async (file) => {
  const target = join(ROOT, COPY, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await readFile(join(ROOT, SKILL, file)));
  await chmod(target, FILE_MODE);
};

const write = async () => {
  await writeVersion();
  await rm(join(ROOT, COPY), { force: true, recursive: true });
  const files = await filesUnder(SKILL);
  await Promise.all(files.map((file) => copyFile(file)));
};

const main = async () => {
  const [mode] = process.argv.slice(ARGV_START);
  if (mode !== '--check' && mode !== '--write') {
    console.error('usage: node scripts/codex-plugin.mjs --check | --write');
    process.exitCode = EXIT_USAGE;
    return;
  }
  await (mode === '--write' ? write() : check());
  for (const message of problems) {
    console.error(`::error::${message}`);
  }
  if (problems.length > 0) {
    process.exitCode = EXIT_PROBLEMS;
  }
};

await main();
