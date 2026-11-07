import type { RefsHome } from '../home.ts';
import { join } from 'node:path';
import { writeFileAtomic } from '../fs-atomic.ts';

const HOOK_MODE = 0o755;

const GUARD_HOOK_SCRIPT = [
  '#!/bin/sh',
  'echo "refs: this checkout is a managed read-only reference — commits are blocked" >&2',
  'exit 1',
  '',
].join('\n');

// Writes `hooks/pre-commit` + `hooks/pre-push` (0o755) into the shared hooks dir: with
// `core.hooksPath` pointed here per checkout (`cloneRepo`), git rejects any commit/push there.
const installHooksGuard = async (home: RefsHome): Promise<void> => {
  await Promise.all(
    ['pre-commit', 'pre-push'].map(async (name) => {
      await writeFileAtomic(join(home.hooksDir, name), GUARD_HOOK_SCRIPT, HOOK_MODE);
    }),
  );
};

export { installHooksGuard };
