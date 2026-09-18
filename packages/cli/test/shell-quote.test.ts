import { describe, expect, it } from 'vitest';
import { rmCommand, shellQuote } from '../src/shell-quote.ts';
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

// A value carrying a control character is the case ordinary single quotes cannot serve: they
// PRESERVE it, so the printed command spans two lines and cannot be pasted — and neutralising it
// afterwards for display would silently change which package or path the command names. The
// round-trip is asserted through a real shell, because the claim is about what a shell does.
const HOSTILE_VALUES: readonly [string, string][] = [
  ['a newline', 'a\nb'],
  ['a carriage return', 'a\rb'],
  ['an escape sequence', 'a[2Kb'],
  ['a delete character', 'ab'],
  ['a C1 byte', 'ab'],
  ['a newline beside a quote and a backslash', "a\nb'c\\d"],
];

describe('a value a shell cannot be handed in single quotes', () => {
  it.each(HOSTILE_VALUES)('survives the shell unchanged: %s', async (_label, value) => {
    expect.hasAssertions();
    const quoted = shellQuote(value);

    const result = await new SpawnRunner().run('sh', ['-c', `printf %s ${quoted}`]);

    expect(result.stdout).toBe(value);
  });

  it.each(HOSTILE_VALUES)('prints as one line with no control character: %s', (_label, value) => {
    expect.hasAssertions();

    // What makes the display filter and the printed command safe at once: after encoding there is
    // nothing left for that filter to change, so the command still means what it said.
    expect(shellQuote(value)).not.toMatch(/\p{Cc}/u);
  });

  it('leaves an ordinary value in plain single quotes', () => {
    expect.hasAssertions();

    expect(rmCommand('/tmp/a b')).toBe("rm -rf -- '/tmp/a b'");
  });
});
