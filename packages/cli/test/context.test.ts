import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { SpawnRunner } from '@kaisers-io/refs-core';
import { homedir } from 'node:os';
import { realContext } from '../src/context.ts';

// `realContext()` is the one place in the CLI allowed to touch real globals — these tests pin its
// wiring: each context field must reach the corresponding real global (`process.env`, stdout,
// stderr, `fetch`, stdin), because a regression here silently disconnects every command from the
// outside world while all the seam-injected tests keep passing.

// Captures everything written to a real stdio stream while `use` runs, restoring the original
// `write` afterwards — the streams are shared with the test runner, so the swap must be scoped as
// tightly as possible.
const captureWrites = (stream: NodeJS.WriteStream, use: () => void): string[] => {
  const written: string[] = [];
  const spy = vi.spyOn(stream, 'write').mockImplementation((chunk): boolean => {
    written.push(String(chunk));
    return true;
  });
  try {
    use();
  } finally {
    spy.mockRestore();
  }
  return written;
};

// Swaps `process.stdin` (a configurable lazy accessor on `process`) for a stream yielding the
// given chunks, runs `read`, and restores the original descriptor no matter what.
const readWithFakeStdin = async (
  chunks: Buffer[],
  read: () => Promise<string>,
): Promise<string> => {
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  Object.defineProperty(process, 'stdin', { configurable: true, value: Readable.from(chunks) });
  try {
    return await read();
  } finally {
    if (original !== undefined) {
      Object.defineProperty(process, 'stdin', original);
    }
  }
};

// 'ü' in utf8 is the two bytes 195 188 (0xc3 0xbc) — split across two chunks below to prove
// decoding happens once over the concatenated buffer, not per-chunk (per-chunk decoding would
// yield two replacement characters instead).
const UMLAUT_FIRST_BYTE = 195;
const UMLAUT_SECOND_BYTE = 188;

describe('real context wiring', () => {
  it('wires env, nodeVersion, homedir, and runner to the real process globals', () => {
    expect.hasAssertions();
    const ctx = realContext();
    expect(ctx.env).toBe(process.env);
    expect(ctx.nodeVersion).toBe(process.version);
    // `os.homedir()` and not `$HOME`: the two differ on native Windows, and `doctor`'s `skill`
    // check reads this to find the same global directories the installer writes to.
    expect(ctx.homedir).toBe(homedir());
    expect(ctx.runner).toBeInstanceOf(SpawnRunner);
  });

  it('fetcher delegates to the global fetch with the given url', async () => {
    expect.hasAssertions();
    const response = new Response('ok');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    try {
      await expect(realContext().fetcher('https://example.invalid/x')).resolves.toBe(response);
      expect(fetchSpy).toHaveBeenCalledWith('https://example.invalid/x', undefined);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('real context wiring: fetch options', () => {
  it('fetcher passes an abort signal through, so a caller can bound the request', async () => {
    // The update check gives its request a deadline; a seam that dropped the signal would turn
    // that deadline into decoration.
    expect.hasAssertions();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const controller = new AbortController();
    try {
      await realContext().fetcher('https://example.invalid/x', { signal: controller.signal });
      expect(fetchSpy).toHaveBeenCalledWith('https://example.invalid/x', {
        signal: controller.signal,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('real context wiring: streams', () => {
  it('out writes the line plus a trailing newline to real stdout', () => {
    expect.hasAssertions();
    const written = captureWrites(process.stdout, () => {
      realContext().out('hello');
    });
    expect(written).toStrictEqual(['hello\n']);
  });

  it('errLine writes the line plus a trailing newline to real stderr', () => {
    expect.hasAssertions();
    const written = captureWrites(process.stderr, () => {
      realContext().errLine('oops');
    });
    expect(written).toStrictEqual(['oops\n']);
  });
});

describe('real stdin reading', () => {
  it('readStdin concatenates all chunks before decoding utf8', async () => {
    expect.hasAssertions();
    const chunks = [
      Buffer.from('gr'),
      Buffer.from([UMLAUT_FIRST_BYTE]),
      Buffer.from([UMLAUT_SECOND_BYTE]),
      Buffer.from('n'),
    ];
    const text = await readWithFakeStdin(chunks, () => realContext().readStdin());
    expect(text).toBe('grün');
  });

  it('readStdin resolves to the empty string when stdin ends without data', async () => {
    expect.hasAssertions();
    const text = await readWithFakeStdin([], () => realContext().readStdin());
    expect(text).toBe('');
  });
});
