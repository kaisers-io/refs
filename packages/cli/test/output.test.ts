import { describe, expect, it } from 'vitest';
import { emit, emitError, progress } from '../src/output.ts';
import { testContext } from './helpers/context.ts';

// Direct unit coverage for `emit`'s warning-surfacing contract (micro-fix round 2): warnings were
// only ever serialized into the json envelope, so every warning-producing human-mode command (the
// `edit settings` collision note, `show`'s degraded `sample_tags` warning, and any future one)
// silently dropped them. Split out as its own top-level file, mirroring `main.test.ts`'s placement
// for other `output.ts`/`main.ts` seam-level tests rather than a single command's `test/commands/`.
const HUMAN_LINE = 'widget: description updated';
const WARNING_ONE = 'a configured ref also matches the settings suffix';
const WARNING_TWO = 'checkout looked corrupt';
const NO_LINES = 0;
const ONE_LINE = 1;
const TWO_LINES = 2;

// Pulls the sole element out of a captured-output array — kept out of the `it` body below so the
// `if` here never counts as a conditional inside a test (vitest/no-conditional-in-test), mirroring
// `main.test.ts`'s `soleLine`.
const soleLine = (lines: readonly string[]): string => {
  const [line] = lines;
  if (line === undefined) {
    throw new Error('expected exactly one output line, got none');
  }
  return line;
};

describe('emit: human mode warnings', () => {
  it('prints each warning to stderr with the refs: warning: prefix, stdout untouched', () => {
    expect.hasAssertions();
    const { ctx, stderr, stdout } = testContext();

    emit(ctx, { json: false }, HUMAN_LINE, { field: 'description' }, [WARNING_ONE, WARNING_TWO]);

    expect(stdout).toStrictEqual([HUMAN_LINE]);
    expect(stderr).toHaveLength(TWO_LINES);
    expect(stderr).toStrictEqual([
      `refs: warning: ${WARNING_ONE}`,
      `refs: warning: ${WARNING_TWO}`,
    ]);
  });

  it('writes nothing to stderr when warnings is omitted or empty', () => {
    expect.hasAssertions();
    const { ctx, stderr, stdout } = testContext();

    emit(ctx, { json: false }, HUMAN_LINE, { field: 'description' });
    emit(ctx, { json: false }, HUMAN_LINE, { field: 'description' }, []);

    expect(stdout).toHaveLength(TWO_LINES);
    expect(stderr).toHaveLength(NO_LINES);
  });
});

describe('emit: json mode warnings', () => {
  it('folds warnings into the envelope and writes nothing to stderr', () => {
    expect.hasAssertions();
    const { ctx, stderr, stdout } = testContext();

    emit(ctx, { json: true }, HUMAN_LINE, { field: 'description' }, [WARNING_ONE]);

    expect(stdout).toHaveLength(ONE_LINE);
    expect(stderr).toHaveLength(NO_LINES);
    const parsed: unknown = JSON.parse(soleLine(stdout));
    expect(parsed).toMatchObject({ ok: true, warnings: [WARNING_ONE] });
  });
});

// `emit`'s human loop is not the only line a command-composed string reaches a terminal through:
// an error message carries a ref key and a git failure, and `progress` fires even under `--json`,
// where it is the one human line an agent run still prints.
const CONTROL_CHARACTER = /\p{Cc}/u;
const INJECTED = 'refs: forged line';

describe('control characters in human output', () => {
  it('keeps refs own line structure in an error but strips every other control character', () => {
    expect.hasAssertions();
    const { ctx, stderr } = testContext();
    // `refs add`'s two-phase instructions put each command on its own line, and `--verbose`
    // appends a stack trace: flattening an error message would destroy refs' own output.
    const message = `run this instead:\n  refs add --dry-run\nthen\u001B[2K\r finish`;

    emitError(ctx, { json: false }, { code: 'validation', message });

    // ESC and CR become `?`; the `[2K` they carried is ordinary text and stays visible, which is
    // the point — nothing is hidden, it just cannot act on the terminal.
    expect(soleLine(stderr)).toBe(
      'refs: run this instead:\n  refs add --dry-run\nthen?[2K? finish',
    );
  });

  it('keeps a progress line to one line, including under --json', () => {
    expect.hasAssertions();
    const { ctx, stderr } = testContext();

    progress(ctx, `cloning\u001B[2K\r${INJECTED}`);

    expect(stderr).toHaveLength(ONE_LINE);
    expect(CONTROL_CHARACTER.test(soleLine(stderr))).toBe(false);
  });

  it('leaves printable text outside ASCII alone, which refs own lines are full of', () => {
    expect.hasAssertions();
    const { ctx, stdout } = testContext();
    const line = 'widget — described, renamed to widgét';

    emit(ctx, { json: false }, line, {});

    expect(soleLine(stdout)).toBe(line);
  });

  it('does not touch the --json envelope, which JSON.stringify already escapes', () => {
    expect.hasAssertions();
    const { ctx, stdout } = testContext();

    emit(ctx, { json: true }, 'ignored', { name: `a\nb` });

    expect(JSON.parse(soleLine(stdout))).toMatchObject({ data: { name: 'a\nb' } });
  });
});
