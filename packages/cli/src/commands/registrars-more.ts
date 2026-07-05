import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { registerDoctor } from './doctor.ts';
import { registerMigrate } from './migrate.ts';
import { registerRemove } from './remove.ts';
import { registerResolve } from './resolve.ts';
import { registerShow } from './show.ts';
import { registerSync } from './sync.ts';
import { registerTag } from './tag.ts';

// Split out of `registry.ts` purely to keep that file's distinct-module import count under the
// repo's `import/max-dependencies` cap (10) — every new command module adds one more import to
// whichever file lists it, so registrars land here once `registry.ts` itself is full. No
// behavioural difference from being listed directly there: `MORE_REGISTRARS` is just concatenated
// onto `registry.ts`'s own `REGISTRARS` array, in the same order commander sees them.
const MORE_REGISTRARS: readonly ((program: RefsCommand, ctx: CliContext) => void)[] = [
  registerDoctor,
  registerMigrate,
  registerRemove,
  registerResolve,
  registerShow,
  registerSync,
  registerTag,
];

export { MORE_REGISTRARS };
