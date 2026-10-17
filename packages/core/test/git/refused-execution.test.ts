import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { SpawnRunner } from '../../src/proc/runner.ts';
import { cloneRepo } from '../../src/git/repo.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ENCODING = 'utf8';
const REFUSAL = /refusing Git operation.*unsupported/u;
const EXECUTION_SETTINGS = [
  'core.alternateRefsCommand',
  'remote.origin.uploadpack',
  'remote.origin.vcs',
  'uploadpack.packObjectsHook',
];

const scenario = async () => {
  const source = await createFixtureRepo();
  const root = await mkdtemp(join(source.dir, '..', 'refs-exec-refusal-'));
  const config = join(root, 'config');
  return { config, dest: join(root, 'checkout'), root, source };
};

type Scenario = Awaited<ReturnType<typeof scenario>>;

const setConfig = async (setup: Scenario, key: string, value: string): Promise<void> => {
  await exec('git', ['config', '--file', setup.config, key, value]);
  vi.stubEnv('GIT_CONFIG_GLOBAL', setup.config);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
};

const clone = (setup: Scenario) =>
  cloneRepo(new SpawnRunner(), {
    cloneUrl: setup.source.url,
    dest: setup.dest,
    hooksDir: join(setup.root, 'hooks'),
    mode: 'full',
  });

const cleanup = async (setup: Scenario): Promise<void> => {
  vi.unstubAllEnvs();
  await Promise.all(
    [setup.root, setup.source.dir].map((path) => rm(path, { force: true, recursive: true })),
  );
};

describe('unsupported Git execution settings fail closed', () => {
  it.each(
    EXECUTION_SETTINGS.flatMap((key) => [
      { key, value: './untrusted-reference-program' },
      { key, value: '' },
    ]),
  )(
    'refuses $key=$value before starting the clone',
    async ({ key, value }) => {
      expect.hasAssertions();
      const setup = await scenario();
      try {
        await setConfig(setup, key, value);
        await expect(clone(setup)).rejects.toThrow(REFUSAL);
        await expect(readFile(join(setup.dest, '.git', 'config'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } finally {
        await cleanup(setup);
      }
    },
    SLOW_IO_TIMEOUT_MS,
  );

  it('refuses custom transports selected by a URL rewrite', async () => {
    expect.hasAssertions();
    const setup = await scenario();
    try {
      await setConfig(setup, 'url.ext::untrusted-command.insteadOf', setup.source.url);
      await expect(clone(setup)).rejects.toThrow(/transport 'ext' not allowed/u);
    } finally {
      await cleanup(setup);
    }
  });
});

const commit = async (dir: string): Promise<void> => {
  await exec('git', ['add', '-A'], { cwd: dir });
  await exec('git', ['commit', '-q', '-m', 'fixture filter'], { cwd: dir });
};

const controlClone = async (setup: Scenario, marker: string): Promise<void> => {
  await exec('git', ['clone', '-q', setup.source.url, join(setup.root, 'control')]);
  await expect(readFile(marker, ENCODING)).resolves.toContain('ran');
  await rm(marker);
};

const templateFilter = async (setup: Scenario): Promise<string> => {
  const template = join(setup.root, 'template');
  const marker = join(setup.root, 'marker');
  await mkdir(template);
  await writeFile(
    join(setup.source.dir, 'a-filter.mjs'),
    `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(marker)}, 'ran'); ` +
      'process.stdout.write(fs.readFileSync(0));\n',
  );
  await writeFile(join(setup.source.dir, 'z-target.txt'), 'source bytes\n');
  await writeFile(
    join(setup.source.dir, '.gitattributes'),
    '* -text\nz-target.txt filter=fixture\n',
  );
  await commit(setup.source.dir);
  await exec('git', [
    'config',
    '--file',
    join(template, 'config'),
    'filter.fixture.smudge',
    `"${process.execPath.replaceAll('\\', '/')}" a-filter.mjs`,
  ]);
  vi.stubEnv('GIT_TEMPLATE_DIR', template);
  return marker;
};

describe('clone templates cannot introduce uninspected commands', () => {
  it(
    'ignores template config before initialization or materialization',
    async () => {
      expect.hasAssertions();
      const setup = await scenario();
      try {
        const marker = await templateFilter(setup);
        await controlClone(setup, marker);
        await expect(clone(setup)).resolves.toStrictEqual({ effectiveMode: 'full' });
        await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(join(setup.dest, 'z-target.txt'), ENCODING)).resolves.toBe(
          'source bytes\n',
        );
      } finally {
        await cleanup(setup);
      }
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
