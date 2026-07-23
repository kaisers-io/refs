import { describe, expect, it } from 'vitest';
import { extractVerdict } from '../pilot/lib/judge.mjs';

describe('extractVerdict', () => {
  it('parses a JSON verdict embedded in surrounding prose', () => {
    const raw = 'Here is my grade:\n{"criteria":[{"fact":"names the file","pass":true}]}\nDone.';
    const verdict = extractVerdict(raw);
    expect(verdict.criteria).toStrictEqual([{ fact: 'names the file', pass: true }]);
  });

  it('returns an empty criteria list when no JSON object is present', () => {
    expect(extractVerdict('no json here')).toStrictEqual({ criteria: [] });
  });

  it('returns an empty criteria list when the JSON is malformed', () => {
    expect(extractVerdict('{"criteria": [broken}')).toStrictEqual({ criteria: [] });
  });
});
