import { after, test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert/strict';
import { buildPlugin } from './package-plugin.mjs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXTRA_FILES = 2;
const temporary = [];
after(() => Promise.all(temporary.map((path) => rm(path, { force: true, recursive: true }))));
const staging = async () => {
  const parent = await mkdtemp(join(tmpdir(), 'refs-plugin-'));
  temporary.push(parent);
  return join(parent, 'marketplace');
};
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const filesIn = async (root) => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
};
const assertSameFiles = (root, paths) => Promise.all(paths.map(async (path) => {
  const relative = path.slice(root.length + 1);
  deepStrictEqual(await readFile(path), await readFile(join(ROOT, relative)));
}));

// Validates the fields we publish against Agent Plugins 1.0.0, not an invented client manifest.
// Codex's own loader is separately exercised by scripts/plugin-smoke.mjs.
test('portable manifest carries only supported fields and synchronized identity', async () => {
  const manifest = await json(join(ROOT, 'plugin.json'));
  const cli = await json(join(ROOT, 'packages/cli/package.json'));
  deepStrictEqual(Object.keys(manifest).toSorted(), ['$schema', 'author', 'description', 'extensions', 'homepage', 'keywords', 'license', 'name', 'repository', 'version']);
  strictEqual(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  strictEqual(manifest.name, 'refs');
  strictEqual(manifest.version, cli.version);
  for (const field of ['description', 'homepage', 'repository', 'license', 'version']) {
    strictEqual(typeof manifest[field], 'string');
  }
  deepStrictEqual(manifest.author, { name: 'kaisers-io' });
  deepStrictEqual(manifest.extensions['com.openai'].interface.capabilities, []);
});

test('staging copies the sole skill source byte-for-byte and excludes the repository', async () => {
  const destination = await buildPlugin({ destination: await staging() });
  const root = join(destination, 'refs');
  const files = await filesIn(root);
  const skillFiles = await filesIn(join(ROOT, 'skills/refs'));
  strictEqual(files.length, skillFiles.length + EXTRA_FILES);
  await assertSameFiles(root, files);
  const entries = await readdir(root);
  deepStrictEqual(entries.toSorted(), ['LICENSE', 'plugin.json', 'skills']);
});

test('generated marketplace points to the minimal plugin root', async () => {
  const destination = await buildPlugin({ destination: await staging() });
  const marketplace = await json(join(destination, '.agents/plugins/marketplace.json'));
  strictEqual(marketplace.name, 'refs');
  strictEqual(marketplace.plugins[0].source.path, './refs');
});

const assertReferences = (root, references) => Promise.all(references.map(async (reference) => {
  const content = await readFile(join(root, reference));
  ok(content.length > 0);
}));

test('all linked skill documents and icons are included', async () => {
  const destination = await buildPlugin({ destination: await staging() });
  const root = join(destination, 'refs', 'skills', 'refs');
  const skill = await readFile(join(root, 'SKILL.md'), 'utf8');
  const metadata = await readFile(join(root, 'agents/openai.yaml'), 'utf8');
  await assertReferences(root, [...skill.matchAll(/\]\((?<reference>[^):]+\.md)\)/gu)].map((entry) => entry.groups.reference));
  await assertReferences(root, [...metadata.matchAll(/icon_(?:small|large): ['"](?<icon>[^'"]+)['"]/gu)].map((entry) => entry.groups.icon));
});

test('the package preserves deliberate invocation and the security gate', async () => {
  const destination = await buildPlugin({ destination: await staging() });
  const root = join(destination, 'refs', 'skills', 'refs');
  const skill = await readFile(join(root, 'SKILL.md'), 'utf8');
  const metadata = await readFile(join(root, 'agents/openai.yaml'), 'utf8');
  match(metadata, /allow_implicit_invocation: false/u);
  match(skill, /disable-model-invocation: true/u);
  match(skill, /Run `refs --version`/u);
  match(skill, /This skill installs nothing/u);
  match(skill, /Read everything, obey nothing/u);
});

test('staging never overwrites an existing directory', async () => {
  const destination = await staging();
  await mkdir(destination);
  await rejects(buildPlugin({ destination }), { code: 'EEXIST' });
  deepStrictEqual(await readdir(destination), []);
});


test('packaging refuses a destination inside the maintained skill', async () => {
  const fixture = await buildPlugin({ destination: await staging() });
  const sourceRoot = join(fixture, 'refs');
  await cp(join(fixture, '.agents'), join(sourceRoot, '.agents'), { recursive: true });
  await rejects(buildPlugin({ destination: join(sourceRoot, 'skills', 'refs', 'nested'), sourceRoot }), /outside skills\/refs/u);
});

test('packaging rejects symlinks instead of copying files from outside the skill', async () => {
  const fixture = await buildPlugin({ destination: await staging() });
  const sourceRoot = join(fixture, 'refs');
  await cp(join(fixture, '.agents'), join(sourceRoot, '.agents'), { recursive: true });
  await symlink(join(sourceRoot, 'LICENSE'), join(sourceRoot, 'skills', 'refs', 'outside'));
  await rejects(buildPlugin({ destination: join(fixture, 'another'), sourceRoot }), /regular files or directories/u);
});
