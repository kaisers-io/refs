import { describe, expect, it } from 'vitest';
import { displaySafe } from '../../src/output.ts';
import { driftLines } from '../../src/commands/drift-lines.ts';

// What a finding offers when its value cannot go into a printed command.
//
// A control character in a package name is the case ordinary single quotes cannot serve: they
// PRESERVE it, so the line spans two lines and cannot be pasted. Encoding it as ANSI-C `$'…'`
// looked like the answer and was measured not to be — `sh` on Debian and Ubuntu is dash, which has
// no such syntax, and there the command does not fail. It SUCCEEDS, declining a package literally
// named `$x\x0Ay`. A command that silently acts on the wrong thing is worse than no command.
//
// So none is printed. The finding is still reported, with its name, and says why.

const KEY = 'github.com/acme/alpha';
const CONTROL_CHARACTER = /\p{Cc}/u;

const lineFor = (name: string, path: string): string => {
  const [line] = driftLines(
    { packages: [{ name, path, status: 'unregistered' }], status: 'drift' },
    KEY,
  );
  return line ?? '';
};

describe('an unregistered package whose name carries a control character', () => {
  it.each([
    ['a newline', 'a\nb'],
    ['a carriage return', 'a\rb'],
    ['an escape sequence', 'a[2Kb'],
  ])('is reported without a command: %s', (_label, suffix) => {
    expect.hasAssertions();

    const line = lineFor(`@acme/${suffix}`, 'packages/ok');

    expect(line).toContain('cannot go into a command');
    expect(line).not.toContain('refs edit');
  });

  it('still names the package, so the finding is actionable by hand', () => {
    expect.hasAssertions();

    const line = lineFor('@acme/a\nb', 'packages/ok');

    // The reader sees the name — once the display filter has made it one line.
    expect(displaySafe(line)).toContain('@acme/a?b');
  });
});

describe('a configured entry whose name carries a control character', () => {
  it('is reported as gone, without a command to unregister it', () => {
    expect.hasAssertions();
    // This name came out of `config.toml`, which holds it fine. What it cannot survive is the
    // printed command — the same reason as for an unregistered one, from the other direction.
    const [line] = driftLines(
      {
        packages: [{ configured_path: 'packages/gone', name: '@acme/a\nb', status: 'missing' }],
        status: 'drift',
      },
      KEY,
    );

    expect(line).toContain('unregister it by hand');
    expect(line).not.toContain('refs edit');
  });

  it('still offers the removal when the name is ordinary', () => {
    expect.hasAssertions();
    const [line] = driftLines(
      {
        packages: [{ configured_path: 'packages/gone', name: '@acme/ok', status: 'missing' }],
        status: 'drift',
      },
      KEY,
    );

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

    const line = lineFor('@acme/ok', path);

    expect(line).toContain('refs edit');
    // Nothing for the display filter to change, which is what keeps the two paths honest.
    expect(CONTROL_CHARACTER.test(line)).toBe(false);
  });
});
