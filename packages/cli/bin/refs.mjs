#!/usr/bin/env node
// Committed stub — the published/linked `refs` executable. The real CLI is the tsdown
// bundle at ../dist/refs.mjs (gitignored build output; `pnpm build` produces it). This
// file exists so the bin path is always valid: a fresh clone gets an actionable message
// instead of a broken symlink and a shell-level "command not found".
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_NODE_MAJOR = 24;
const REQUIRED_NODE_MINOR_MIN = 12;
const EXIT_FAILURE = 1;
const FALLBACK_VERSION_PART = 0;

const [major = FALLBACK_VERSION_PART, minor = FALLBACK_VERSION_PART] = process.versions.node
  .split('.')
  .map(Number);
if (major !== REQUIRED_NODE_MAJOR || minor < REQUIRED_NODE_MINOR_MIN) {
  console.error(
    `refs requires Node.js >=24.12 <25 — you are running Node.js ${process.versions.node}.`,
  );
  console.error('Install a matching version, e.g.: nvm install 24');
  process.exit(EXIT_FAILURE);
}

// Dev fallback: run the TypeScript source directly via Node's native type stripping
// (stable in the exact engine range this package requires). Works only in a workspace
// checkout where ../src exists; the published package always ships dist/.
const loadFromSource = async () => {
  const srcMain = join(import.meta.dirname, '../src/main.ts');
  // eslint-disable-next-line node/no-sync -- one-shot startup check before any I/O; simplest correct option for a zero-dependency stub
  if (!existsSync(srcMain)) {
    console.error('refs is not built — the CLI bundle (dist/refs.mjs) is missing.');
    console.error(
      'Run: pnpm install && pnpm build   (or `pnpm dev` in packages/cli for watch mode)',
    );
    process.exit(EXIT_FAILURE);
  }
  const { run } = await import(pathToFileURL(srcMain).href);
  const { realContext } = await import(
    pathToFileURL(join(import.meta.dirname, '../src/context.ts')).href
  );
  return { realContext, run };
};

const bundle = join(import.meta.dirname, '../dist/refs.mjs');
let loadModules = loadFromSource;
// eslint-disable-next-line node/no-sync -- one-shot startup check before any I/O; simplest correct option for a zero-dependency stub
if (existsSync(bundle)) {
  loadModules = () => import(pathToFileURL(bundle).href);
}

const { realContext, run } = await loadModules();
await run(realContext(), process.argv);
