// Tests for scripts/versions.mjs — the script that gates every PR and every release.
//
//   node --test scripts/versions.test.mjs
//
// Node's built-in runner, not vitest, on purpose: the script is deliberately dependency-free so
// both workflows can run it before `pnpm install`, and `vitest.config.ts` only collects
// `packages/*` anyway. This suite keeps that property — it needs nothing installed either.
//
// The script resolves its root from `import.meta.url` and takes no root argument, so rather than
// widen its interface each test copies it into a throwaway tree's `scripts/` directory and runs
// the copy. The real five files are never read, never written, and never even on the path.

import { after, test } from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { match, notStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const SCRIPT = fileURLToPath(new URL('versions.mjs', import.meta.url));
const SOURCE = 'packages/cli/package.json';
const MARKETPLACE = '.claude-plugin/marketplace.json';
const CODEX = '.codex-plugin/plugin.json';
const SKILL = 'skills/refs/SKILL.md';

const EXIT_OK = 0;
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;
const THREE = 3;
const READ_ONLY = 0o444;
const READ_WRITE = 0o644;
// The read-only bit is what makes a mid-flight write fail; root ignores it, so skip there.
const AS_ROOT = process.getuid === undefined || process.getuid() === 0;

const AT = '1.2.3';
const NEXT = '2.0.0';
const WRONG = '9.9.9';

// Fixture renderers, one per site, shaped like the real files: `"version"` always starts its own
// line, because that is what the script's surgical rewrite anchors to.
const pkg = (version) => `{\n  "name": "@kaisers-io/refs",\n  "version": "${version}",\n  "type": "module"\n}\n`;
const plugin = (version) =>
  `{\n  "name": "refs",\n  "description": "no version key here",\n  "version": "${version}"\n}\n`;
const marketplace = (version) =>
  `{\n  "name": "kaisers-io",\n  "plugins": [\n    {\n      "name": "refs",\n      "version": "${version}"\n    }\n  ]\n}\n`;
const skillDoc = (version) =>
  `---\nname: refs\nmetadata:\n  cli_version: '${version}'\n---\n\n# refs\n\nProse about version pins.\n`;

const FILES = {
  [SOURCE]: pkg,
  '.claude-plugin/plugin.json': plugin,
  [MARKETPLACE]: marketplace,
  [CODEX]: plugin,
  [SKILL]: skillDoc,
};

const trees = [];
after(() => Promise.all(trees.map((root) => rm(root, { force: true, recursive: true }))));

/** A throwaway tree with a copy of the script. `overrides` replaces content; `undefined` omits a file. */
const makeTree = async (overrides = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'refs-versions-'));
  trees.push(root);
  const files = { 'scripts/versions.mjs': await readFile(SCRIPT, 'utf8') };
  for (const [path, render] of Object.entries(FILES)) {
    files[path] = render(AT);
  }
  await Promise.all(
    Object.entries({ ...files, ...overrides })
      .filter(([, content]) => content !== undefined)
      .map(async ([path, content]) => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), content);
      }),
  );
  return root;
};

const run = (root, ...args) => {
  // eslint-disable-next-line node/no-sync -- a test shelling out to a CLI; async buys nothing here
  const { status, stderr, stdout } = spawnSync(process.execPath, [join(root, 'scripts/versions.mjs'), ...args], {
    encoding: 'utf8',
  });
  const errors = stderr.split('\n').filter((line) => line.startsWith('::error::'));
  return { code: status, err: stderr, errors, out: stdout };
};

const readTree = (root) =>
  Promise.all(Object.keys(FILES).map(async (file) => [file, await readFile(join(root, file), 'utf8')]));

test('--check passes on a consistent tree', async () => {
  const { code, out } = run(await makeTree(), '--check');
  strictEqual(code, EXIT_OK);
  match(out, /version 1\.2\.3 is consistent across all five sites/u);
});

// The load-bearing case: a wrong value at any one of the five sites must be caught and named. A
// wrong source of truth is the mirror image — the other four are what get reported as disagreeing.
for (const [file, render] of Object.entries(FILES)) {
  test(`--check fails, naming the site, when ${file} alone says ${WRONG}`, async () => {
    const { code, err, errors } = run(await makeTree({ [file]: render(WRONG) }), '--check');
    strictEqual(code, EXIT_PROBLEMS);
    const named = file === SOURCE ? Object.keys(FILES).filter((other) => other !== SOURCE) : [file];
    strictEqual(errors.length, named.length, `expected ${named.length} problems, got: ${err}`);
    for (const site of named) {
      ok(
        errors.some((line) => line.startsWith(`::error::${site}`) && line.includes(WRONG)),
        `${site} not reported as disagreeing in: ${err}`,
      );
    }
  });
}

test('--check fails on a plugins[] entry with no version at all', async () => {
  const entry = '{\n  "plugins": [\n    {\n      "name": "refs"\n    }\n  ]\n}\n';
  const { code, errors } = run(await makeTree({ [MARKETPLACE]: entry }), '--check');
  strictEqual(code, EXIT_PROBLEMS);
  match(errors.join('\n'), /marketplace\.json \.plugins\[0\] \(refs\) says \(no version field\)/u);
});

test('--check fails on malformed JSON without throwing a stack trace', async () => {
  const { code, err, errors } = run(await makeTree({ [CODEX]: '{ "version": ' }), '--check');
  strictEqual(code, EXIT_PROBLEMS);
  match(errors.join('\n'), /\.codex-plugin\/plugin\.json is not valid JSON/u);
  ok(!err.includes('at Object.'), `stack trace leaked: ${err}`);
});

