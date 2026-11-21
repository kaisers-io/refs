import { addDryRunCommand, isPasteable, rmCommand, shellQuote } from '../src/shell-quote.ts';
import { describe, expect, it } from 'vitest';
import { SpawnRunner } from '@kaisers-io/refs-core';

// These helpers exist because refs prints commands for a person to paste. A ref key comes from a
// url the user supplied and permits spaces, `$()`, backticks, semicolons and quotes; a package name
// comes from a tracked repository's own manifests; and the refs home routinely sits under a path
// with a space in it. So the values interpolated into those commands are neither controlled nor
// tame, and quoting them is the difference between a suggestion and an execution primitive.

describe('quoting a value for a pasteable command', () => {
  it('quotes a value containing spaces so it stays one argument', () => {
    expect.hasAssertions();

    // The mundane case, and the most likely: a macOS home under "Application Support". Unquoted,
    // the suggested command silently operates on two wrong paths and leaves the intended one.
    expect(shellQuote('/Users/x/Library/Application Support/refs')).toBe(
      "'/Users/x/Library/Application Support/refs'",
    );
  });

  it('neutralises command substitution', () => {
    expect.hasAssertions();

    // A ref key derives from a user-supplied url, so a segment really can be named this.
    expect(shellQuote('$(rm -rf ~)')).toBe("'$(rm -rf ~)'");
  });

  it('closes and reopens the quote around an embedded single quote', () => {
    expect.hasAssertions();

    // The one case naive quoting gets wrong: a `'` inside single quotes ends the string, so it has
    // to be escaped outside them.
    expect(shellQuote("it's")).toBe(String.raw`'it'\''s'`);
  });
});

describe('building a removal command', () => {
  it('quotes the path and ends the option list', () => {
    expect.hasAssertions();

    // `--` matters independently of quoting: without it a path beginning with `-` parses as flags.
    expect(rmCommand('-rf-looking-path')).toBe("rm -rf -- '-rf-looking-path'");
  });
});

// A value carrying a control character cannot go into a printed command at all.
//
// Single quotes PRESERVE it, so the line spans two lines and cannot be pasted. ANSI-C `$'…'`
// looked like the answer and is not: `sh` on Debian and Ubuntu is dash, which has no such syntax,
// and measured there the command does not fail — it SUCCEEDS, against a package literally named
// `$x\x0Ay`. A command that silently acts on the wrong thing is worse than no command.
const UNPASTEABLE: readonly (readonly [string, string])[] = [
  ['a newline', 'a\nb'],
  ['a carriage return', 'a\rb'],
  ['an escape sequence', 'a\u001B[2Kb'],
  ['a delete character', 'a\u007Fb'],
  ['a C1 byte', 'a\u009Bb'],
];

const PASTEABLE: readonly (readonly [string, string])[] = [
  ['a space', 'a b'],
  ['a single quote', "a'b"],
  ['a command substitution', 'a$(id)b'],
  ['a backslash', String.raw`a\b`],
  ['an em dash', 'a—b'],
];

describe('whether a value can go into a printed command', () => {
  it.each(UNPASTEABLE)('refuses one carrying %s', (_label, value) => {
    expect.hasAssertions();

    expect(isPasteable(value)).toBe(false);
  });

  it.each(PASTEABLE)('accepts one carrying %s, which quoting handles', (_label, value) => {
    expect.hasAssertions();

    expect(isPasteable(value)).toBe(true);
  });

  it.each(PASTEABLE)('and the quoted form survives a real shell: %s', async (_label, value) => {
    expect.hasAssertions();
    const quoted = shellQuote(value);

    const result = await new SpawnRunner().run('sh', ['-c', `printf %s ${quoted}`]);

    expect(result.stdout).toBe(value);
  });
});

describe('building a dry-run command for a ref url', () => {
  it('quotes the url', () => {
    expect.hasAssertions();

    expect(addDryRunCommand("https://example.com/a b/it's.git")).toBe(
      String.raw`refs add 'https://example.com/a b/it'\''s.git' --dry-run --json`,
    );
  });

  // A proposal file's url is checked only for being non-empty when this runs, so each of these
  // can reach it. Withholding the command is the outcome; the error is still reported.
  it.each([
    ['userinfo, which would print a credential', 'https://token:sekrit@example.com/a.git'],
    ['a leading dash, which refs would parse as an option', '-x'],
    ['a control character', 'https://example.com/a\nb.git'],
  ])('offers none for a url carrying %s', (_label, url) => {
    expect.hasAssertions();

    expect(addDryRunCommand(url)).toBeUndefined();
  });

  it('keeps the conventional git@ scp form, which carries no secret', () => {
    expect.hasAssertions();

    expect(addDryRunCommand('git@github.com:a/b.git')).toBe(
      "refs add 'git@github.com:a/b.git' --dry-run --json",
    );
  });
});
