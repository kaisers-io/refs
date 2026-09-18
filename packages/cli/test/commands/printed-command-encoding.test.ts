import { SpawnRunner, readConfig, resolveHome } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import { initHome, realContextFor, withTempHome } from '../helpers/add-support.ts';
import type { RefsHome } from '@kaisers-io/refs-core';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { cliBundle } from '../helpers/printed-command.ts';
import { displaySafe } from '../../src/output.ts';
import { driftLines } from '../../src/commands/drift-lines.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { shellQuote } from '../../src/shell-quote.ts';

// The regression a display filter alone would introduce, and the reason the encoding lives in
// `shellQuote` rather than at the end of the pipe.
//
// Neutralising a printed line for the terminal rewrites the command inside it: a package named
// `a<LF>b` becomes `--package='a?b'`, which names a DIFFERENT package, and the same machinery
// prints `rm -rf` for an orphaned checkout path. `displaySafe` is applied below exactly as `emit`
// applies it, and the command is then run THROUGH A SHELL, verbatim — a hand-built argv would
// carry the encoded value straight through and prove nothing about the two parsers it has to
// survive.

const ALPHA_KEY = 'github.com/acme/alpha';
const ALPHA_URL = 'https://github.com/acme/alpha';
const HOSTILE_NAME = '@acme/b\nacme-root: declared in this checkout but not registered';
const DECLINE_MARKER = 'If it should not be: ';
const SUCCESS = 0;

/** The printed decline command, taken from the line as a terminal would SHOW it. */
const declineCommandFor = (name: string, key: string): string => {
  const shown = displaySafe(
    driftLines(
      { discovery: [{ name, path: 'packages/b', status: 'unregistered' }], status: 'drift' },
      key,
    ).join('\n'),
  );
  const printed = shown.slice(shown.indexOf(DECLINE_MARKER) + DECLINE_MARKER.length);
  expect(printed).toContain('--decline');
  return printed;
};

const seededHome = async (homeDir: string): Promise<RefsHome> => {
  const { ctx } = realContextFor(homeDir);
  await initHome(ctx);
  const home = resolveHome(ctx.env);
  await seedConfig(home, {
    [ALPHA_KEY]: { default_branch: 'main', description: 'Alpha lib', url: ALPHA_URL },
  });
  return home;
};

describe('a command refs prints still names what it said', () => {
  it(
    'declines the exact name, not the one a display filter would have left',
    { timeout: SLOW_IO_TIMEOUT_MS },
    async () => {
      expect.hasAssertions();
      await withTempHome(async (homeDir) => {
        const home = await seededHome(homeDir);
        const printed = declineCommandFor(HOSTILE_NAME, ALPHA_KEY);
        const asRefs = printed.replace(/^refs /u, `node ${shellQuote(await cliBundle())} `);

        const result = await new SpawnRunner().run('sh', [
          '-c',
          `REFS_HOME=${shellQuote(homeDir)} ${asRefs} --json`,
        ]);

        expect(result.exitCode).toBe(SUCCESS);
        const config = await readConfig(home);
        expect(config.refs[ALPHA_KEY]?.declined_packages?.[0]?.name).toBe(HOSTILE_NAME);
      });
    },
  );
});
