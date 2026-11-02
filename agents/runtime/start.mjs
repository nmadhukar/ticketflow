/**
 * Production entry point of the assistant sidecar.
 *
 * The container always runs; the assistant is switched on with ASSISTANT_ENABLED=true, the same
 * switch the app reads. Switched off, the sidecar only answers its health check and holds no model
 * access. Switched on, it starts the built Mastra server, which refuses to start, and so exits, on
 * invalid settings (src/mastra/startup-check.ts).
 *
 * Built-ins only: this file is copied next to `mastra build`'s output.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function assistantMode(env = process.env) {
  return env.ASSISTANT_ENABLED === 'true' ? 'serve' : 'standby';
}

export function startStandbyServer({ port = 4111, host = '0.0.0.0' } = {}) {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    // Alive (/health 200) but never ready (/ready 503): nothing is served here.
    const probe = req.method === 'GET' && (path === '/health' || path === '/ready');
    res.writeHead(probe && path === '/health' ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(probe ? { status: 'standby', assistant: 'disabled' } : { error: 'The assistant is not enabled.' }));
  });
  server.listen(port, host);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (assistantMode() === 'serve') {
    // A configuration error is thrown while this loads, which exits the process.
    await import('./index.mjs');
  } else {
    startStandbyServer({ host: process.env.MASTRA_HOST || '0.0.0.0' });
    console.log('[ticketflow-agents] Assistant not enabled (ASSISTANT_ENABLED is not "true"); running in standby.');
  }
}
