import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const SKILLS_REQUEST = 2;
const TIMEOUT = 30_000;
const run = async (command, args, options) => {
  const { stdout } = await exec(command, args, { ...options, timeout: TIMEOUT });
  return stdout;
};
const codex = async (args, options) => JSON.parse(await run('codex', args, options));

// Real client discovery, without a login, paid model call, or assumptions about cache traversal.
// eslint-disable-next-line promise/avoid-new -- adapts the real client stdout protocol
const discover = (options) => new Promise((resolve, reject) => {
  const child = spawn('codex', ['app-server', '--stdio'], { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  const timer = setTimeout(() => { reject(new Error('Codex skill discovery timed out')); child.kill(); }, TIMEOUT);
  child.stderr.resume();
  child.on('error', reject);
  child.on('exit', () => { clearTimeout(timer); reject(new Error('Codex exited before skill discovery')); });
  lines.on('line', (line) => handleResponse({ child, line, options, reject, resolve }));
  child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { capabilities: { experimentalApi: true }, clientInfo: { name: 'refs-plugin-smoke', version: '1.0.0' } } })}\n`);
});

const handleResponse = ({ child, line, options, reject, resolve }) => {
  const response = JSON.parse(line);
  if (response.error !== undefined) {
    reject(new Error(JSON.stringify(response.error)));
    child.kill();
  } else if (response.id === 1) {
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ id: SKILLS_REQUEST, method: 'skills/list', params: { cwds: [options.cwd], forceReload: true } })}\n`);
  } else if (response.id === SKILLS_REQUEST) {
    resolve(response.result.data[0]);
    child.kill();
  }
};

export { codex, discover, run };
