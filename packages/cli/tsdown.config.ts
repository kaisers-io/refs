import { chmod } from 'node:fs/promises';
import { defineConfig } from 'tsdown';

const BUNDLE_PATH = 'bin/refs.mjs';
const EXECUTABLE_MODE = 0o755;

// Deterministic single-file ESM bundle: no hashes in the filename so CI can prove the build is
// reproducible (scripts/check-bundle-determinism.sh builds twice and compares sha256 output).
// Minification is still deterministic for a fixed input (rolldown/oxc's minifier has no
// randomness/timestamps), so it doesn't break that check.
//
// Entry is `src/index.ts`, not `src/main.ts`: `main.ts` only exports `run` (a library module), the
// `if (import.meta.main)` self-invocation that actually executes the CLI when run as a script
// lives in `index.ts`. Bundling `main.ts` alone would produce a shebang script that defines `run`
// but never calls it. Verified empirically that `import.meta.main` survives bundling (it's native
// Node ESM syntax, not something rolldown rewrites) and evaluates `true` when the bundle is
// invoked directly — see task-25-report.md.
// Key order below is alphabetical (not the brief's grouping) to satisfy the repo's
// `eslint(sort-keys)` lint rule, which applies to every object literal including this one.
export default defineConfig({
  clean: false,
  // `noExternal` (as written in the brief) works but tsdown 0.22.3 logs a deprecation warning on
  // every build ("`noExternal` is deprecated. Use `deps.alwaysBundle` instead."); `deps.alwaysBundle`
  // is the documented replacement and accepts the same `[/.*/]` "bundle everything" pattern for a
  // self-contained CLI, so it's used here to keep builds warning-free.
  deps: { alwaysBundle: [/.*/u] },
  dts: false,
  entry: { refs: 'src/index.ts' },
  format: 'esm',
  // The GitHub repo is private but the npm package is public: an unminified bundle would ship
  // every source comment (including design/security rationale) to anyone who runs `npm view` or
  // unpacks the tarball. `true` is tsdown 0.22's default full minification (mangle + compress +
  // strip comments, per its `MinifyOptions`); revert to `false` once the repo goes public and
  // shipping readable source is no longer a concern.
  minify: true,
  onSuccess: async () => {
    await chmod(BUNDLE_PATH, EXECUTABLE_MODE);
  },
  outDir: 'bin',
  outExtensions: () => ({ js: '.mjs' }),
  outputOptions: { banner: '#!/usr/bin/env node' },
  platform: 'node',
  target: 'node24',
});
