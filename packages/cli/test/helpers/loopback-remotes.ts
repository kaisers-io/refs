import type { AddressInfo, Server, Socket } from 'node:net';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { once } from 'node:events';
import { tmpdir } from 'node:os';

// Git remotes that nobody can finish talking to, on loopback: one that answers every request with
// 401 (git then wants credentials), and one that accepts connections and never says a word. A
// throwaway HOME routes an HTTPS-shaped url to either through `insteadOf`, so refs sees the shape of
// a real remote and nothing leaves the machine.

type LoopbackRemote = {
  port: number;
  close: () => void;
};

const UNAUTHORIZED = 401;
const REMOTE_BASE = 'https://refs-bounds.example.com/';

const listen = async (server: Server, close: () => void): Promise<LoopbackRemote> => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { close, port: (server.address() as AddressInfo).port };
};

/** A remote that wants credentials for everything. */
const unauthorizedRemote = (): Promise<LoopbackRemote> => {
  const server = createHttpServer((_req, res) => {
    res.writeHead(UNAUTHORIZED, { 'Content-Length': '0', 'WWW-Authenticate': 'Basic realm="x"' });
    res.end();
  });
  return listen(server, () => {
    server.close();
  });
};

/** A remote that accepts connections and never answers. Closing it drops the held sockets. */
const stalledRemote = (): Promise<LoopbackRemote> => {
  const held: Socket[] = [];
  const server = createServer((socket) => {
    held.push(socket);
  });
  return listen(server, () => {
    for (const socket of held) {
      socket.destroy();
    }
    server.close();
  });
};

/** A fresh HOME whose git config sends `REMOTE_BASE` to the loopback remote on `port`. */
const homeRoutingTo = async (port: number): Promise<string> => {
  const home = await mkdtemp(join(tmpdir(), 'refs-bounds-home-'));
  const rule = `[url "http://127.0.0.1:${String(port)}/"]\n\tinsteadOf = ${REMOTE_BASE}\n`;
  await writeFile(join(home, '.gitconfig'), rule);
  return home;
};

export { REMOTE_BASE, homeRoutingTo, stalledRemote, unauthorizedRemote };
export type { LoopbackRemote };
