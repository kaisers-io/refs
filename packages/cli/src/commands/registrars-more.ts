import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { registerDoctor } from './doctor.ts';
import { registerMigrate } from './migrate.ts';
import { registerRemove } from './remove.ts';
import { registerResolve } from './resolve.ts';
import { registerShow } from './show.ts';
import { registerSync } from './sync.ts';
import { registerTag } from './tag.ts';

// Overflow list for command registrars: registry.ts is at the repo's import/max-dependencies
// cap (10 distinct modules), so new registrars land here and are concatenated onto its
// REGISTRARS array.
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
