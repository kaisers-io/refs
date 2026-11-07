import { addPackage, writeJson } from '../helpers/workspace-fixture.ts';
import { checkoutPath, zRefKey } from '@kaisers-io/refs-core';
import { describe, expect, it } from 'vitest';
import {
  expectGitVersion,
  setupInitializedHome,
  withResetExitCode,
  withTempHome,
} from '../helpers/doctor-support.ts';
import { markCheckoutPresent, seedConfig } from '../helpers/ref-fixtures.ts';
import type { DoctorTestHome } from '../helpers/doctor-support.ts';
import { join } from 'node:path';
import { run } from '../../src/main.ts';

// A workspace member's name is taken from its manifest and interpolated unquoted at the head of
// every drift finding. JSON admits LF, CR, ESC and DEL in a string, and no name check anywhere
// constrains them — so before `displaySafe` a manifest could add a line to refs' own human output
// that was byte-for-byte indistinguishable from one refs wrote. Driven through the CLI, because
// the thing under test is what reaches the terminal.

const ALPHA_KEY = 'github.com/acme/alpha';
const ALPHA_URL = 'https://github.com/acme/alpha';

// Ends in the shape a genuine finding ends in, so an operator reading it would have no way to tell.
const FORGED_TAIL =
  "acme-root: declared in this checkout but not registered. To register it: refs edit --package='x'";
const HOSTILE_NAME = `@acme/b\n${FORGED_TAIL}`;

const CONTROL_CHARACTER = /\p{Cc}/u;

const seedHostileCheckout = async (setup: DoctorTestHome): Promise<string> => {
  await seedConfig(setup.home, {
    [ALPHA_KEY]: {
      default_branch: 'main',
      description: 'Alpha lib',
      packages: { '@acme/a': { description: 'Package A.', path: 'packages/a' } },
      url: ALPHA_URL,
    },
  });
  const dest = checkoutPath(setup.home, zRefKey.parse(ALPHA_KEY));
  await markCheckoutPresent(dest, { hooksDir: setup.home.hooksDir, url: ALPHA_URL });
  writeJson(join(dest, 'package.json'), { workspaces: ['packages/*'] });
  addPackage(dest, 'packages/a', { name: '@acme/a', version: '1.0.0' });
  addPackage(dest, 'packages/b', { name: HOSTILE_NAME, version: '1.0.0' });
  expectGitVersion(setup.runner);
  setup.runner.expect(
    'git config --local --get core.hooksPath',
    { stdout: setup.home.hooksDir },
    { cwd: dest },
  );
  setup.runner.expect('git status --porcelain', { stdout: '' }, { cwd: dest });
  return dest;
};

describe('human output cannot be restructured by a tracked repository', () => {
  it('reports a manifest newline inside one line instead of as a line of its own', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const setup = await setupInitializedHome(homeDir);
        await seedHostileCheckout(setup);

        await run(setup.ctx, ['node', 'refs', 'doctor']);

        // The name still reaches the reader — nothing is dropped — but it cannot BE a line.
        expect(setup.stdout.join('\n')).toContain(FORGED_TAIL);
        expect(setup.stdout.some((line) => line.startsWith(FORGED_TAIL))).toBe(false);
        expect(setup.stdout.every((line) => !CONTROL_CHARACTER.test(line))).toBe(true);
      }),
    );
  });
});
