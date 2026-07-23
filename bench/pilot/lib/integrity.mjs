// Run-integrity hard-fails: a drifted or leaky setup must abort BEFORE any paid
// run (the pilot only warned/printed these). Each guard exits non-zero with a
// clear message; recheckHead re-verifies a read-only checkout did not move mid-run.

import { headSha } from './provenance.mjs';
import { join } from 'node:path';

const FAIL_EXIT = 1;
const ZERO = 0;
const EMPTY = '';
const FULL = 'full';
const CONTROL_RUNGS = ['naive', 'discipline'];

const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(FAIL_EXIT);
};

// HARD-FAIL: every checkout HEAD must equal the task's pinned commit before any
// paid run starts (a drifted checkout silently invalidates ground truth).
const failOnCommitDrift = (tasks, checkouts) => {
  const drift = tasks.filter((task) => checkouts[task.ref].head !== task.commit);
  if (drift.length === ZERO) {
    return;
  }
  const lines = drift
    .map(
      (task) =>
        `  ${task.id}: pins ${task.commit} but ${task.ref} HEAD is ${checkouts[task.ref].head}`,
    )
    .join('\n');
  die(`FATAL: checkout commit drift (read-only pins violated):\n${lines}`);
};

// HARD-FAIL: controls must NOT resolve refs (leak), and full MUST resolve the exact
// shim path — protects the full-vs-control isolation the whole contrast rests on.
const failOnCompliance = (shim) => {
  const expected = join(shim.shimDir, 'refs');
  const leaks = CONTROL_RUNGS.filter((rung) => shim.onPath[rung] !== EMPTY).map(
    (rung) => `  ${rung} leaks refs at ${shim.onPath[rung]}`,
  );
  const problems = [...leaks];
  if (shim.onPath[FULL] !== expected) {
    problems.push(`  full resolves '${shim.onPath[FULL]}', expected the shim '${expected}'`);
  }
  if (problems.length > ZERO) {
    die(`FATAL: refs-compliance isolation broken:\n${problems.join('\n')}`);
  }
};

// A read-only agent must not move the checkout; re-read the ref's HEAD after each
// cell and hard-fail if it drifted mid-run (cheap: one rev-parse).
const recheckHead = async (exec, checkout, task) => {
  const head = await headSha(exec, checkout.path);
  if (head !== checkout.head) {
    die(`FATAL: ${task.ref} HEAD moved mid-run (${checkout.head} -> ${head}) during ${task.id}`);
  }
};

export { failOnCommitDrift, failOnCompliance, recheckHead };
