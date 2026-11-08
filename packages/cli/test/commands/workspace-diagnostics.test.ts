import { describe, expect, it } from 'vitest';
import type { WorkspaceDiagnostic } from '@kaisers-io/refs-core';
import { discoveryObstacle } from '../../src/commands/workspace-diagnostics.ts';

// The obstacle line is what `refs add`'s dry-run and the drift probe print when a workspace scan
// could not be completed. It has to name WHERE each problem is, in the shape of that kind, or the
// reader is told something went wrong and nothing about what to fix.

const obstacleOf = (diagnostics: WorkspaceDiagnostic[]): string =>
  discoveryObstacle({ diagnostics, packages: [], versions: {} });

describe('the discovery obstacle', () => {
  it('names each unreliable diagnostic by the place it is about', () => {
    expect.hasAssertions();

    const line = obstacleOf([
      { kind: 'workspace_dir_unreadable', path: 'packages' },
      { kind: 'candidate_not_inspected', path: 'apps/web' },
      { file: 'pnpm-workspace.yaml', kind: 'workspace_declaration_unparsed' },
      { file: 'package.json', kind: 'workspace_file_unreadable' },
      { kind: 'unsupported_pattern', pattern: '{a,b}/*' },
      { kind: 'manifest_unreadable', path: 'packages/c' },
      { kind: 'scan_budget_exhausted', path: 'fixtures/deep', pattern: 'fixtures/**' },
    ]);

    // Sorted by codepoint, so two runs over the same checkout print the same line. A budget stop carries both
    // the pattern being walked and how far it got: either alone leaves the reader stuck.
    expect(line).toBe(
      [
        'apps/web: candidate_not_inspected',
        'fixtures/** at fixtures/deep: scan_budget_exhausted',
        'package.json: workspace_file_unreadable',
        'packages/c: manifest_unreadable',
        'packages: workspace_dir_unreadable',
        'pnpm-workspace.yaml: workspace_declaration_unparsed',
        '{a,b}/*: unsupported_pattern',
      ].join(', '),
    );
  });

  it('leaves out what does not make a scan unreliable', () => {
    expect.hasAssertions();

    // A directory without a package name is not a member, and a repository without a workspace
    // declaration has nothing to expand. Neither stopped discovery, so neither is an obstacle.
    const line = obstacleOf([
      { kind: 'manifest_missing_name', path: 'packages/unnamed' },
      { kind: 'no_workspace_declaration' },
      { kind: 'manifest_unreadable', path: 'packages/c' },
    ]);

    expect(line).toBe('packages/c: manifest_unreadable');
  });
});
