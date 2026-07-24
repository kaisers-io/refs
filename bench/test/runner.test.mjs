import { describe, expect, it } from 'vitest';
import { FakeCli } from './fake-cli.mjs';
import { runCell } from '../pilot/lib/runner.mjs';

const OK_CODE = 0;
const FAIL_CODE = 1;
const CLAUDE_INPUT_TOKENS = 5;
const CLAUDE_OUTPUT_TOKENS = 7;
const CODEX_UNCACHED_TOKENS = 6;

const claudeFake = () =>
  new FakeCli({
    code: OK_CODE,
    stderr: '',
    stdout: JSON.stringify({
      result: 'coerce is in src/types.ts',
      usage: { input_tokens: CLAUDE_INPUT_TOKENS, output_tokens: CLAUDE_OUTPUT_TOKENS },
    }),
  });

const cell = (model) => ({
  cwd: '/tmp/checkout',
  model,
  preamble: 'PLAYBOOK',
  question: 'Where is coerce?',
});

// Codex JSONL: a draft agent_message, a tool call, then the FINAL agent_message
// (the real answer), then the usage-bearing turn.completed. Numbers live inside
// string literals, so they are not code-level magic numbers.
const CODEX_STDOUT = [
  '{"type":"item.completed","item":{"type":"agent_message","text":"draft thought"}}',
  '{"type":"item.completed","item":{"type":"command_execution","command":"ls"}}',
  '{"type":"item.completed","item":{"type":"agent_message","text":"coerce is in src/types.ts"}}',
  '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":2}}',
].join('\n');

describe('runCell (claude)', () => {
  it('runs in cwd and returns the parsed answer and telemetry', async () => {
    const fake = claudeFake();
    const result = await runCell(fake.exec.bind(fake), cell('claude'));
    const [call] = fake.calls;
    expect(result.answer).toBe('coerce is in src/types.ts');
    expect(result.telemetry.output).toBe(CLAUDE_OUTPUT_TOKENS);
    expect(call.cmd).toBe('claude');
    expect(call.opts.cwd).toBe('/tmp/checkout');
  });

  it('launches with isolation flags and a prompt carrying preamble and question', async () => {
    const fake = claudeFake();
    await runCell(fake.exec.bind(fake), cell('claude'));
    const [call] = fake.calls;
    expect(call.args).toContain('--setting-sources');
    expect(call.args).toContain('--strict-mcp-config');
    expect(call.args).toContain('--disable-slash-commands');
    const promptArg = call.args.join(' ');
    expect(promptArg).toContain('PLAYBOOK');
    expect(promptArg).toContain('Where is coerce?');
  });

  // Codex-review catch: effort must be pinned for claude too (only codex was),
  // and side-effect state should be disabled — see runner.mjs CLAUDE_ISOLATION.
  it('pins effort and disables session-persistence/chrome side effects', async () => {
    const fake = claudeFake();
    await runCell(fake.exec.bind(fake), cell('claude'));
    const [call] = fake.calls;
    expect(call.args).toContain('--effort');
    expect(call.args).toContain('medium');
    expect(call.args).toContain('--no-session-persistence');
    expect(call.args).toContain('--no-chrome');
  });
});

describe('runCell (failure)', () => {
  it('marks the cell failed without parsing when the CLI exits non-zero', async () => {
    const fake = new FakeCli({ code: FAIL_CODE, stderr: 'boom', stdout: 'not json at all' });
    const result = await runCell(fake.exec.bind(fake), cell('claude'));
    expect(result.failed).toBe(true);
    expect(result.answer).toBe('');
    expect(result.telemetry).toBeUndefined();
  });
});

describe('runCell (codex)', () => {
  it('extracts the last agent_message as the answer and launches with isolation flags', async () => {
    const fake = new FakeCli({ code: OK_CODE, stderr: '', stdout: CODEX_STDOUT });
    const result = await runCell(fake.exec.bind(fake), cell('codex'));
    const [call] = fake.calls;
    expect(result.answer).toBe('coerce is in src/types.ts');
    expect(result.telemetry.input_uncached).toBe(CODEX_UNCACHED_TOKENS);
    expect(call.cmd).toBe('codex');
    expect(call.args).toContain('--ignore-user-config');
    expect(call.args).toContain('--json');
    // The cross-family judge runs in a neutral non-git tmpdir; without this flag codex
    // exec exits 1 there with an empty answer (breaks every codex-as-judge verdict).
    expect(call.args).toContain('--skip-git-repo-check');
  });
});
