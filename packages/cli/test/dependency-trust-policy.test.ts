import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readFile } from 'node:fs/promises';

const workspace = parse(
  await readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8'),
) as Record<string, unknown>;

describe('dependency publishing trust policy', () => {
  it('rejects publishing trust downgrades', () => {
    expect.hasAssertions();
    expect(workspace['trustPolicy']).toBe('no-downgrade');
  });

  it('preserves frozen-install checks without blanket exceptions', () => {
    expect.hasAssertions();
    expect(workspace['trustLockfile']).toBeUndefined();
    expect(workspace['trustPolicyIgnoreAfter']).toBeUndefined();
    expect(workspace['trustPolicyExclude']).toBeUndefined();
  });
});
