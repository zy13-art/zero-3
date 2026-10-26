import { createServer } from 'node:net';

// A named pipe is owned by the OS, so a terminated launcher leaves no stale lock.
// The pipe accepts no commands or payloads; listening only provides exclusivity.
export async function runWithLaunchLease(lockName, action) {
  const server = createServer(socket => socket.destroy());
  const acquired = await new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener('listening', onListening);
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ path: lockName, exclusive: true });
  });
  if (!acquired) return { acquired: false };
  try {
    return { acquired: true, value: await action() };
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
