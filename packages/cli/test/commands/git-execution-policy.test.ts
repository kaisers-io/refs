import { describe, expect, it, onTestFinished } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { SLOW_IO_TIMEOUT_MS } from '../helpers/timeouts.ts';
import { cliBundle } from '../helpers/printed-command.ts';
import { createFixtureRepo } from '../helpers/fixture-repo.ts';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const BIN = join(import.meta.dirname, '../../bin/refs.mjs');
const ENCODING = 'utf8';

const setup = async () => {
  await cliBundle();
  const root = await mkdtemp(join(tmpdir(), 'refs-cli-execution-policy-'));
  const source = await createFixtureRepo();
  onTestFinished(async () => {
    await Promise.all([root, source.dir].map((path) => rm(path, { force: true, recursive: true })));
  });
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(root, 'config'),
    GIT_CONFIG_NOSYSTEM: '1',
    REFS_ALLOW_FILE_URLS: '1',
    REFS_HOME: join(root, 'home'),
    REFS_UPDATE_CHECK: '0',
  };
  return { env, marker: join(root, 'marker'), root, source };
};

type Fixture = Awaited<ReturnType<typeof setup>>;

const trackedFilter = async (fixture: Fixture): Promise<void> => {
  await writeFile(
    join(fixture.source.dir, 'a-filter.mjs'),
    `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(fixture.marker)}, 'ran'); ` +
      'process.stdout.write(fs.readFileSync(0));\n',
  );
  await writeFile(join(fixture.source.dir, '.gitattributes'), '* -text\nz-target filter=fixture\n');
  await writeFile(join(fixture.source.dir, 'z-target'), 'source bytes\n');
  await exec('git', ['add', '-A'], { cwd: fixture.source.dir });
  await exec('git', ['commit', '-q', '-m', 'fixture filter'], { cwd: fixture.source.dir });
  await exec('git', [
    'config',
    '--file',
    fixture.env.GIT_CONFIG_GLOBAL,
    'filter.fixture.smudge',
    `"${process.execPath.replaceAll('\\', '/')}" a-filter.mjs`,
  ]);
};

const positiveControl = async (fixture: Fixture): Promise<void> => {
  await exec('git', ['clone', '-q', fixture.source.url, join(fixture.root, 'control')], {
    env: fixture.env,
  });
  await expect(readFile(fixture.marker, ENCODING)).resolves.toContain('ran');
  await rm(fixture.marker);
};

describe('built CLI execution policy', () => {
  it(
    'refuses an attribute-selected tracked program before registration',
    async () => {
      expect.hasAssertions();
      const fixture = await setup();
      await trackedFilter(fixture);
      await positiveControl(fixture);
      await exec(process.execPath, [BIN, 'init', '--json'], { env: fixture.env });
      await expect(
        exec(
          process.execPath,
          [BIN, 'add', fixture.source.url, '--description', 'A reference to inspect.', '--json'],
          { env: fixture.env },
        ),
      ).rejects.toMatchObject({ stderr: expect.stringContaining('filter') });
      await expect(readFile(fixture.marker)).rejects.toMatchObject({ code: 'ENOENT' });
      const listed = await exec(process.execPath, [BIN, 'list', '--json'], { env: fixture.env });
      expect(JSON.parse(listed.stdout)).toMatchObject({ data: [], ok: true });
    },
    SLOW_IO_TIMEOUT_MS,
  );
});
