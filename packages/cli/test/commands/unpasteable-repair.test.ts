import { describe, expect, it } from 'vitest';
import type { StructureIssue } from '../../src/commands/drift-report.ts';
import { displaySafe } from '../../src/output.ts';
import { driftLines } from '../../src/commands/drift-lines.ts';

// What a finding offers when one of the values its command would carry cannot be printed.
//
// Not "single quotes cannot hold it": they hold a newline or a tab perfectly well, and a shell
// accepts the result. Two other things go wrong. The command stops being ONE pasteable line; and
// refs neutralises control characters on the way to a terminal, so the line the reader sees names
// a DIFFERENT package, path or ref than the finding is about. Encoding the value as ANSI-C `$'…'`
// looked like the answer and was measured not to be — `sh` on Debian and Ubuntu is dash, which has
// no such syntax, and there the command does not fail. It SUCCEEDS, declining a package literally
// named `$x\x0Ay`. A command that silently acts on the wrong thing is worse than no command.
//
// Every dynamic part of the command is subject to this, which is the property these cases pin: a
// package NAME out of a manifest, a PATH out of the same manifest, and the ref KEY, which is
// derived from a url the user supplied. A gate on the name alone still prints a command that
// declines the right package at the wrong path.

const KEY = 'github.com/acme/alpha';
const CONTROL_CHARACTER = /\p{Cc}/u;
/** A lone high surrogate: not a control character, and with no UTF-8 encoding at all — so the
 * bytes written for it are already not the value. */
const LONE_SURROGATE = '\uD800';
const ESCAPE = '';

const lineFor = (issue: StructureIssue, key = KEY): string => {
  const [line] = driftLines({ packages: [issue], status: 'drift' }, key);
  return line ?? '';
};

describe('an unregistered package whose command would carry an unprintable value', () => {
  it.each<[string, string, string]>([
    ['a newline in the name', '@acme/a\nb', 'packages/ok'],
    ['a carriage return in the name', '@acme/a\rb', 'packages/ok'],
    ['an escape sequence in the name', `@acme/a${ESCAPE}[2Kb`, 'packages/ok'],
    // The two a name-only gate let through. The path and the key are no safer than the name:
    // `zPackagePath` admits an embedded control character, and so does a ref key.
    ['a newline in the path', '@acme/ok', 'packages/a\nb'],
    ['a tab in the path', '@acme/ok', 'packages/a\tb'],
  ])('offers no command: %s', (_label, name, path) => {
    expect.hasAssertions();

    const line = lineFor({ name, path, status: 'unregistered' });

    expect(line).toContain('no single-line command can carry these values');
    expect(line).not.toContain('refs edit');
  });
});

describe('an unregistered package whose name has no UTF-8 encoding', () => {
  it('offers no command either', () => {
    expect.hasAssertions();

    const line = lineFor({
      name: `@acme/a${LONE_SURROGATE}b`,
      path: 'packages/ok',
      status: 'unregistered',
    });

    // Only the absence of a command is asserted, not which sentence explains it: a lone surrogate
    // is BOTH a value `config.toml` cannot hold and one no printed line can carry, and whichever
    // check answers first is an implementation detail. Offering a command would not be.
    expect(line).not.toContain('refs edit');
  });

  it('offers no command when the REF KEY is the unprintable value', () => {
    expect.hasAssertions();

    const line = lineFor({ name: '@acme/ok', path: 'packages/ok', status: 'unregistered' }, 'a\nb');

    expect(line).not.toContain('refs edit');
  });

  it('points at the machine-readable report, which carries the value exactly', () => {
    expect.hasAssertions();

    const line = lineFor({ name: '@acme/a\nb', path: 'packages/ok', status: 'unregistered' });

    // `a?b` conflates a literal `?`, an LF and a tab, so the human line is NOT enough to act on by
    // hand. What it can honestly do is say where the exact value is.
    expect(line).toContain('--json');
    expect(displaySafe(line)).toContain('@acme/a?b');
  });
});

describe('a configured entry whose command would carry an unprintable value', () => {
  it('reports it gone, without a command to unregister it', () => {
    expect.hasAssertions();
    // This name came out of `config.toml`, which holds it fine. What it cannot survive is the
    // printed command — the same reason as for an unregistered one, from the other direction.
    const line = lineFor({
      configured_path: 'packages/gone',
      name: '@acme/a\nb',
      status: 'missing',
    });

    expect(line).toContain('unregister it by hand');
    expect(line).not.toContain('refs edit');
  });

  it('offers no unregister command when the REF KEY is unprintable', () => {
    expect.hasAssertions();

    const line = lineFor(
      { configured_path: 'packages/gone', name: '@acme/ok', status: 'missing' },
      'a\nb',
    );

    expect(line).not.toContain('refs edit');
  });

  it('offers no repoint command when the NEW path is unprintable', () => {
    expect.hasAssertions();

    const line = lineFor({
      configured_path: 'packages/was',
      name: '@acme/ok',
      path: 'packages/a\nb',
      status: 'relocated',
    });

    expect(line).not.toContain('refs edit');
  });
});

describe('a configured entry whose values are all printable', () => {
  it('still offers the removal', () => {
    expect.hasAssertions();

    const line = lineFor({
      configured_path: 'packages/gone',
      name: '@acme/ok',
      status: 'missing',
    });

    expect(line).toContain('--remove');
  });
});

describe('an unregistered package whose values are merely awkward', () => {
  it.each([
    ['a space', 'packages/a b'],
    ['a command substitution', 'packages/c$(id)'],
    ['a single quote', "packages/d'e"],
  ])('still gets a command, quoted: %s', (_label, path) => {
    expect.hasAssertions();

    const line = lineFor({ name: '@acme/ok', path, status: 'unregistered' });

    expect(line).toContain('refs edit');
    // Nothing for the display filter to change, which is what keeps the two paths honest.
    expect(CONTROL_CHARACTER.test(line)).toBe(false);
  });

  it('quotes the description placeholder, so a pasted substitution cannot run', () => {
    expect.hasAssertions();

    const line = lineFor({ name: '@acme/ok', path: 'packages/ok', status: 'unregistered' });

    // In double quotes a `$(…)` the reader substitutes for the placeholder would be expanded by
    // their own shell before refs ever saw it.
    expect(line).toContain("--description='<what it is>'");
    expect(line).not.toContain('--description="');
  });
});
