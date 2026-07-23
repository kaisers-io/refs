// Trajectory-length metrics — turns / tool_calls / tool_output_bytes — for the
// analyzer's "and speed"/tool-usage reporting (Task 7). Consumed as
// `trajectory(raw, model)`.
//
// Codex's `exec --json` JSONL event stream carries a real tool trace (each
// `command_execution` item, plus `agent_message` items as a turn signal), so both
// tool_calls and tool_output_bytes are measured directly from the stream.
//
// Claude's `-p --output-format json` exposes only the final result + `usage` (see
// bench/fixtures/TELEMETRY-SCHEMA.md) — NOT a tool-call trajectory. `num_turns` is
// the one turn-shaped signal it emits, so `turns` uses that; `tool_calls` and
// `tool_output_bytes` are honestly `undefined` rather than a fabricated 0 (Claude
// did call tools — the -p json output just does not say how many, or how much
// they printed).
//
// FUTURE IMPROVEMENT (deferred, not implemented here): `claude -p --output-format
// stream-json` WOULD expose a per-turn tool-call trajectory, but switching to it
// changes `normalizeClaude`'s `JSON.parse(stdout)` and the runner's answer
// extraction (`JSON.parse(stdout).result`) — both currently assume a single JSON
// object, not a stream — and the change can't be smoke-verified without a paid
// run. Left on `--output-format json` for this pass; see task-6 report.

import { parseCodexEvents } from './telemetry.mjs';

const EMPTY = '';
const ZERO = 0;
const ITEM_COMPLETED = 'item.completed';
const AGENT_MESSAGE = 'agent_message';
const COMMAND_EXECUTION = 'command_execution';

const isCompletedItem = (event, itemType) =>
  event?.type === ITEM_COMPLETED && event?.item?.type === itemType;

// Codex emits `item.started` (in-progress, output not yet final) THEN
// `item.completed` (output final) for the SAME command id — only `item.completed`
// is counted, or a single tool call would be double-counted.
const commandOutputBytes = (item) =>
  Buffer.byteLength(item.aggregated_output ?? item.output ?? EMPTY, 'utf8');

// Malformed/empty raw naturally yields zero matching events (parseCodexEvents
// never throws — see telemetry.mjs), so codex trajectory degrades to real,
// honest zero counts rather than needing a separate error path.
const codexTrajectory = (raw) => {
  const events = parseCodexEvents(raw ?? EMPTY);
  const commands = events.filter((event) => isCompletedItem(event, COMMAND_EXECUTION));
  const turns = events.filter((event) => isCompletedItem(event, AGENT_MESSAGE)).length;
  const tool_output_bytes = commands.reduce(
    (total, event) => total + commandOutputBytes(event.item),
    ZERO,
  );
  return { tool_calls: commands.length, tool_output_bytes, turns };
};

const parseJson = (raw) => {
  try {
    return JSON.parse(raw ?? EMPTY);
  } catch {
    // Malformed/empty raw — degrade to no fields found, never throw.
    return {};
  }
};

const claudeTrajectory = (raw) => ({
  tool_calls: undefined,
  tool_output_bytes: undefined,
  turns: parseJson(raw).num_turns,
});

const TRAJECTORY_BY_MODEL = {
  claude: claudeTrajectory,
  codex: codexTrajectory,
};

const trajectory = (raw, model) => TRAJECTORY_BY_MODEL[model](raw);

export { trajectory };
