#!/usr/bin/env node
// Local-only: requires Codex 0.159.2 and an unconditionally rebuilt CLI. No credentials or model
// requests are used. This tests client packaging/discovery, not behavioral agent compliance.
import { codex, discover, run } from './plugin-smoke/client.mjs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { deepStrictEqual, match, ok, strictEqual } from 'node:assert/strict';
import { buildPlugin } from './package-plugin.mjs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NEXT = '999.0.0';
const JSON_INDENT = 2;
const scratch = await mkdtemp(join(tmpdir(), 'refs-codex-plugin-'));
const options = { cwd: join(scratch, 'work'), env: { ...process.env, CODEX_HOME: join(scratch, 'codex'), HOME: join(scratch, 'user'), REFS_HOME: join(scratch, 'refs-home'), REFS_UPDATE_CHECK: '0' } };
const refs = async (...args) => JSON.parse(await run(process.execPath, [join(ROOT, 'packages/cli/bin/refs.mjs'), ...args, '--json'], options));
const skillCheck = async () => {
  const result = await refs('doctor');
  return result.data.checks.find((check) => check.name === 'skill');
};
const refsSkills = (result) => result.skills.filter((skill) => skill.name === 'refs' || skill.name === 'refs:refs');

const installAndDiscover = async (marketplace) => {
  await codex(['plugin', 'marketplace', 'add', marketplace, '--json'], options);
  const installed = await codex(['plugin', 'add', 'refs@refs', '--json'], options);
  strictEqual(installed.pluginId, 'refs@refs');
  const discovered = await discover(options);
  deepStrictEqual(discovered.errors, []);
  deepStrictEqual(refsSkills(discovered).map((skill) => skill.name), ['refs:refs']);
  const [skill] = refsSkills(discovered);
  strictEqual(skill.pluginId, 'refs@refs');
  await readFile(skill.interface.iconSmall);
  return installed;
};

const verifyContents = async (installed) => {
  const entries = await readdir(installed.installedPath);
  deepStrictEqual(entries.toSorted(), ['LICENSE', 'plugin.json', 'skills']);
  const skill = await readFile(join(installed.installedPath, 'skills/refs/SKILL.md'), 'utf8');
  const source = await readFile(join(ROOT, 'skills/refs/SKILL.md'), 'utf8');
  strictEqual(skill, source);
};

const verifyCombined = async () => {
  await mkdir(join(options.cwd, '.agents', 'skills'), { recursive: true });
  await cp(join(ROOT, 'skills', 'refs'), join(options.cwd, '.agents', 'skills', 'refs'), { recursive: true });
  const discovered = await discover(options);
  deepStrictEqual(refsSkills(discovered).map((skill) => skill.name).toSorted(), ['refs', 'refs:refs']);
  const check = await skillCheck();
  strictEqual(check.status, 'ok');
  match(check.detail, /both plugin and standalone/u);
};

const assertUpdatedDiscovery = async () => {
  const discovered = await discover(options);
  ok(refsSkills(discovered).some((entry) => entry.name === 'refs:refs' && entry.path.includes(NEXT)));
};

const rewriteVersion = async (marketplace) => {
  const manifest = join(marketplace, 'refs', 'plugin.json');
  const data = JSON.parse(await readFile(manifest, 'utf8'));
  data.version = NEXT;
  await writeFile(manifest, `${JSON.stringify(data, undefined, JSON_INDENT)}\n`);
  const skill = join(marketplace, 'refs', 'skills', 'refs', 'SKILL.md');
  const source = await readFile(skill, 'utf8');
  await writeFile(skill, source.replace(/cli_version: ['"][^'"]+['"]/u, `cli_version: '${NEXT}'`));
};

const verifyUpdate = async () => {
  const marketplace = await buildPlugin({ destination: join(scratch, 'marketplace-next') });
  await rewriteVersion(marketplace);
  await codex(['plugin', 'marketplace', 'remove', 'refs', '--json'], options);
  await codex(['plugin', 'marketplace', 'add', marketplace, '--json'], options);
  const updated = await codex(['plugin', 'add', 'refs@refs', '--json'], options);
  strictEqual(updated.version, NEXT);
  await assertUpdatedDiscovery();
};

const verifyRemoval = async () => {
  await run('codex', ['plugin', 'remove', 'refs@refs'], options);
  const listed = await codex(['plugin', 'list', '--json'], options);
  deepStrictEqual(listed.installed, []);
  const discovered = await discover(options);
  deepStrictEqual(refsSkills(discovered).map((skill) => skill.name), ['refs']);
  const check = await skillCheck();
  strictEqual(check.status, 'ok');
  ok(!check.detail.includes('plugin'));
};

const smoke = async () => {
  await mkdir(options.cwd, { recursive: true });
  await mkdir(options.env.HOME);
  await mkdir(options.env.CODEX_HOME);
  await run('git', ['init', '-q', options.cwd], options);
  const marketplace = await buildPlugin({ destination: join(scratch, 'marketplace') });
  await verifyContents(await installAndDiscover(marketplace));
  await refs('init');
  const check = await skillCheck();
  strictEqual(check.status, 'ok');
  match(check.detail, /Codex plugin refs@refs/u);
};

try {
  const version = await run('codex', ['--version'], { env: options.env });
  console.log(version.trim());
  await smoke();
  await verifyCombined();
  await verifyUpdate();
  await verifyRemoval();
  console.log('PASS: clean install, skill and asset discovery, plugin-only doctor, duplicate discovery, updates, removal, standalone doctor');
} finally {
  await rm(scratch, { force: true, recursive: true });
}
