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

// Node error codes a broken/un-installed source tree can realistically throw when the stub
// tries `await import(...)` on src/main.ts or src/context.ts: missing workspace deps (no
// `pnpm install`), TypeScript syntax Node's type stripping can't erase, or an extension Node
// refuses to load as a module.
const SOURCE_LOAD_ERROR_CODES = new Set([
  'ERR_MODULE_NOT_FOUND',
  'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
  'ERR_UNKNOWN_FILE_EXTENSION',
]);

const [major = FALLBACK_VERSION_PART, minor = FALLBACK_VERSION_PART] = process.versions.node
  .split('.')
  .map(Number);
if (
  major < REQUIRED_NODE_MAJOR ||
  (major === REQUIRED_NODE_MAJOR && minor < REQUIRED_NODE_MINOR_MIN)
) {
  console.error(
    `refs requires Node.js >=24.12 — you are running Node.js ${process.versions.node}.`,
  );
  console.error('Install a matching version, e.g.: nvm install 24');
  process.exit(EXIT_FAILURE);
}

const printNotBuiltMessage = () => {
  console.error('refs is not built — the CLI bundle (dist/refs.mjs) is missing.');
  console.error('Run: pnpm install && pnpm build   (or `pnpm dev` in packages/cli for watch mode)');
};

const isSourceLoadError = (error) =>
  error instanceof Error && SOURCE_LOAD_ERROR_CODES.has(error.code);

const printSourceLoadFailure = (error) => {
  const [firstLine = ''] = error.message.split('\n');
  console.error(`refs could not run from source (${error.code}: ${firstLine})`);
  console.error('Run: pnpm install && pnpm build');
};

// Imports the two source modules the dev fallback needs. Split out of loadFromSource so the
// narrow try/catch around the import calls stays isolated: a module-loading failure here gets
// an actionable message, while a failure from actually running the CLI (see the bottom of this
// file) must keep propagating unchanged.
const importSourceModules = async (srcMain) => {
  try {
    const { run } = await import(pathToFileURL(srcMain).href);
    const { realContext } = await import(
      pathToFileURL(join(import.meta.dirname, '../src/context.ts')).href
    );
    return { realContext, run };
  } catch (error) {
    if (!isSourceLoadError(error)) {
      throw error;
    }
    printSourceLoadFailure(error);
    process.exit(EXIT_FAILURE);
  }
};

// Dev fallback: run the TypeScript source directly via Node's native type stripping
// (stable in the exact engine range this package requires). Works only in a workspace
// checkout where ../src exists; the published package always ships dist/.
const loadFromSource = () => {
  const srcMain = join(import.meta.dirname, '../src/main.ts');
  // eslint-disable-next-line node/no-sync -- one-shot startup check before any I/O; simplest correct option for a zero-dependency stub
  if (!existsSync(srcMain)) {
    printNotBuiltMessage();
    process.exit(EXIT_FAILURE);
    // Unreachable in practice — defense-in-depth in case process.exit is ever intercepted.
    return;
  }
  return importSourceModules(srcMain);
};

const bundle = join(import.meta.dirname, '../dist/refs.mjs');
let loadModules = loadFromSource;
// eslint-disable-next-line node/no-sync -- one-shot startup check before any I/O; simplest correct option for a zero-dependency stub
if (existsSync(bundle)) {
  loadModules = () => import(pathToFileURL(bundle).href);
}

const { realContext, run } = await loadModules();
await run(realContext(), process.argv);
