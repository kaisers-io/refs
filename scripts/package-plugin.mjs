#!/usr/bin/env node
// Stage an installable, dependency-free Codex marketplace without copying the checkout itself.
// The destination must not exist: never overwrite an installed package or unrelated user files.
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const JSON_INDENT = 2;
const CLI_ARG_COUNT = 3;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// This distribution intentionally contains instructions and static assets only. Reject new
// executable surfaces rather than silently copying them into the installed plugin.
const EXECUTABLE_BITS = 0o111;
const skillFile = /^(?:[^/]+\.md|agents\/openai\.yaml|assets\/[^/]+\.(?:png|jpe?g|webp|gif))$/u;
const validateSkillFile = async (source, path) => {
  const info = await stat(source);
  if (!skillFile.test(path) || (info.mode & EXECUTABLE_BITS) !== 0) {
    throw new Error(`Unsupported executable or non-instruction plugin content: ${path}`);
  }
};
const validateManifest = async (sourceRoot) => {
  const text = await readFile(join(sourceRoot, 'plugin.json'), 'utf8');
  const manifest = JSON.parse(text);
  for (const scope of [manifest, manifest.extensions?.['com.openai'] ?? {}]) {
    for (const key of ['hooks', 'mcpServers', 'apps']) {
      if (Object.hasOwn(scope, key)) {
        throw new Error(`Unsupported plugin execution surface: ${key}`);
      }
    }
  }
};
const copyTree = async (source, destination, prefix = '') => {
  await mkdir(destination);
  const entries = await readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        throw new Error(`Plugin sources must be regular files or directories: ${entry.name}`);
      }
      const from = join(source, entry.name);
      const to = join(destination, entry.name);
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        return copyTree(from, to, `${path}/`);
      }
      await validateSkillFile(from, path);
      return copyFile(from, to);
    }),
  );
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
  const marketplace = JSON.parse(
    await readFile(join(sourceRoot, '.agents/plugins/marketplace.json'), 'utf8'),
  );
  await validateManifest(sourceRoot);
  marketplace.plugins[0].source.path = './refs';
  await prepareDestination(sourceRoot, destination);
  await mkdir(join(destination, 'refs', 'skills'), { recursive: true });
  await copyTree(join(sourceRoot, 'skills', 'refs'), join(destination, 'refs', 'skills', 'refs'));
  await Promise.all(
    ['plugin.json', 'LICENSE'].map((file) =>
      copyFile(join(sourceRoot, file), join(destination, 'refs', file)),
    ),
  );
  await mkdir(join(destination, '.agents', 'plugins'), { recursive: true });
  await writeFile(
    join(destination, '.agents', 'plugins', 'marketplace.json'),
    `${JSON.stringify(marketplace, undefined, JSON_INDENT)}\n`,
  );
  return destination;
};

const main = async () => {
  const [destination] = process.argv.slice(CLI_ARG_COUNT - 1);
  if (process.argv.length !== CLI_ARG_COUNT || destination === undefined) {
    throw new Error('Usage: node scripts/package-plugin.mjs <new-destination-directory>');
  }
  console.log(await buildPlugin({ destination: resolve(destination) }));
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export { buildPlugin };
