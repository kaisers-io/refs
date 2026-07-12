import type { CliContext } from '../context.ts';
import type { RefsCommand } from './registry.ts';
import { registerRange } from './range.ts';
import { registerSearch } from './search.ts';

// Third registrar slice, same deal as `registrars-more.ts`: that file's import count sits at the
// repo's `import/max-dependencies` cap (10), so the investigation-helper commands land here and
// `registry.ts` concatenates this list after `MORE_REGISTRARS`. Order only affects `--help`
// listing, nothing behavioural.
const EXTRA_REGISTRARS: readonly ((program: RefsCommand, ctx: CliContext) => void)[] = [
  registerRange,
  registerSearch,
];

export { EXTRA_REGISTRARS };
