import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { trajectory } from '../pilot/lib/metrics.mjs';

const CLAUDE_NUM_TURNS = 3;
const EXPECTED_TURNS = 2;
const EXPECTED_TOOL_CALLS = 2;
// Byte lengths of "file1\nfile2" and "done!\n" respectively.
const FIRST_OUTPUT_BYTES = 11;
const SECOND_OUTPUT_BYTES = 6;
const EXPECTED_TOOL_OUTPUT_BYTES = FIRST_OUTPUT_BYTES + SECOND_OUTPUT_BYTES;
const FIXTURE_CODEX_TOOL_CALLS = 1;
const FIXTURE_CODEX_TURNS = 2;
const FIXTURE_CLAUDE_TURNS = 1;
const MIN_OUTPUT_BYTES = 0;

// A realistic codex JSONL stream: a draft agent_message, TWO command_execution
// calls (each with an `item.started` in-progress duplicate that must NOT be
// double-counted), a final agent_message, then turn.completed usage.
const CODEX_STDOUT = [
  String.raw`{"type":"item.completed","item":{"type":"agent_message","text":"draft thought"}}`,
  String.raw`{"type":"item.started","item":{"type":"command_execution","command":"ls","aggregated_output":"","status":"in_progress"}}`,
  String.raw`{"type":"item.completed","item":{"type":"command_execution","command":"ls","aggregated_output":"file1\nfile2","exit_code":0,"status":"completed"}}`,
  String.raw`{"type":"item.started","item":{"type":"command_execution","command":"echo done!","output":"","status":"in_progress"}}`,
  String.raw`{"type":"item.completed","item":{"type":"command_execution","command":"echo done!","output":"done!\n","exit_code":0,"status":"completed"}}`,
  String.raw`{"type":"item.completed","item":{"type":"agent_message","text":"final answer"}}`,
  String.raw`{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}`,
].join('\n');

describe('trajectory (codex)', () => {
  it('counts completed command_execution items as tool_calls, agent_message items as turns, and sums output bytes', () => {
    expect(trajectory(CODEX_STDOUT, 'codex')).toStrictEqual({
      tool_calls: EXPECTED_TOOL_CALLS,
      tool_output_bytes: EXPECTED_TOOL_OUTPUT_BYTES,
      turns: EXPECTED_TURNS,
    });
  });

  it('returns zeroed counts (not a throw) for malformed raw', () => {
    expect(trajectory('not json at all\nmore garbage', 'codex')).toStrictEqual({
      tool_calls: 0,
      tool_output_bytes: 0,
      turns: 0,
    });
  });

  it('returns zeroed counts (not a throw) for empty/undefined raw', () => {
    expect(trajectory('', 'codex')).toStrictEqual({
      tool_calls: 0,
      tool_output_bytes: 0,
      turns: 0,
    });
    expect(trajectory(undefined, 'codex')).toStrictEqual({
      tool_calls: 0,
      tool_output_bytes: 0,
      turns: 0,
    });
  });
});

describe('trajectory (claude)', () => {
  it('extracts num_turns and honestly leaves tool_calls/tool_output_bytes undefined', () => {
    const raw = JSON.stringify({ num_turns: CLAUDE_NUM_TURNS, result: 'ok' });
    expect(trajectory(raw, 'claude')).toStrictEqual({
      tool_calls: undefined,
      tool_output_bytes: undefined,
      turns: CLAUDE_NUM_TURNS,
    });
  });

  it('handles malformed JSON gracefully (undefined fields, not a throw)', () => {
    expect(trajectory('not json at all', 'claude')).toStrictEqual({
      tool_calls: undefined,
      tool_output_bytes: undefined,
      turns: undefined,
    });
  });

  it('handles empty/undefined raw gracefully (undefined fields, not a throw)', () => {
    expect(trajectory('', 'claude')).toStrictEqual({
      tool_calls: undefined,
      tool_output_bytes: undefined,
      turns: undefined,
    });
    expect(trajectory(undefined, 'claude')).toStrictEqual({
      tool_calls: undefined,
      tool_output_bytes: undefined,
      turns: undefined,
    });
  });
});

describe('trajectory (real captured fixtures)', () => {
  it('parses the real captured codex fixture with a real tool call and turn count', async () => {
    const raw = await readFile(new URL('../fixtures/codex-sample.jsonl', import.meta.url), 'utf8');
    const result = trajectory(raw, 'codex');
    expect(result.tool_calls).toBe(FIXTURE_CODEX_TOOL_CALLS);
    expect(result.turns).toBe(FIXTURE_CODEX_TURNS);
    expect(result.tool_output_bytes).toBeGreaterThan(MIN_OUTPUT_BYTES);
  });

  it('parses the real captured claude fixture with num_turns and no tool trace', async () => {
    const json = await readFile(new URL('../fixtures/claude-sample.json', import.meta.url), 'utf8');
    const result = trajectory(json, 'claude');
    expect(result.turns).toBe(FIXTURE_CLAUDE_TURNS);
    expect(result.tool_calls).toBeUndefined();
    expect(result.tool_output_bytes).toBeUndefined();
  });
});
