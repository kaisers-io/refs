import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '@kaisers-io/refs-core';
import { join } from 'node:path';
import { readGitConfigValues } from '../../src/commands/git-config-read.ts';
import { tmpdir } from 'node:os';

// The unit tests above assert what this parser does. This one asserts that it agrees with GIT —
// which is the only thing that makes the checkout-identity check meaningful, since git is what
// decides where a checkout actually fetches from.
//
// Every case here was a real defect at some point: a spaced subsection standing in for `origin`, a
// backslash inside a comment hiding a second assignment, unicode whitespace being trimmed. A
// parser that merely looks careful is not enough when disagreeing with git is the whole failure.

const runner = new SpawnRunner();
const MARKER = 'core.hookspath';
const ORIGIN = 'remote.origin.url';

const gitValues = async (file: string, key: string): Promise<string[]> => {
  const result = await runner.run('git', ['config', '--file', file, '--get-all', key]);
  return result.stdout.split('\n').filter((line) => line !== '');
};

const ourValues = (config: string, key: string): string[] | 'malformed' => {
  const found = readGitConfigValues(config, [MARKER, ORIGIN]);
  return found === undefined ? 'malformed' : (found.get(key) ?? []);
};

const CASES: readonly { config: string; key: string; label: string }[] = [
  {
    config: '[remote " origin "]\n\turl = https://example.com/x.git\n',
    key: ORIGIN,
    label: 'a spaced subsection is not `origin`',
  },
  {
    config: '[core]\n\thooksPath = /expected # note \\\n\thooksPath = /attacker\n',
    key: MARKER,
    label: 'a backslash inside a comment does not continue the line',
  },
  {
    config: '[core]\n\thooksPath = /hooks\u00A0\n',
    key: MARKER,
    label: 'unicode whitespace is part of the value',
  },
  {
    config: '[core]\n\thooksPath = " /ho oks "\n',
    key: MARKER,
    label: 'quoted whitespace is kept',
  },
  { config: '[core]\n\thooksPath =   /hooks   \n', key: MARKER, label: 'unquoted padding is not' },
  {
    config: '[core]\n\thooksPath = C:\\\\\n[remote "origin"]\n\turl = https://e/x\n',
    key: ORIGIN,
    label: 'an escaped backslash ends the value, not the line',
  },
  {
    config: '[CORE] # note\n\tHooksPath = /real\n',
    key: MARKER,
    label: 'case and section comments',
  },
];

describe('the git config reader agrees with git', () => {
  it.each(CASES)(
    '$label',
    async ({ config, key }) => {
      expect.hasAssertions();
      const dir = await mkdtemp(join(tmpdir(), 'refs-gitcfg-'));
      const file = join(dir, 'config');
      await writeFile(file, config, 'utf8');

      expect(ourValues(config, key)).toStrictEqual(await gitValues(file, key));
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
