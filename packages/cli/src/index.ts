import { realContext } from './context.ts';
import { run } from './main.ts';

/* v8 ignore start -- `import.meta.main` is only true when this file IS the process entrypoint;
   the in-process test runner always imports it as a module, so this branch is exercised solely by
   the spawned-CLI bin-stub tests, whose subprocess execution v8 coverage cannot observe. */
if (import.meta.main) {
  await run(realContext(), process.argv);
}
/* v8 ignore stop */

export * from './commands/registry.ts';
export * from './context.ts';
export * from './main.ts';
export * from './output.ts';
