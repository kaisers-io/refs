// Tests for scripts/codex-plugin.mjs.
//
//   node --test scripts/codex-plugin.test.mjs
//
// Like versions.test.mjs: each test copies the script into a throwaway tree and runs the copy, so
// the real skill and plugin are never read or written.

import { after, test } from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { match, strictEqual } from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const SCRIPT = fileURLToPath(new URL('codex-plugin.mjs', import.meta.url));
const EXIT_OK = 0;
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const EXECUTABLE = 0o755;
const VERSION = '1.2.3';
const JSON_INDENT = 2;

const manifest = (version, extra = {}) =>
  `${JSON.stringify({ name: 'refs', version, ...extra }, undefined, JSON_INDENT)}\n`;

const SKILL_FILES = {
  'SKILL.md': '---\nname: refs\n---\n\n# refs\n',
  'agents/openai.yaml': 'policy:\n  allow_implicit_invocation: false\n',
};

const filesInStep = () => {
  const files = {
    'codex-plugin/plugin.json': manifest(VERSION),
    'packages/cli/package.json': `{\n  "version": "${VERSION}"\n}\n`,
  };
  for (const [path, content] of Object.entries(SKILL_FILES)) {
    files[`skills/refs/${path}`] = content;
    files[`codex-plugin/skills/refs/${path}`] = content;
  }
  return files;
};

const trees = [];
after(() => Promise.all(trees.map((root) => rm(root, { force: true, recursive: true }))));

const makeTree = async (overrides = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'refs-codex-plugin-'));
  trees.push(root);
  const files = { ...filesInStep(), ...overrides, 'scripts/codex-plugin.mjs': await readFile(SCRIPT, 'utf8') };
  await Promise.all(
    Object.entries(files)
      .filter(([, content]) => content !== undefined)
      .map(async ([path, content]) => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), content);
      }),
  );
  return root;
};

const runIn = (root, ...args) => {
  // eslint-disable-next-line node/no-sync -- a test drives the script as CI does, one process at a time
  const result = spawnSync(process.execPath, [join(root, 'scripts/codex-plugin.mjs'), ...args], {
    encoding: 'utf8',
  });
  return { code: result.status, stderr: result.stderr };
};

test('a plugin in step with the skill and the CLI passes', async () => {
  strictEqual(runIn(await makeTree(), '--check').code, EXIT_OK);
});

test('an edited skill without a refreshed copy fails and names the file', async () => {
  const root = await makeTree({ 'skills/refs/SKILL.md': '---\nname: refs\n---\n\n# edited\n' });
  const { code, stderr } = runIn(root, '--check');
  strictEqual(code, EXIT_PROBLEMS);
  match(stderr, /SKILL\.md: differs in codex-plugin\/skills\/refs/u);
});

test('a file only in the copy, or only in the skill, fails', async () => {
  const extra = await makeTree({ 'codex-plugin/skills/refs/stale.md': 'old\n' });
  match(runIn(extra, '--check').stderr, /stale\.md: not in skills\/refs/u);
  const missing = await makeTree({ 'codex-plugin/skills/refs/agents/openai.yaml': undefined });
  match(runIn(missing, '--check').stderr, /agents\/openai\.yaml: missing from/u);
});

test('a plugin version other than the CLI version fails', async () => {
  const root = await makeTree({ 'codex-plugin/plugin.json': manifest('9.9.9') });
  const { code, stderr } = runIn(root, '--check');
  strictEqual(code, EXIT_PROBLEMS);
  match(stderr, /\.version is "9\.9\.9", packages\/cli\/package\.json is "1\.2\.3"/u);
});

test('anything Codex could run from the plugin fails the check', async () => {
  const cases = [
    { 'codex-plugin/hooks/hooks.json': '{"hooks":{}}\n' },
    { 'codex-plugin/mcp.json': '{"mcpServers":{}}\n' },
    { 'codex-plugin/.mcp.json': '{"mcpServers":{}}\n' },
    { 'codex-plugin/.app.json': '{"apps":{}}\n' },
    { 'codex-plugin/plugin.json': manifest(VERSION, { hooks: './hooks.json' }) },
    { 'codex-plugin/plugin.json': manifest(VERSION, { extensions: { 'com.openai': { hooks: [] } } }) },
    { 'codex-plugin/plugin.json': manifest(VERSION, { mcpServers: './.mcp.json' }) },
  ];
  const results = await Promise.all(cases.map(async (overrides) => runIn(await makeTree(overrides), '--check')));
  for (const [index, { code, stderr }] of results.entries()) {
    strictEqual(code, EXIT_PROBLEMS, JSON.stringify(cases[index]));
    match(stderr, /carries nothing Codex could run/u);
  }
});

test('an executable file in the skill fails the check', { skip: process.platform === 'win32' }, async () => {
  const root = await makeTree({ 'codex-plugin/skills/refs/run.sh': '#!/bin/sh\n', 'skills/refs/run.sh': '#!/bin/sh\n' });
  await chmod(join(root, 'skills/refs/run.sh'), EXECUTABLE);
  const { code, stderr } = runIn(root, '--check');
  strictEqual(code, EXIT_PROBLEMS);
  match(stderr, /skills\/refs\/run\.sh is executable/u);
});

test('--write refreshes the copy and the version, and the check then passes', async () => {
  const root = await makeTree({
    'codex-plugin/plugin.json': manifest('0.0.1'),
    'codex-plugin/skills/refs/stale.md': 'old\n',
    'skills/refs/SKILL.md': '---\nname: refs\n---\n\n# edited\n',
  });
  strictEqual(runIn(root, '--write').code, EXIT_OK);
  strictEqual(runIn(root, '--check').code, EXIT_OK);
  const copied = await readdir(join(root, 'codex-plugin/skills/refs'));
  strictEqual(copied.includes('stale.md'), false);
  match(await readFile(join(root, 'codex-plugin/plugin.json'), 'utf8'), /"version": "1\.2\.3"/u);
});

test('an unknown mode is a usage error', async () => {
  strictEqual(runIn(await makeTree(), '--frobnicate').code, EXIT_USAGE);
});
