import { describe, expect, it } from 'vitest';
import { emit } from '../src/output.ts';
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
