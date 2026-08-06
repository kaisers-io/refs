import { chmod } from 'node:fs/promises';
import { defineConfig } from 'tsdown';

const BUNDLE_PATH = 'dist/refs.mjs';
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
  // Size is the whole argument: 199 KB minified against 452 KB without, for a package users
  // install globally. `true` is tsdown 0.22's full minification (mangle + compress + strip
  // comments, per its `MinifyOptions`).
  //
  // This setting used to carry a different reason — that an unminified bundle would ship every
  // source comment, including design and security rationale, to anyone unpacking the tarball —
  // and an instruction to revert it once the repository went public. That reason was wrong.
  // Building both ways shows rolldown drops source comments either way: what survives is
  // `//#region` markers and `@__NO_SIDE_EFFECTS__` annotations, and not one line of prose. So
  // there is nothing to revisit here on going public; only the size trade-off applies.
  minify: true,
  onSuccess: async () => {
    await chmod(BUNDLE_PATH, EXECUTABLE_MODE);
  },
  outDir: 'dist',
  outExtensions: () => ({ js: '.mjs' }),
  outputOptions: { banner: '#!/usr/bin/env node' },
  platform: 'node',
  target: 'node24',
});
