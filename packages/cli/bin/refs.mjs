#!/usr/bin/env node
// Committed stub — the published/linked `refs` executable. The real CLI is the tsdown
// bundle at ../dist/refs.mjs (gitignored build output; `pnpm build` produces it). This
// file exists so the bin path is always valid: a fresh clone gets an actionable message
// instead of a broken symlink and a shell-level "command not found".
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 12) {
  console.error(
    `refs requires Node.js >=24.12 <25 — you are running Node.js ${process.versions.node}.`,
  );
  console.error('Install a matching version, e.g.: nvm install 24');
  process.exit(1);
}

const bundle = join(import.meta.dirname, '../dist/refs.mjs');
if (!existsSync(bundle)) {
  console.error('refs is not built in this checkout — the CLI bundle (dist/refs.mjs) is missing.');
  console.error('Run: pnpm install && pnpm build   (or `pnpm dev` in packages/cli for watch mode)');
  process.exit(1);
}

const { realContext, run } = await import(pathToFileURL(bundle).href);
await run(realContext(), process.argv);
