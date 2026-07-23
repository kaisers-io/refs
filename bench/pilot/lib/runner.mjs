// Execute one benchmark cell headless over an injected subprocess seam, capturing
// the agent's answer, cache-separated telemetry, and wall-time.
//
// Every cell launches with isolation flags that strip the CLI's plugins/skills/
// hooks/memory to the bare harness floor, so the `refs` tool (enabled globally in
// BOTH CLIs) cannot leak into the naive/discipline rungs and break rung-2/3
// equivalence. `refs` enters only in rung 3, only via the `full` preamble.
// Flags verified in bench/fixtures/TELEMETRY-SCHEMA.md.

import { normalizeClaude, normalizeCodex, parseCodexEvents } from './telemetry.mjs';

const NANOS_PER_MS = 1_000_000n;
const LAST_INDEX = -1;
const AGENT_MESSAGE = 'agent_message';

// Codex flags are pinned so reasoning effort / model stay constant across rungs.
const CODEX_MODEL = 'gpt-5.6-sol';
const CODEX_EFFORT = 'medium';

const CLAUDE_ISOLATION = [
  '--output-format',
  'json',
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--disable-slash-commands',
];

const CODEX_ISOLATION = [
  '--json',
  '--ignore-user-config',
  '-c',
  `model=${CODEX_MODEL}`,
  '-c',
  `model_reasoning_effort=${CODEX_EFFORT}`,
  '-s',
  'read-only',
];

const buildPrompt = (preamble, question, cwd) =>
  `${preamble}\n\nThe dependency checkout is at: ${cwd}\n\nQuestion: ${question}`;

// Codex's answer is the text of the LAST agent_message item, not the whole stream.
const codexAnswer = (stdout) =>
  parseCodexEvents(stdout)
    .filter((event) => event?.item?.type === AGENT_MESSAGE)
    .at(LAST_INDEX)?.item.text ?? '';

const CLI = {
  claude: {
    answer: (stdout) => JSON.parse(stdout).result ?? '',
    argv: (prompt) => ['-p', prompt, ...CLAUDE_ISOLATION],
    telemetry: (stdout) => normalizeClaude(JSON.parse(stdout)),
  },
  codex: {
    answer: (stdout) => codexAnswer(stdout),
    argv: (prompt) => ['exec', ...CODEX_ISOLATION, prompt],
    telemetry: (stdout) => normalizeCodex(stdout),
  },
};

const nowMs = () => Number(process.hrtime.bigint() / NANOS_PER_MS);

const runCell = async (exec, cell) => {
  const cli = CLI[cell.model];
  const prompt = buildPrompt(cell.preamble, cell.question, cell.cwd);
  const start = nowMs();
  const { stdout } = await exec(cell.model, cli.argv(prompt), { cwd: cell.cwd });
  const wall_ms = nowMs() - start;
  return {
    answer: cli.answer(stdout),
    raw: stdout,
    telemetry: cli.telemetry(stdout),
    wall_ms,
  };
};

export { buildPrompt, runCell };
