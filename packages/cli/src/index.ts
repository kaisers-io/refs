import { realContext } from './context.ts';
import { run } from './main.ts';

if (import.meta.main) {
  await run(realContext(), process.argv);
}

export * from './commands/registry.ts';
export * from './context.ts';
export * from './main.ts';
export * from './output.ts';
