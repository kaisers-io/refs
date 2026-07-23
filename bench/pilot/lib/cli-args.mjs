// Pure CLI-argument helpers for the smoke-run controls (Task 8: --tasks / --rungs
// cell selection, --repeats / --seed numeric flags), plus their thin I/O wrappers
// and the pre-flight plan formatter. Split out of run.mjs to stay under its oxlint
// line cap. The filter/validation logic below is pure and exported for unit
// testing; the *Filter wrappers print to stderr/exit and stay untested, same status
// as run.mjs's own I/O (main() is not unit-tested either).

const NOT_FOUND = -1;
const NEXT = 1;
const ZERO = 0;
const FAIL_EXIT = 1;

const parseCsv = (value) =>
  value
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > ZERO);

// Returns undefined when the flag is absent (caller applies its own default);
// otherwise the comma-split, trimmed, non-empty tokens (possibly []).
const parseCsvFlag = (argv, flag) => {
  const index = argv.indexOf(flag);
  if (index === NOT_FOUND) {
    return;
  }
  return parseCsv(argv[index + NEXT] ?? '');
};

const parseNumberFlag = (argv, flag, fallback) => {
  const index = argv.indexOf(flag);
  if (index === NOT_FOUND) {
    return fallback;
  }
  return Number(argv[index + NEXT]);
};

// Keeps only tasks whose id is named in `ids`; also reports any named id that
// matched no loaded task, so a typo narrows the grid loudly instead of silently.
const selectTasks = (tasks, ids) => {
  const wanted = new Set(ids);
  const selected = tasks.filter((task) => wanted.has(task.id));
  const found = new Set(selected.map((task) => task.id));
  const missing = ids.filter((id) => !found.has(id));
  return { missing, selected };
};

// Validates a requested rung subset against the full rung enum.
const resolveRungs = (names, validRungs) => {
  const known = new Set(validRungs);
  return {
    invalid: names.filter((name) => !known.has(name)),
    rungs: names.filter((name) => known.has(name)),
  };
};

const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(FAIL_EXIT);
};

// --tasks I/O wrapper: absent flag is a no-op (full corpus). A named id that
// matched nothing warns (never silently ignored). An empty result after filtering
// hard-fails — never run 0 cells silently.
const applyTaskFilter = (argv, tasks) => {
  const ids = parseCsvFlag(argv, '--tasks');
  if (ids === undefined) {
    return tasks;
  }
  const { missing, selected } = selectTasks(tasks, ids);
  if (missing.length > ZERO) {
    process.stderr.write(`--tasks: unknown task id(s), ignored: ${missing.join(', ')}\n`);
  }
  if (selected.length === ZERO) {
    die('--tasks matched no loaded tasks — refusing to run 0 cells');
  }
  return selected;
};

// --rungs I/O wrapper: absent flag defaults to the full rung set. Any unknown rung
// name hard-fails rather than being silently dropped from the grid.
const applyRungFilter = (argv, allRungs) => {
  const names = parseCsvFlag(argv, '--rungs');
  if (names === undefined) {
    return allRungs;
  }
  const { invalid, rungs } = resolveRungs(names, allRungs);
  if (invalid.length > ZERO) {
    die(`--rungs: unknown rung(s) ${invalid.join(', ')} (expected one of ${allRungs.join(', ')})`);
  }
  return rungs;
};

// One-call wrapper for both smoke-selection filters, used as a single main()
// statement in run.mjs (--tasks then --rungs; each independently defaults to "no
// filter" when its flag is absent).
const applyGridFilters = (argv, tasks, allRungs) => ({
  rungs: applyRungFilter(argv, allRungs),
  tasks: applyTaskFilter(argv, tasks),
});

const formatCliVersion = (label, version) => `${label}=${version || '(not found)'}`;

const formatOnPath = (rungs, onPath) =>
  rungs.map((rung) => `${rung}=${onPath[rung] || '(none)'}`).join(' ');

// Informational pre-flight plan printed before any paid call: exact cell and paid-
// invocation count, the resolved grid (models/rungs/tasks), the seed, captured CLI
// versions, and refs-on-PATH exposure per rung — so the operator can eyeball spend
// and setup before the run proceeds (Codex review; not an interactive gate, the
// run always continues — spend is controlled via --tasks/--rungs/--repeats).
const formatPreflightPlan = ({
  cellCount,
  cliVersions,
  models,
  onPath,
  repeats,
  rungs,
  runId,
  seed,
  taskIds,
}) =>
  [
    '=== pre-flight plan ===',
    `run_id: ${runId}`,
    `cells: ${cellCount}`,
    `paid invocations (answer pass): ${cellCount} (judge pass adds ~1 more per cell in score-run)`,
    `models: ${models.join(', ')}`,
    `rungs: ${rungs.join(', ')}`,
    `tasks (${taskIds.length}): ${taskIds.join(', ')}`,
    `repeats: ${repeats}`,
    `seed: ${seed}`,
    `cli versions: ${formatCliVersion('claude', cliVersions.claude)} ${formatCliVersion('codex', cliVersions.codex)}`,
    `refs on PATH: ${formatOnPath(rungs, onPath)}`,
    '========================',
    '',
  ].join('\n');

const printPreflightPlan = (info) => {
  process.stdout.write(formatPreflightPlan(info));
};

export {
  applyGridFilters,
  formatPreflightPlan,
  parseCsvFlag,
  parseNumberFlag,
  printPreflightPlan,
  resolveRungs,
  selectTasks,
};
