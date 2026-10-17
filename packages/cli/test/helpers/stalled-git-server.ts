import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { once } from 'node:events';

// Responding 401 exercises Git's own credential path; hanging an accepted connection exercises
// its real HTTP transport. No external server, credentials, or shell helper is involved.
const AUTH_REQUIRED = 401;

const closeServer = async (server: Server): Promise<void> => {
  server.closeAllConnections();
  const closed = once(server, 'close');
  server.close();
  await closed;
};

const withGitServer = async (
  authenticate: boolean,
  exercise: (url: string) => Promise<void>,
): Promise<void> => {
  const server = createServer((_request, response) => {
    if (authenticate) {
      response.writeHead(AUTH_REQUIRED, { 'WWW-Authenticate': 'Basic realm="refs-test"' });
      response.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a loopback listening port');
  }
  try {
    await exercise(`http://127.0.0.1:${String(address.port)}/repo.git`);
  } finally {
    await closeServer(server);
  }
};

export { withGitServer };
