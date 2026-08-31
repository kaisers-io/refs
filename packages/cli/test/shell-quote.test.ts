import { describe, expect, it } from 'vitest';
import { rmCommand, shellQuote } from '../src/shell-quote.ts';

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
