import { buildProgram, realContext, registerCommands, run, wrapAction } from '../src/index.ts';
import { describe, expect, it } from 'vitest';

// The package entry is what programmatic consumers (and the bin stub's source fallback) import —
// this pins the public surface: importing it must be side-effect-free (the CLI only runs behind
// `import.meta.main`) and must re-export the documented API from each submodule.
describe('package entry', () => {
  it('does not run the CLI as a side effect of importing the entry', () => {
    expect.hasAssertions();
    // If the `import.meta.main` guard regressed and the CLI ran on import, `run` would have set
    // a real exit code on this very process by the time this test executes.
    expect(process.exitCode).toBeUndefined();
  });

  it('re-exports the CLI API from every submodule', () => {
    expect.hasAssertions();
    expect(run).toBeTypeOf('function');
    expect(realContext).toBeTypeOf('function');
    expect(buildProgram).toBeTypeOf('function');
    expect(registerCommands).toBeTypeOf('function');
    expect(wrapAction).toBeTypeOf('function');
  });
});
