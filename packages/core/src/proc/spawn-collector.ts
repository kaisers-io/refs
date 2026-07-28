// Byte-capped stream collection shared by `spawn-runner`'s stdout/stderr handling — split out of
// `runner.ts` purely to keep that file under the repo's 300-line oxlint cap.

const BYTES_PER_KIB = 1024;
const KIB_PER_MIB = 1024;
const STREAM_CAP_MIB = 64;

// 64 MiB per stream. `refs` only ever shells out to short-lived `git`/`ssh` invocations — even
// `git clone --filter=...`'s chattiest progress output (routed to stderr) tops out at a few
// kilobytes for the largest realistic monorepo. This cap exists purely as a safety valve so a
// runaway or hostile child can never grow an in-memory buffer without bound and OOM the CLI
// process; ordinary usage never gets close to it. Exceeding it does not fail the command — the
// stream is truncated at the cap and a note is appended to `stderr` (see `withTruncationNote`
// below) so the caller can see output was cut, rather than the process crashing or hanging.
const MAX_STREAM_BYTES = STREAM_CAP_MIB * KIB_PER_MIB * BYTES_PER_KIB;

const EMPTY_BYTES = 0;

type CollectedStream = {
  text: string;
  truncated: boolean;
};

type StreamCollector = {
  push: (chunk: Buffer) => void;
  finish: () => CollectedStream;
};

// Buffers `Buffer` chunks (never decoding until `finish()`, so a multi-byte utf8 character split
// across two chunks decodes correctly) up to `MAX_STREAM_BYTES`; anything past the cap is dropped,
// not stored, so a runaway stream can never grow this collector's memory past the cap itself.
const createCollector = (): StreamCollector => {
  const chunks: Buffer[] = [];
  let bytes = EMPTY_BYTES;
  let truncated = false;
  return {
    finish: (): CollectedStream => ({ text: Buffer.concat(chunks).toString('utf8'), truncated }),
    push: (chunk: Buffer): void => {
      if (truncated) {
        return;
      }
      const remaining = MAX_STREAM_BYTES - bytes;
      if (chunk.length <= remaining) {
        chunks.push(chunk);
        bytes += chunk.length;
        return;
      }
      if (remaining > EMPTY_BYTES) {
        chunks.push(chunk.subarray(EMPTY_BYTES, remaining));
      }
      truncated = true;
    },
  };
};

// Appends `note` to `text` rather than replacing it — a child's own partial output (if it produced
// any before being killed/erroring/truncating) stays visible alongside the reason it's incomplete.
// ONE trailing newline — LF or CRLF, the same terminators the previous runner stripped — is
// removed from `text` first (only here, at note-append time; `RunResult` output is otherwise
// never trimmed), so `"partial\n"` joins as `"partial\n<note>"` rather than
// stacking a blank line (`"partial\n\n<note>"`) — matching what the previous, final-newline-
// stripping runner produced.
const appendNote = (text: string, note: string): string => {
  const base = text.replace(/\r?\n$/u, '');
  return [base, note].filter((part) => part !== '').join('\n');
};

// Truncation note(s) always land on `stderr`, regardless of which stream actually overflowed — the
// same place the timeout note (runner.ts) lands, so anything reading `stderr` for "why is this
// output incomplete" finds the answer in one place.
const withTruncationNote = (
  stderr: string,
  stdoutStream: CollectedStream,
  stderrStream: CollectedStream,
): string => {
  let note = stderr;
  if (stdoutStream.truncated) {
    note = appendNote(note, `refs: stdout exceeded ${String(MAX_STREAM_BYTES)} bytes, truncated`);
  }
  if (stderrStream.truncated) {
    note = appendNote(note, `refs: stderr exceeded ${String(MAX_STREAM_BYTES)} bytes, truncated`);
  }
  return note;
};

export { appendNote, createCollector, withTruncationNote };
export type { CollectedStream, StreamCollector };
