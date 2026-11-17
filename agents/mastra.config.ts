import { defineConfig } from 'mastra';

/**
 * Local Studio only. `mastra dev` is what serves Studio at http://localhost:4111, and it binds
 * 127.0.0.1 by default: inside a Docker container that address is the container itself, so the
 * port mapping publishes nothing and the browser gets ERR_CONNECTION_REFUSED. Binding 0.0.0.0
 * inside the container is safe for local development (the same setting the Dockerfile's
 * production stage already uses). Set MASTRA_HOST to override.
 */
const host = process.env.MASTRA_HOST?.trim() || '0.0.0.0';

export default defineConfig({
  server: {
    port: 4111,
    host,
  },
});