test('--check fails on a missing file', async () => {
  const { code, errors } = run(await makeTree({ [SKILL]: undefined }), '--check');
  strictEqual(code, EXIT_PROBLEMS);
  match(errors.join('\n'), /skills\/refs\/SKILL\.md could not be read/u);
});

test('--check fails on plugins: [null]', async () => {
  const { code, errors } = run(await makeTree({ [MARKETPLACE]: '{\n  "plugins": [null]\n}\n' }), '--check');
  strictEqual(code, EXIT_PROBLEMS);
  match(errors.join('\n'), /marketplace\.json \.plugins\[0\] is not a JSON object/u);
});

test('--check fails when the source of truth has no usable version', async () => {
  const { code, errors } = run(await makeTree({ [SOURCE]: '{\n  "name": "@kaisers-io/refs"\n}\n' }), '--check');
  strictEqual(code, EXIT_PROBLEMS);
  match(errors.join('\n'), /packages\/cli\/package\.json has no usable \.version/u);
});

// One run, every problem: at release time nobody should need a second CI run to find the next one.
test('--check reports every problem in a single run', async () => {
  const overrides = { '.claude-plugin/plugin.json': plugin(WRONG), [CODEX]: 'not json at all', [SKILL]: skillDoc(WRONG) };
  const { code, err, errors } = run(await makeTree(overrides), '--check');
  strictEqual(code, EXIT_PROBLEMS);
  strictEqual(errors.length, THREE, `expected three problems, got: ${err}`);
  ok(errors.some((line) => line.includes('.claude-plugin/plugin.json')), err);
  ok(errors.some((line) => line.includes('.codex-plugin/plugin.json is not valid JSON')), err);
  ok(errors.some((line) => line.includes('SKILL.md metadata.cli_version')), err);
});

test('--set round-trips: --check passes afterwards, and only version lines moved', async () => {
  const root = await makeTree();
  const before = new Map(await readTree(root));
  const bump = run(root, '--set', NEXT);
  strictEqual(bump.code, EXIT_OK);
  match(bump.out, /all five version sites now declare 2\.0\.0/u);
  strictEqual(run(root, '--check').code, EXIT_OK);
  for (const [file, current] of await readTree(root)) {
    notStrictEqual(current, before.get(file), `${file} was not bumped`);
    // Undo the version substitution: anything else that moved would show up as a mismatch here.
    strictEqual(current.replaceAll(NEXT, AT), before.get(file), `${file} changed outside its version line`);
  }
});

// SemVer proper, not `\d+.\d+.\d+`: leading zeros are invalid and npm would reject them at publish.
for (const bad of ['01.2.3', '1.02.3', '1.2.3-01', '1.2', 'v1.2.3', '1.2.3-', '', 'latest']) {
  test(`--set refuses ${JSON.stringify(bad)} and writes nothing`, async () => {
    const root = await makeTree();
    const { code, err } = run(root, '--set', bad);
    strictEqual(code, EXIT_USAGE);
    match(err, /is not a valid semantic version/u);
    const source = await readFile(join(root, SOURCE), 'utf8');
    strictEqual(source, pkg(AT), 'the tree was touched by a refused --set');
  });
}

for (const good of ['0.6.0', '1.2.3', '1.2.3-rc.1', '1.2.3+build.5', '0.0.0']) {
  test(`--set accepts ${good}`, async () => {
    const root = await makeTree();
    strictEqual(run(root, '--set', good).code, EXIT_OK);
    strictEqual(run(root, '--check').code, EXIT_OK);
    const skill = await readFile(join(root, SKILL), 'utf8');
    ok(skill.includes(`cli_version: '${good}'`), skill);
  });
}

// A site that reads fine but cannot be rewritten must stop the bump before any byte is written.
test('--set refuses the whole bump when one site is unrewritable, and writes nothing', async () => {
  const root = await makeTree({ '.claude-plugin/plugin.json': '{ "name": "refs", "version": "1.2.3" }\n' });
  const before = new Map(await readTree(root));
  const { code, err } = run(root, '--set', NEXT);
  strictEqual(code, EXIT_PROBLEMS);
  match(err, /refusing to edit it/u);
  match(err, /nothing was written/u);
  for (const [file, current] of await readTree(root)) {
    strictEqual(current, before.get(file), `${file} was written despite the refusal`);
  }
});

/** Once writing has begun the script must never claim nothing was written — it must name the damage. */
const assertHalfBumped = (err) => {
  match(err, /\.codex-plugin\/plugin\.json could not be written/u);
  match(err, /the tree is half-bumped/u);
  ok(!err.includes('nothing was written'), `the operator was told a falsehood: ${err}`);
  const line = err.split('\n').find((text) => text.includes('half-bumped'));
  ok(line.includes(SOURCE) && line.includes(MARKETPLACE), line);
  ok(!line.includes(SKILL), `${SKILL} was never written but is listed as bumped: ${line}`);
};

test('--set names the half-bumped tree when a write fails mid-flight', { skip: AS_ROOT }, async () => {
  const root = await makeTree();
  const locked = join(root, CODEX);
  await chmod(locked, READ_ONLY);
  const { code, err } = run(root, '--set', NEXT);
  await chmod(locked, READ_WRITE);
  strictEqual(code, EXIT_PROBLEMS);
  assertHalfBumped(err);
  strictEqual(await readFile(join(root, SKILL), 'utf8'), skillDoc(AT), 'a later site was written anyway');
  strictEqual(await readFile(join(root, SOURCE), 'utf8'), pkg(NEXT), 'an earlier site was not written');
});

test('an unrecognised invocation is a usage error', async () => {
  const root = await makeTree();
  strictEqual(run(root).code, EXIT_USAGE);
  strictEqual(run(root, '--check', 'extra').code, EXIT_USAGE);
  strictEqual(run(root, '--set').code, EXIT_USAGE);
});
