import { describe, expect, it } from 'vitest';
import { resolveHome } from '@kaisers-io/refs-core';
import { run } from '../../src/main.ts';
import { seedConfig } from '../helpers/ref-fixtures.ts';
import { testContext } from '../helpers/context.ts';
import { withTempHome } from '../helpers/add-support.ts';

// `refs show` exists to display a ref, and the url is part of that. But the field may hold a
// credential: a bare ssh username is legal by design, and the read path types the url as any
// non-empty string, so a hand-edited config can carry `user:pass@`. `--json` is the agent contract,
// so this output leaves the terminal. The conventional `git@` stays readable — redacting it would
// mark every ordinary ref as secret-bearing and teach a reader to ignore the marker.

const TOKEN = 'DEPLOY_TOKEN_xyz';
const PASSWORD = 'HTTPS_SECRET_abc';

const entry = (url: string): Record<string, unknown> => ({
  default_branch: 'main',
  description: 'a ref',
  url,
});

const showUrlFor = async (homeDir: string, key: string, url: string): Promise<string> => {
  const { ctx, stdout } = testContext();
  ctx.env['REFS_HOME'] = homeDir;
  await seedConfig(resolveHome(ctx.env), { [key]: entry(url) });
  await run(ctx, ['node', 'refs', 'show', key, '--json']);
  const [line] = stdout;
  const payload = JSON.parse(line ?? '{}') as { data?: { url?: string } };
  return payload.data?.url ?? '';
};

describe('refs show --json', () => {
  it('does not emit a token used as an ssh username', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const url = await showUrlFor(
        homeDir,
        'example.com/o/r',
        `ssh://${TOKEN}@example.com/o/r.git`,
      );
      expect(url).toBe('ssh://<redacted>@example.com/o/r.git');
      expect(url).not.toContain(TOKEN);
    });
  });

  it('does not emit an https password', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const url = await showUrlFor(
        homeDir,
        'example.com/o/s',
        `https://user:${PASSWORD}@example.com/o/s.git`,
      );
      expect(url).toBe('https://<redacted>@example.com/o/s.git');
      expect(url).not.toContain(PASSWORD);
    });
  });

  it('still shows an ordinary ssh ref as written', async () => {
    expect.hasAssertions();
    await withTempHome(async (homeDir) => {
      const url = await showUrlFor(homeDir, 'github.com/o/r', 'git@github.com:o/r.git');
      expect(url).toBe('git@github.com:o/r.git');
    });
  });
});
