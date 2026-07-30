import { chmod } from 'node:fs/promises';
import { defineConfig } from 'tsdown';

const BUNDLE_PATH = 'dist/refs.mjs';
const EXECUTABLE_MODE = 0o755;

// Deterministic single-file ESM bundle: no hashes in the filename so CI can prove the build is
// reproducible (scripts/check-bundle-determinism.sh builds twice and compares sha256 output).
// Rolldown's codegen has no randomness/timestamps, so the check holds either way.
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
  // Not minified. The published bundle IS the only auditable artifact a consumer of this package
  // gets (the npm tarball ships `dist/refs.mjs`, not `src/`), so it stays readable: reviewers and
  // supply-chain scanners can see what the CLI actually does instead of having to trust a mangled
  // blob. Minification would buy nothing in return — a globally installed CLI is not shipped over
  // the wire per invocation, so bundle size is not a user-visible cost.
  //
  // This does NOT leak internal rationale: rolldown always drops plain `//` and `/* */` comments
  // regardless of settings, and `outputOptions.comments` below additionally drops JSDoc, which is
  // where this repo keeps its design/security notes. Verified against the emitted bundle.
  minify: false,
  onSuccess: async () => {
    await chmod(BUNDLE_PATH, EXECUTABLE_MODE);
  },
  outDir: 'dist',
  outExtensions: () => ({ js: '.mjs' }),
  // `comments.jsdoc: false` is what keeps an unminified bundle from shipping this repo's `/** … */`
  // rationale blocks. `legal: true` is deliberate and must stay: a bundled dependency (smol-toml)
  // is BSD-3-Clause, whose binary-redistribution clause requires its copyright notice to travel
  // with the bundle. `annotation: true` only retains `@__PURE__` markers, which carry no prose.
  outputOptions: {
    banner: '#!/usr/bin/env node',
    comments: { annotation: true, jsdoc: false, legal: true },
  },
  platform: 'node',
  target: 'node24',
});
