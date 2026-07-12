import { describe, expect, it } from 'vitest';
import { FakeRunner } from '../../src/proc/fake-runner.ts';

// Task 24 gap: `FakeRunner.expect()` queues scripted responses FIFO — consumed in the order they
// were queued, not matched by content — so this proves that ordering holds across MULTIPLE (≥3)
// queued calls rather than relying on every other suite's incidental single/double-call coverage.

const THREE_CALLS = 3;

const scriptThreeCalls = (runner: FakeRunner): void => {
  runner.expect('git fetch', { stdout: 'first\n' });
  runner.expect('git status', { stdout: 'second\n' });
  runner.expect('git rev-parse HEAD', { stdout: 'third\n' });
};

describe('queued-response ordering (FakeRunner)', () => {
  it('resolves 3+ queued calls in the order they were queued, not the order commands were expected', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    scriptThreeCalls(runner);

    const first = await runner.run('git', ['fetch']);
    const second = await runner.run('git', ['status']);
    const third = await runner.run('git', ['rev-parse', 'HEAD']);

    expect(first.stdout).toBe('first\n');
    expect(second.stdout).toBe('second\n');
    expect(third.stdout).toBe('third\n');
    expect(runner.calls).toHaveLength(THREE_CALLS);
  });
});

describe('stdoutTruncated passthrough (FakeRunner)', () => {
  it('mirrors SpawnRunner: present-and-true only when scripted, absent otherwise', async () => {
    expect.hasAssertions();
    const runner = new FakeRunner();
    runner.expect('git grep', { stdout: 'partial', stdoutTruncated: true });
    runner.expect('git grep', { stdout: 'complete' });

    const capped = await runner.run('git', ['grep']);
    const clean = await runner.run('git', ['grep']);

    expect(capped.stdoutTruncated).toBe(true);
    expect('stdoutTruncated' in clean).toBe(false);
  });
});
