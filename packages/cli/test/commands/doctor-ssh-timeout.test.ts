import { buildSshConfig, buildSshRefEntry } from '../helpers/doctor-support.ts';
import { describe, expect, it } from 'vitest';
import { TIMEOUT_EXIT_CODE } from '@kaisers-io/refs-core';
import { checkSshAuth } from '../../src/commands/doctor-checks-ssh.ts';
import { testContext } from '../helpers/context.ts';

// Split out of `doctor-ssh.test.ts` purely to keep that file under the repo's 300-line oxlint cap.
// Covers two precision findings around ssh probing: (1) `exitCode: 124` alone is ambiguous — it
// can be either a killed-by-`timeoutMs` probe OR a real child that genuinely exits 124 on its own,
// so `checkSshAuth` must branch on `RunResult.timedOut`, not `exitCode`, to tell them apart
// (`doctor-ssh.test.ts`'s own "ssh-auth probe timeout" suite covers the killed-by-timeout side);
// (2) a userless `ssh://` url must be probed as the bare host, not forced to `git@host` — the
// LOCAL ssh config, not this check, decides who a plain `ssh <host>`/clone connects as.

const SSH_KEY = 'github.com/acme/ssh-repo';
const SSH_HOST = 'github.com';
const SSH_PROBE_PREFIX = 'ssh -o ConnectTimeout=5 -o BatchMode=yes -T git@github.com';

describe('refs doctor: ssh-auth genuine exit 124 (not a timeout)', () => {
  it('treats a real exit-124 child as any accepted exit code, not as a timeout', async () => {
    expect.hasAssertions();
    const { ctx, runner } = testContext();
    const config = buildSshConfig({ [SSH_KEY]: buildSshRefEntry(SSH_HOST) });
    runner.expect(SSH_PROBE_PREFIX, { exitCode: TIMEOUT_EXIT_CODE, stdout: '' });

    const result = await checkSshAuth(ctx, config);

    expect(result?.status).toBe('ok');
    expect(result?.detail).not.toContain('Permission denied');
  });
});

const BARE_HOST = 'example.com';
const BARE_KEY = 'example.com/acme/bare-repo';
const BARE_PROBE_PREFIX = 'ssh -o ConnectTimeout=5 -o BatchMode=yes -T example.com';
const BARE_REF_ENTRY = {
  default_branch: 'main',
  description: 'Ssh no-user lib',
  tag_format: 'v{version}',
  url: 'ssh://example.com/org/repo',
};

describe('refs doctor: ssh-auth honors a userless ssh:// url', () => {
  it('probes the bare host, with no user@ prefix, matching what a real clone does', async () => {
    expect.hasAssertions();
    const { ctx, runner } = testContext();
    const config = buildSshConfig({ [BARE_KEY]: BARE_REF_ENTRY });
    runner.expect(BARE_PROBE_PREFIX, { exitCode: 1, stdout: '' });

    const result = await checkSshAuth(ctx, config);

    expect(result?.status).toBe('ok');
    const [call] = runner.calls;
    expect(call?.args).toStrictEqual(expect.arrayContaining(['-T', BARE_HOST]));
  });
});
