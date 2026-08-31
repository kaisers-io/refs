import type { Config, RefsHome, State } from '@kaisers-io/refs-core';
import {
  SCHEMA_VERSION,
  writeConfig,
  writeState,
  zConfig,
  zState,
  // eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
} from '@kaisers-io/refs-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Shared config/state/checkout fixture builders for `list.test.ts` and `show.test.ts` — both drive
// `refs list`/`refs show` against a config seeded directly via `writeConfig` (never through a real
// `refs add`), per the task brief's guidance that `writeConfig` is simpler and sufficient here.

const TEST_CLI_VERSION = '0.0.0-test';

/** Builds and writes a full `Config` (meta + settings + the given `refs`) via `zConfig.parse` +
 * `writeConfig` — the settings/meta boilerplate every test would otherwise repeat. */
const seedConfig = async (
  home: RefsHome,
  refs: Record<string, unknown>,
  settings?: Record<string, unknown>,
): Promise<Config> => {
  const config = zConfig.parse({
    meta: { cli_version: TEST_CLI_VERSION, schema_version: SCHEMA_VERSION },
    refs,
    settings: settings ?? {},
  });
  await writeConfig(home, config);
  return config;
};

/** Builds and writes a `State` (just the given `refs`) via `zState.parse` + `writeState`. */
const seedState = async (home: RefsHome, refs: Record<string, unknown>): Promise<State> => {
  const state = zState.parse({ refs });
  await writeState(home, state);
  return state;
};

/** Marks `dest` as an existing, refs-MANAGED checkout: a `.git` directory carrying the two values
 * that identify one — the `core.hooksPath` marker `cloneRepo` stamps, and an origin url.
 *
 * A bare `mkdir .git` used to be enough, because presence was decided by `existsSync`. It is not
 * any more, and deliberately so: a directory with a `.git` in it is not evidence that this is the
 * checkout a ref names. Fixtures that want to stand in for a real checkout have to look like one.
 *
 * Pass `url` matching the ref's configured url; omit it to build a checkout that is present but
 * NOT recognisably this ref's, which is the case worth testing on its own. */
const markCheckoutPresent = async (dest: string, url?: string): Promise<void> => {
  await mkdir(join(dest, '.git'), { recursive: true });
  const origin = url === undefined ? '' : `[remote "origin"]\n\turl = ${url}\n`;
  await writeFile(
    join(dest, '.git', 'config'),
    `[core]\n\thooksPath = /fixture/hooks\n${origin}`,
    'utf8',
  );
};

const MS_PER_MINUTE = 60_000;

/** An ISO timestamp `minutesAgo` minutes before now — shorthand for seeding `last_fetched_at`
 * fixtures at a precise offset from "now" without every test re-deriving the arithmetic. */
const minutesAgoIso = (minutesAgo: number): string =>
  new Date(Date.now() - minutesAgo * MS_PER_MINUTE).toISOString();

export { markCheckoutPresent, minutesAgoIso, seedConfig, seedState };
