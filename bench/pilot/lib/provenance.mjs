// Immutable run provenance: the manifest written once at run start, plus the
// per-record stamp derived from it. Kept out of run.mjs so the orchestrator stays
// within its line budget; every git / CLI-version read goes through the injected
// `exec` seam (so this stays unit-testable and never hard-codes a subprocess).

import { createHash } from 'node:crypto';

const OK_EXIT = 0;
const EMPTY = '';
// Model + effort pins, mirrored from lib/runner.mjs, recorded once so a later reader
// knows exactly which model answered under each identity.
const MODEL_META = {
  claude: { effort: undefined, model: 'claude-opus-4-8' },
  codex: { effort: 'medium', model: 'gpt-5.6-sol' },
};
// Real per-component prices land in Task 4; the field is carried now so the manifest
// and every record have a stable place for it.
const PRICING_AS_OF = 'unpriced (prices land in Task 4)';
// Version-range tasks name their tags in the question (e.g. v4.4.2); peel any such
// token against the checkout ("if resolvable" — unresolvable tags are omitted).
const TAG_RE = /v\d+\.\d+\.\d+/gu;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const gitOut = async (exec, args) => {
  const { stdout, code } = await exec('git', args, {});
  if (code !== OK_EXIT) {
    return EMPTY;
  }
  return stdout.trim();
};

const headSha = (exec, checkoutPath) => gitOut(exec, ['-C', checkoutPath, 'rev-parse', 'HEAD']);

const cliVersion = async (exec, cmd) => {
  try {
    const { stdout, code } = await exec(cmd, ['--version'], {});
    if (code !== OK_EXIT) {
      return EMPTY;
    }
    return stdout.trim();
  } catch {
    // CLI absent on PATH — record empty rather than crash the manifest.
    return EMPTY;
  }
};

const captureCliVersions = async (exec) => {
  const [claude, codex] = await Promise.all([
    cliVersion(exec, 'claude'),
    cliVersion(exec, 'codex'),
  ]);
  return { claude, codex };
};

const harnessGit = async (exec) => {
  const [commit, status] = await Promise.all([
    gitOut(exec, ['rev-parse', 'HEAD']),
    gitOut(exec, ['status', '--porcelain']),
  ]);
  return { commit, dirty: status !== EMPTY };
};

// Peel the version tags a version-range task names in its question; unresolvable
// tags drop out, and non-range tasks carry an empty set.
const peelTags = async (exec, task, checkout) => {
  if (task.job_type !== 'version-range') {
    return {};
  }
  const matched = task.question.match(TAG_RE) ?? [];
  const tags = [...new Set(matched)];
  const peeled = await Promise.all(
    tags.map(async (tag) => [
      tag,
      await gitOut(exec, ['-C', checkout.path, 'rev-list', '-n', '1', tag]),
    ]),
  );
  return Object.fromEntries(peeled.filter(([, sha]) => sha !== EMPTY));
};

const taskManifest = async (exec, task, checkout) => ({
  checkout_head: checkout.head,
  commit_expected: task.commit,
  content_hash: sha256(JSON.stringify(task)),
  tags: await peelTags(exec, task, checkout),
  task_id: task.id,
});

const hashPreambles = (preambles) =>
  Object.fromEntries(Object.entries(preambles).map(([rung, text]) => [rung, sha256(text)]));

const buildManifest = async ({ checkouts, exec, preambles, refsBinPath, seed, tasks }) => {
  const [harness, cli_versions] = await Promise.all([harnessGit(exec), captureCliVersions(exec)]);
  const taskEntries = await Promise.all(
    tasks.map((task) => taskManifest(exec, task, checkouts[task.ref])),
  );
  return {
    cli_versions,
    harness_commit: harness.commit,
    harness_dirty: harness.dirty,
    models: MODEL_META,
    preamble_hashes: hashPreambles(preambles),
    pricing_as_of: PRICING_AS_OF,
    // The refs binary ships from this same repo, so its source HEAD is the harness commit.
    refs_source: { head: harness.commit, path: refsBinPath },
    seed,
    tasks: taskEntries,
  };
};

const provenanceOf = (manifest, run_id) => ({
  cli_versions: manifest.cli_versions,
  pricing_as_of: manifest.pricing_as_of,
  refs_version: manifest.refs_source.head,
  run_id,
});

export { buildManifest, gitOut, headSha, provenanceOf };
