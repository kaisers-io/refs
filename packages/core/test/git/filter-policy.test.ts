import { cloneRepo, syncRef } from '../../src/git/repo.ts';
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const runner = new SpawnRunner();
const ENCODING = 'utf8';

type Fixture = Awaited<ReturnType<typeof fixture>>;

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'refs-filter-policy-'));
  const source = await createFixtureRepo();
  const marker = join(root, 'marker');
  await writeFile(
    join(source.dir, 'a-filter.mjs'),
    `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(marker)}, 'ran'); ` +
      'process.stdout.write(fs.readFileSync(0));\n',
  );
  await writeFile(join(source.dir, 'z-target.txt'), 'unchanged source bytes\n');
  await commit(source.dir);
  return { config: join(root, 'config'), dest: join(root, 'checkout'), marker, root, source };
};

const commit = async (dir: string): Promise<void> => {
  await exec('git', ['add', '-A'], { cwd: dir });
  await exec('git', ['commit', '-q', '-m', 'fixture content'], { cwd: dir });
};

const selectFilter = async (dir: string, label = 'fixture'): Promise<void> => {
  await writeFile(join(dir, '.gitattributes'), `* -text\nz-target.txt filter=${label}\n`);
  await writeFile(join(dir, 'z-target.txt'), 'updated source bytes\n');
  await commit(dir);
};

const configureFilter = async (setup: Fixture, label = 'fixture'): Promise<void> => {
  const command = `"${process.execPath.replaceAll('\\', '/')}" a-filter.mjs`;
  await exec('git', ['config', '--file', setup.config, `filter.${label}.smudge`, command]);
  await exec('git', ['config', '--file', setup.config, `filter.${label}.clean`, command]);
  vi.stubEnv('GIT_CONFIG_GLOBAL', setup.config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
};

const cleanup = async (setup: Fixture): Promise<void> => {
  vi.unstubAllEnvs();
  await Promise.all(
    [setup.root, setup.source.dir].map((path) => rm(path, { force: true, recursive: true })),
  );
};

const clone = (setup: Fixture) =>
  cloneRepo(runner, {
    cloneUrl: setup.source.url,
    dest: setup.dest,
    hooksDir: join(setup.root, 'hooks'),
    mode: 'full',
  });

const positiveControl = async (setup: Fixture): Promise<void> => {
  await exec('git', ['clone', '-q', setup.source.url, join(setup.root, 'control')]);
  await expect(readFile(setup.marker, ENCODING)).resolves.toContain('ran');
  await rm(setup.marker);
};

describe('content filters cannot execute reference source', () => {
  it(
    'keeps unrelated clones working with an ambient filter installed',
    async () => {
      expect.hasAssertions();
      const setup = await fixture();
      try {
        await configureFilter(setup);
        await expect(clone(setup)).resolves.toStrictEqual({ effectiveMode: 'full' });
        await expect(readFile(join(setup.dest, 'z-target.txt'), ENCODING)).resolves.toBe(
          'unchanged source bytes\n',
        );
        await expect(readFile(setup.marker)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await cleanup(setup);
      }
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it.each(['fixture', ''])(
    'refuses selected filter %s instead of executing it or silently changing content',
    async (label) => {
      expect.hasAssertions();
      const setup = await fixture();
      try {
        await selectFilter(setup.source.dir, label);
        await configureFilter(setup, label);
        await positiveControl(setup);
        await expect(clone(setup)).rejects.toThrow(/filter.*failed/u);
        await expect(readFile(setup.marker)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await cleanup(setup);
      }
    },
    SLOW_IO_TIMEOUT_MS,
  );
});

describe('content filters during sync', () => {
  it(
    'enforces the same filter policy when source arrives in a later sync',
    async () => {
      expect.hasAssertions();
      const setup = await fixture();
      try {
        await clone(setup);
        await selectFilter(setup.source.dir);
        await configureFilter(setup);
        await expect(
          syncRef(runner, {
            defaultBranch: 'main',
            dir: setup.dest,
            hooksDir: join(setup.root, 'hooks'),
          }),
        ).rejects.toThrow(/filter.*failed/u);
        await expect(readFile(setup.marker)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await cleanup(setup);
      }
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
