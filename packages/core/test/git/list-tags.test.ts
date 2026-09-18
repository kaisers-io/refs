import { describe, expect, it } from 'vitest';
import type { Runner } from '../../src/proc/runner.ts';
import { listTags } from '../../src/git/tags.ts';

// What `listTags` promises about the list it returns, which is the whole of why `detectTagFormat`
// can be trusted: counting is a claim about every tag, and a partial list supports it exactly as
// well as no list does. Split from `tags.test.ts`, which is about the counting itself.

const TWO = 2;
const TWENTY_FIVE = 25;

/** A `Runner` that answers `git tag` with `tags`, and optionally with the structured truncation
 * flag the runner sets when a stream hits its byte cap — which arrives alongside exit code 0. */
const fakeTagRunner = (tags: readonly string[], truncated = false): Runner => ({
  run: () =>
    Promise.resolve({
      exitCode: 0,
      stderr: '',
      stdout: tags.join('\n'),
      ...(truncated ? { stdoutTruncated: true as const } : {}),
    }),
});

describe('listTags: what it promises about the list', () => {
  it('reports an explicit limit as an incomplete read', async () => {
    expect.hasAssertions();
    const tagRunner = fakeTagRunner(['b@2.0.0', 'a@1.0.0', 'a@0.9.0']);

    await expect(listTags(tagRunner, '/repo', TWO)).resolves.toStrictEqual({
      complete: false,
      tags: ['b@2.0.0', 'a@1.0.0'],
    });
  });

  it('reports a truncated stream as an incomplete read, however many tags arrived', async () => {
    expect.hasAssertions();
    // The flag, with NO note in stderr. Matching the note's wording instead worked only while it
    // kept that wording and kept being routed onto stderr, and would have gone quiet rather than
    // loud if either changed. Counting over what survived would answer "the format most tags use"
    // from a list that is not all of them.
    const tagRunner = fakeTagRunner(['a@1.0.0'], true);

    await expect(listTags(tagRunner, '/repo')).resolves.toStrictEqual({
      complete: false,
      tags: ['a@1.0.0'],
    });
  });

  it('returns every tag when no limit is given, past any plausible window', async () => {
    expect.hasAssertions();
    // The defect was a default limit of twenty. A caller that counts needs all of them, so
    // "no limit" has to mean no limit — asserted past twenty so a reinstated window fails here.
    const many = Array.from({ length: TWENTY_FIVE }, (_unused, index) => `a@1.0.${String(index)}`);
    const tagRunner = fakeTagRunner(many);

    const result = await listTags(tagRunner, '/repo');

    expect(result.tags).toHaveLength(TWENTY_FIVE);
    expect(result.complete).toBe(true);
  });

  it('reports a whole read as complete', async () => {
    expect.hasAssertions();
    const tagRunner = fakeTagRunner(['a@1.0.0']);

    await expect(listTags(tagRunner, '/repo')).resolves.toStrictEqual({
      complete: true,
      tags: ['a@1.0.0'],
    });
  });
});
