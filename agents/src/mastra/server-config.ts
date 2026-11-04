import { registerApiRoute } from '@mastra/core/server';
import { createAssistantAuth } from './auth.ts';
import { assistantReadiness } from './readiness.ts';

/** Options for the Mastra HTTP server; kept apart from index.ts so tests can read them. */
export function createServerConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    // 0.0.0.0 inside the container (Dockerfile); the port is never published.
    host: env.MASTRA_HOST || '127.0.0.1',
    studioHost: 'localhost',
    studioProtocol: 'http' as const,
    port: 4111,
    auth: createAssistantAuth(env),
    // The app calls this service server to server and Studio is served from its own origin, so
    // no cross-origin browser request is answered. With auth and no cors option Mastra would
    // reflect any Origin with credentials.
    cors: false as const,
    apiRoutes: [
      // Readiness, beside Mastra's own /health (liveness). Status and setting names only.
      registerApiRoute('/ready', {
        method: 'GET',
        requiresAuth: false,
        handler: async (c) => {
          const readiness = await assistantReadiness(env);
          return c.json(readiness, readiness.status === 'ready' ? 200 : 503);
        },
      }),
    ],
  };
}
