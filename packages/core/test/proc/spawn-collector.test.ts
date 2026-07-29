import { appendNote, createCollector, withTruncationNote } from '../../src/proc/spawn-collector.ts';
import { describe, expect, it } from 'vitest';

// The byte-cap edges of `SpawnRunner`'s stream collector: what happens exactly AT the 64 MiB cap
// decides whether a runaway child can grow memory past it (it must not) and whether the caller
// can still see the partial output plus a truncation note (it must). The cap is a module constant,
// so these tests really do allocate cap-sized buffers — acceptable for the two cases that pin the
// boundary arithmetic.

const BYTES_PER_KIB = 1024;
const KIB_PER_MIB = 1024;
const STREAM_CAP_MIB = 64;
const MAX_STREAM_BYTES = STREAM_CAP_MIB * KIB_PER_MIB * BYTES_PER_KIB;
const SPAN_HEADROOM = 2;

describe('collector byte-cap boundary', () => {
  it('keeps only the in-cap prefix of a chunk spanning the cap and drops everything after', () => {
    expect.hasAssertions();
    const collector = createCollector();
    const chunks = [
      Buffer.alloc(MAX_STREAM_BYTES - SPAN_HEADROOM, 'x'),
      Buffer.from('abcd'),
      // Already truncated by the previous chunk — this one must be dropped, not buffered.
      Buffer.from('later'),
    ];
    chunks.forEach((chunk) => {
      collector.push(chunk);
    });
    const { text, truncated } = collector.finish();
    expect(truncated).toBe(true);
    expect(text).toHaveLength(MAX_STREAM_BYTES);
    expect(text.endsWith('xab')).toBe(true);
  });

  it('marks truncation without storing anything when the cap is already exactly reached', () => {
    expect.hasAssertions();
    const collector = createCollector();
    const chunks = [Buffer.alloc(MAX_STREAM_BYTES, 'x'), Buffer.from('z')];
    chunks.forEach((chunk) => {
      collector.push(chunk);
    });
    const { text, truncated } = collector.finish();
    expect(truncated).toBe(true);
    expect(text).toHaveLength(MAX_STREAM_BYTES);
    expect(text).not.toContain('z');
  });
});

const streamOf = (truncated: boolean): { text: string; truncated: boolean } => ({
  text: '',
  truncated,
});

describe('truncation notes', () => {
  it('appends one note per overflowed stream onto stderr, keeping partial output visible', () => {
    expect.hasAssertions();
    const note = withTruncationNote('partial stderr\n', streamOf(true), streamOf(true));
    expect(note).toBe(
      'partial stderr\n' +
        `refs: stdout exceeded ${String(MAX_STREAM_BYTES)} bytes, truncated\n` +
        `refs: stderr exceeded ${String(MAX_STREAM_BYTES)} bytes, truncated`,
    );
  });

  it('leaves stderr untouched when neither stream overflowed', () => {
    expect.hasAssertions();
    expect(withTruncationNote('as-is\n', streamOf(false), streamOf(false))).toBe('as-is\n');
  });

  it('appendNote drops exactly one trailing newline and skips empty parts', () => {
    expect.hasAssertions();
    expect(appendNote('partial\n\n', 'note')).toBe('partial\n\nnote');
    expect(appendNote('', 'note')).toBe('note');
  });
});
