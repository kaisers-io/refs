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
const OK_CODE = 0;
const AGENT_MESSAGE = 'agent_message';

// Both models are pinned (model + effort) so those stay constant across rungs.
const CODEX_MODEL = 'gpt-5.6-sol';
const CODEX_EFFORT = 'medium';
const CLAUDE_MODEL = 'claude-opus-4-8';
// Claude's effort levels are low/medium/high/xhigh/max; medium matches codex's
// pinned model_reasoning_effort tier. The requirement is CONSTANT effort across
// rungs for a clean within-model contrast, not cross-model level equivalence.
const CLAUDE_EFFORT = 'medium';

const CLAUDE_ISOLATION = [
  '--output-format',
  'json',
  '--model',
  CLAUDE_MODEL,
  '--effort',
  CLAUDE_EFFORT,
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--disable-slash-commands',
  // Reduce side-effects/state that could leak across cells (verified in `claude --help`).
  '--no-session-persistence',
  '--no-chrome',
  // Enforce the "never mutate the checkout" hard rule (Codex gets `-s read-only`).
  '--disallowed-tools',
  'Write',
  'Edit',
  'NotebookEdit',
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
  // The cross-family judge runs in a neutral, non-git tmpdir; codex exec refuses an
  // untrusted (non-git) cwd without this flag and exits 1 with an empty answer. It is
  // a no-op inside the git dependency checkouts the answer pass runs in.
  '--skip-git-repo-check',
];

// Extra flags appended ONLY when a cell is a judge run (see judge.mjs). Claude
// gets `--tools ""` (no tools — the judge grades TEXT only, never a checkout).
// Codex stays empty: its prompt is the LAST positional arg, so appending would
// corrupt it, and the codex judge already runs `-s read-only` in a neutral cwd.
const JUDGE_EXTRA = {
  claude: ['--tools', ''],
  codex: [],
};

const buildPrompt = (preamble, question, cwd) =>
  `${preamble}\n\nThe dependency checkout is at: ${cwd}\n\nQuestion: ${question}`;

const withJudgeArgs = (model, argv, judge) => {
  if (!judge) {
    return argv;
  }
  return [...argv, ...JUDGE_EXTRA[model]];
};

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
  const argv = withJudgeArgs(cell.model, cli.argv(prompt), cell.judge);
  const start = nowMs();
  // A full per-rung env (PATH+REFS_LOG) rides on cell.env; it is undefined for the
  // FakeCli unit tests and judge runs, which then inherit process.env unchanged.
  const { stdout, stderr, code } = await exec(cell.model, argv, { cwd: cell.cwd, env: cell.env });
  const wall_ms = nowMs() - start;
  const base = { code, raw: stdout, stderr, wall_ms };
  // A non-zero exit (incl. spawnExec's timeout code) means the answer/telemetry are
  // untrustworthy — surface it as failed instead of parsing partial/garbage stdout.
  if (code !== OK_CODE) {
    return { ...base, answer: '', failed: true, telemetry: undefined };
  }
  return { ...base, answer: cli.answer(stdout), failed: false, telemetry: cli.telemetry(stdout) };
};

export { buildPrompt, runCell };
