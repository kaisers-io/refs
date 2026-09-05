import { describe, expect, it } from 'vitest';
import type { LockDiagnosis } from '../src/lock-lease.ts';
import { describeHeldLock } from '../src/lock-describe.ts';

// The message a waiter prints when it gives up. It is the only thing most people will ever see
// about the locking protocol, so what it may and may not claim is pinned here rather than left to
// whoever edits the string next.
//
// Two claims it must never make: that a lock is "released automatically" (nothing removes one in
// the background — the next acquisition attempt is merely entitled to take it), and that the
// recorded pid IS the holder (only ESRCH establishes absence; a pid that answers may be an
// unrelated process that reused the number).

const NOW = 1_800_000_000_000;
const RENEWED_18S_AGO = 18_000;
const LEASE_BUDGET_MS = 120_000;
const LEGACY_BUDGET_MS = 600_000;
const GRACE_BUDGET_MS = 5000;
const ACQUIRED_3M_AGO = 180_000;
const HELD_1H3M = 3_780_000;
const SKEWED_AHEAD_MS = -5000;
const PID = 41_233;

const diagnosis = (overrides: Partial<LockDiagnosis>): LockDiagnosis => ({
  meta: 'valid',
  observedAtMs: NOW,
  pidState: 'present-or-unknown',
  policy: 'lease',
  stale: false,
  ...overrides,
});

describe('describeHeldLock on a healthy holder', () => {
  it('names the recorded pid without claiming it is the holder', () => {
    expect.hasAssertions();
    const message = describeHeldLock(
      'home',
      diagnosis({ ageMs: RENEWED_18S_AGO, budgetMs: LEASE_BUDGET_MS, pid: PID }),
    );

    expect(message).toContain(`recorded pid ${PID} is present (identity not verified)`);
  });

  it('measures a renewable lock from its last renewal, not from acquisition', () => {
    expect.hasAssertions();
    const message = describeHeldLock(
      'home',
      diagnosis({ ageMs: RENEWED_18S_AGO, budgetMs: LEASE_BUDGET_MS, pid: PID }),
    );

    // Getting this wrong would be actively misleading: a healthy renewable lock can be hours old.
    expect(message).toContain('lease renewed 18s ago; reclaimable 2m from the last renewal');
  });

  it('never promises that a lock is released on its own', () => {
    expect.hasAssertions();
    const message = describeHeldLock(
      'home',
      diagnosis({ ageMs: RENEWED_18S_AGO, budgetMs: LEASE_BUDGET_MS, pid: PID }),
    );

    expect(message).not.toMatch(/automatic|released after|will be released/iu);
  });
});

describe('describeHeldLock on a legacy lock', () => {
  it('measures from acquisition and says there is no renewable lease', () => {
    expect.hasAssertions();
    const message = describeHeldLock(
      'home',
      diagnosis({
        ageMs: ACQUIRED_3M_AGO,
        budgetMs: LEGACY_BUDGET_MS,
        pid: PID,
        policy: 'legacy',
      }),
    );

    expect(message).toContain('acquired 3m ago; reclaimable 10m from acquisition');
  });
});

describe('describeHeldLock on an unpublished lock', () => {
  it('says the owner is unknown rather than inventing one', () => {
    expect.hasAssertions();
    const message = describeHeldLock(
      'home',
      diagnosis({ ageMs: 0, budgetMs: GRACE_BUDGET_MS, meta: 'missing', policy: 'grace' }),
    );

    // No pid was recorded, so none is printed. Naming one here would be fabrication.
    expect(message).toContain('owner unknown (metadata missing)');
  });
});

describe('describeHeldLock on a reclaimable lock', () => {
  it('says the lock should already have been taken, not that it is still ticking', () => {
    expect.hasAssertions();
    const message = describeHeldLock(
      'home',
      diagnosis({ pid: PID, pidState: 'definitely-dead', stale: true }),
    );

    // Reaching the timeout does not prove the lock was healthy: it can equally mean the steal
    // claim or the rename kept failing. "Wait a bit longer" would be the wrong advice.
    expect(message).toContain('already reclaimable');
    expect(message).toContain(`recorded pid ${PID} is not running`);
  });
});

describe('describeHeldLock on a vanished lock', () => {
  it('tells the caller it was released while the failure was being diagnosed', () => {
    expect.hasAssertions();
    const message = describeHeldLock('home', diagnosis({ policy: 'none' }));

    // Diagnosis happens after the timeout, so the lock may already be gone. Printing an owner for
    // a lock that no longer exists would send the reader after a ghost.
    expect(message).toContain('released while the failure was being diagnosed');
  });
});

describe('describeHeldLock on a skewed clock', () => {
  it('reports a future timestamp instead of rendering a negative age', () => {
    expect.hasAssertions();
    const message = describeHeldLock(
      'home',
      diagnosis({ ageMs: SKEWED_AHEAD_MS, budgetMs: LEASE_BUDGET_MS, pid: PID }),
    );

    expect(message).toContain('recorded time is in the future');
    expect(message).not.toContain('-');
  });
});

describe('describeHeldLock duration rendering', () => {
  it('drops a trailing zero unit and scales to hours', () => {
    expect.hasAssertions();
    const message = describeHeldLock(
      'home',
      diagnosis({ ageMs: HELD_1H3M, budgetMs: LEGACY_BUDGET_MS, pid: PID, policy: 'legacy' }),
    );

    // "1h 3m", not "1h 3m 0s"; "10m", not "10m 0s".
    expect(message).toContain('acquired 1h 3m ago; reclaimable 10m from acquisition');
  });
});
