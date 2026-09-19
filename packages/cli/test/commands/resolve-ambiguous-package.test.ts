import { describe, expect, it } from 'vitest';
import { seedConfig, seedState } from '../helpers/ref-fixtures.ts';
import { withResetExitCode, withTempHome } from '../helpers/add-support.ts';
import { resolveHome } from '@kaisers-io/refs-core';
import { resolveJson } from '../helpers/resolve-support.ts';

// The message `refs resolve` gives when two refs register the same package name.
//
// It used to end in `refs resolve <name> --ref <ref>` with `<ref>` left as a literal placeholder —
// which a shell reads as an input redirection, so the line as printed is a parse error and runs
// nothing. The colliding keys are in hand where the message is built, so it names one. Both values
// are quoted for the same reason every other printed command quotes them: a package name comes
// from a tracked repository's own manifest.

const ALPHA = 'github.com/acme/alpha';
const BETA = 'github.com/acme/beta';
const SHARED = '@acme/shared';

const entryFor = (url: string): Record<string, unknown> => ({
  default_branch: 'main',
  description: 'A ref.',
  packages: { [SHARED]: { description: 'The shared package.', path: 'packages/shared' } },
  url,
});

describe('refs resolve: a package name two refs register', () => {
  it('names a real ref in the remedy, not a placeholder a shell would read', async () => {
    expect.hasAssertions();
    await withResetExitCode(() =>
      withTempHome(async (homeDir) => {
        const home = resolveHome({ REFS_HOME: homeDir });
        await seedConfig(home, {
          [ALPHA]: entryFor(`https://${ALPHA}`),
          [BETA]: entryFor(`https://${BETA}`),
        });
        await seedState(home, {});

        const envelope = await resolveJson(homeDir, [SHARED]);

        expect(envelope.error?.message).toContain(
          `registered by more than one ref: ${ALPHA}, ${BETA}`,
        );
        expect(envelope.error?.message).toContain(`refs resolve '${SHARED}' --ref '${ALPHA}'`);
        // The shape that made the line unrunnable.
        expect(envelope.error?.message).not.toContain('<ref>');
      }),
    );
  });
});
