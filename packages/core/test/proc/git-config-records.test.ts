import { checkedConfigOutput, parseConfigRecords } from '../../src/proc/git-config-records.ts';
import { describe, expect, it } from 'vitest';

const result = (stdout: string) => ({ exitCode: 0, stderr: '', stdout });

describe('config inventory framing', () => {
  it('preserves values containing newlines and distinguishes implicit booleans from empty values', () => {
    expect.hasAssertions();
    expect(
      parseConfigRecords(
        result(
          'command line:\0hook.a.command\nline one\nline two\0command line:\0core.bare\0command line:\0core.fsmonitor\n\0',
        ),
      ),
    ).toStrictEqual([
      { key: 'hook.a.command', origin: 'command line:', value: 'line one\nline two' },
      { key: 'core.bare', origin: 'command line:', value: undefined },
      { key: 'core.fsmonitor', origin: 'command line:', value: '' },
    ]);
  });

  it.each([
    'file:x\0hook.a.command\nx',
    'file:x\0',
    'blob:HEAD:config\0hook.a.command\nx\0',
    'file:x\0invalid\0',
    'file:x\0hook.\uFFFD.command\nx\0',
  ])('refuses malformed or lossy inventory %j', (output) => {
    expect.hasAssertions();
    expect(() => parseConfigRecords(result(output))).toThrow('cannot be safely inventoried');
  });

  it('refuses failed, timed out, truncated and oversized configuration outputs', () => {
    expect.hasAssertions();
    expect(() => checkedConfigOutput({ ...result(''), exitCode: 1 })).toThrow(
      'cannot be safely inventoried',
    );
    expect(() => checkedConfigOutput({ ...result(''), timedOut: true })).toThrow(
      'cannot be safely inventoried',
    );
    expect(() => checkedConfigOutput({ ...result(''), stdoutTruncated: true })).toThrow(
      'cannot be safely inventoried',
    );
    const oversized = 1_048_577;
    expect(() => checkedConfigOutput(result('x'.repeat(oversized)))).toThrow(
      'cannot be safely inventoried',
    );
    expect(parseConfigRecords(result(''))).toStrictEqual([]);
  });
});
