import { addPackage, freshRepo } from './helpers/workspace-fixture.ts';
import { describe, expect, it } from 'vitest';
import type { ExpandResult } from '../src/workspaces-probe.ts';
import type { ScanBudget } from '../src/workspaces-recursive.ts';
import { excludedDirsFor } from '../src/workspaces.ts';
// eslint-disable-next-line no-duplicate-imports -- consistent-type-specifier-style requires a separate top-level `import type`
import { expandRecursive } from '../src/workspaces-recursive.ts';

// The walk's BUDGET, and what it refuses to spend it on. Driven through `expandRecursive` with a
// budget small enough to run out, because that is the only way the rules here are observable: in
// a small fixture the same packages are found either way, and the difference is only how much of
// a shared budget a subtree that can contribute nothing takes from the ones that can.

const LARGE_DIR_BUDGET = 1000;
const LARGE_ENTRY_BUDGET = 1000;
const TIGHT_ENTRY_BUDGET = 2;

/** A walk with a budget small enough to run out, so what it SPENDS is observable. The two rules
 * under test are both about spend: without them the packages are still found in a small fixture,
 * and the only difference is how much of a shared budget a subtree that can contribute nothing
 * takes from the ones that can. */
const walkWith = (
  repo: string,
  pattern: string,
  options: { budget: ScanBudget; negations?: string[] },
): Promise<ExpandResult> => {
  const negations = options.negations ?? [];
  return expandRecursive(
    repo,
    { baseDir: pattern.split('/')[0] ?? '.', pattern },
    // The REAL predicates, built the way `expandSelection` builds them. A test that restates the
    // exclusion rules with its own matcher proves nothing about what ships — and the rule this
    // one is about is exactly the kind that looks right when restated.
    {
      budget: options.budget,
      excluded: excludedDirsFor(negations.map((negation) => `!${negation}`)),
    },
  );
};

describe('budget spent only where a package could be', () => {
  it('does not spend the budget on a subtree the repository excluded entirely', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    addPackage(repo, 'packages/generated/a/b', { name: '@deep/generated', version: '1.0.0' });
    addPackage(repo, 'packages/zreal', { name: '@deep/real', version: '1.0.0' });

    // Four directories: `packages`, the excluded tree's three levels. `zreal` sorts last, so a
    // walk that pays for the excluded tree never reaches it.
    const budget = { dirs: 3, entries: LARGE_ENTRY_BUDGET };
    const result = await walkWith(repo, 'packages/**', {
      budget,
      negations: ['packages/generated/**'],
    });

    expect(result.dirs).toStrictEqual(['packages/zreal']);
  });

  it('does not spend the budget below the depth its pattern can reach', async () => {
    expect.hasAssertions();
    const repo = freshRepo();
    addPackage(repo, 'packages/group/pkg', { name: '@deep/pkg', version: '1.0.0' });
    addPackage(repo, 'packages/group/pkg/deeper/still', { name: '@deep/still', version: '1.0.0' });

    // `packages/*/*` cannot select anything below its third segment. Listing one anyway spends
    // entries — and a package holding a large tree would then report the scan incomplete, having
    // in fact looked everywhere the pattern reaches.
    // Two entries is what the walk needs when it stops at the depth the pattern reaches:
    // `packages` lists one child, `packages/group` lists one. Listing the package itself is the
    // third, and there is no budget for it.
    const budget = { dirs: LARGE_DIR_BUDGET, entries: TIGHT_ENTRY_BUDGET };
    const result = await walkWith(repo, 'packages/*/*', { budget });

    expect(result.dirs).toStrictEqual(['packages/group/pkg']);
    expect(result.diagnostics).toStrictEqual([]);
  });
});
