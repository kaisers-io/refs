#!/usr/bin/env node
// Stage an installable, dependency-free Codex marketplace without copying the checkout itself.
// The destination must not exist: never overwrite an installed package or unrelated user files.
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { copyFile, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const JSON_INDENT = 2;
const CLI_ARG_COUNT = 3;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const copyTree = async (source, destination) => {
  await mkdir(destination);
  const entries = await readdir(source, { withFileTypes: true });
  await Promise.all(entries.map((entry) => {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      throw new Error(`Plugin sources must be regular files or directories: ${entry.name}`);
    }
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    return entry.isDirectory() ? copyTree(from, to) : copyFile(from, to);
  }));
};

const outsideSkill = (source, destination) => {
  const path = relative(source, destination);
  if (path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))) {
    throw new Error('Plugin destination must be outside skills/refs');
  }
};

const prepareDestination = async (sourceRoot, destination) => {
  outsideSkill(resolve(sourceRoot, 'skills', 'refs'), resolve(destination));
  await mkdir(dirname(destination), { recursive: true });
  const source = await realpath(join(sourceRoot, 'skills', 'refs'));
  const parent = await realpath(dirname(destination));
  outsideSkill(source, join(parent, basename(destination)));
  await mkdir(destination);
};

const buildPlugin = async ({ destination, sourceRoot = ROOT }) => {
  const marketplace = JSON.parse(await readFile(join(sourceRoot, '.agents/plugins/marketplace.json'), 'utf8'));
  marketplace.plugins[0].source.path = './refs';
  await prepareDestination(sourceRoot, destination);
  await mkdir(join(destination, 'refs', 'skills'), { recursive: true });
  await copyTree(join(sourceRoot, 'skills', 'refs'), join(destination, 'refs', 'skills', 'refs'));
  await Promise.all(['plugin.json', 'LICENSE'].map((file) => copyFile(join(sourceRoot, file), join(destination, 'refs', file))));
  await mkdir(join(destination, '.agents', 'plugins'), { recursive: true });
  await writeFile(join(destination, '.agents', 'plugins', 'marketplace.json'), `${JSON.stringify(marketplace, undefined, JSON_INDENT)}\n`);
  return destination;
};

const main = async () => {
  const [destination] = process.argv.slice(CLI_ARG_COUNT - 1);
  if (process.argv.length !== CLI_ARG_COUNT || destination === undefined) {
    throw new Error('Usage: node scripts/package-plugin.mjs <new-destination-directory>');
  }
  console.log(await buildPlugin({ destination: resolve(destination) }));
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

export { buildPlugin };
