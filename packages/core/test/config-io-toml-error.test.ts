import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { TomlError } from 'smol-toml';
import { join } from 'node:path';
import { readConfig } from '../src/config-io.ts';
import { resolveHome } from '../src/home.ts';
import { tmpdir } from 'node:os';
import { tomlErrorSummary } from '../src/config-toml-error.ts';

// A TOML parse failure is reported before schema validation and before any url handling, so none of
// the redaction applied elsewhere is reached. The parser's own message ends in a source excerpt —
// the offending line PLUS the nonempty lines either side of it — so a syntax error anywhere near a
// ref's `url` reported that url verbatim through an ordinary command failure. Nothing of the source
// may survive, which is why these assert the whole message rather than the absence of one string.

const BEFORE = 'SECRET_ON_THE_LINE_BEFORE';
const ON = 'SECRET_ON_THE_OFFENDING_LINE';
const AFTER = 'SECRET_ON_THE_LINE_AFTER';

/** A config whose syntax error has a distinct marker before it, on it, and after it. */
const configWithMarkersAround = [
  '[meta]',
  'schema_version = 1',
  '',
  '[refs."example.com/o/r"]',
  `description = "${BEFORE}"`,
  `this is not valid toml ${ON}`,
  `url = "https://user:${AFTER}@example.com/o/r.git"`,
].join('\n');

const messageFor = async (toml: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'refs-toml-'));
  try {
    const home = resolveHome({ REFS_HOME: dir });
    await writeFile(home.configPath, toml);
    const failed: unknown = await readConfig(home).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(Error);
    return (failed as Error).message.replace(home.configPath, '<config>');
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

describe('an invalid config.toml', () => {
  it('reports the fault and its position, and nothing of the source', async () => {
    expect.hasAssertions();
    await expect(messageFor(configWithMarkersAround)).resolves.toBe(
      'invalid TOML in <config>: Invalid TOML document: only letter, numbers, dashes and underscores are allowed in keys (line 6, column 1)',
    );
  });

  it.each([
    ['the line before', BEFORE],
    ['the offending line', ON],
    ['the line after', AFTER],
  ])('carries no marker from %s', async (_name, marker) => {
    expect.hasAssertions();
    await expect(messageFor(configWithMarkersAround)).resolves.not.toContain(marker);
  });

  it('reports a fault that sits nowhere near a url the same way', async () => {
    expect.hasAssertions();
    await expect(messageFor('[meta]\nschema_version = 1\nbroken line\n')).resolves.toBe(
      'invalid TOML in <config>: Invalid TOML document: incomplete key-value: cannot find end of key (line 3, column 1)',
    );
  });
});

// The fail-closed half, which the real parser cannot reach: it always puts the excerpt at the end
// of the message, so the suffix strip always applies. If a future smol-toml moved it, stripping a
// suffix that is not there would leave the excerpt in — so a message that does not end in its own
// codeblock drops the message entirely and keeps only the coordinates.
describe('a parser message whose excerpt is not where it is expected', () => {
  it('reports only the position, keeping none of the source', () => {
    expect.hasAssertions();
    const moved = {
      codeblock: '5:  url = "https://user:tok@example.com"',
      column: 3,
      line: 5,
      message: 'moved: 5:  url = "https://user:tok@example.com" then trailing prose',
    } as TomlError;

    expect(tomlErrorSummary(moved)).toBe('could not be parsed (line 5, column 3)');
  });

  it('keeps the parser wording when the excerpt IS the suffix', () => {
    expect.hasAssertions();
    const ordinary = {
      codeblock: '\n\n5:  url = "…"\n',
      column: 3,
      line: 5,
      message: 'Invalid TOML document: something\n\n5:  url = "…"\n',
    } as TomlError;

    expect(tomlErrorSummary(ordinary)).toBe('Invalid TOML document: something (line 5, column 3)');
  });
});
