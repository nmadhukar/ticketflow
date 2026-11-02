# Assistant (Mastra) sidecar image, adapted from Workforce Nexus. Stages:
#   deps        npm ci + sources, shared by the others
#   build       `mastra build` (no Studio)
#   dev         local Studio (`mastra dev`)
#   production  the build output run with node; the default (last) stage
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --include=dev: the `mastra` CLI is a dev dependency, and a platform that sets
# NODE_ENV=production for every stage would otherwise skip it; `npx mastra build`
# would then fetch the newest CLI, bundling a @mastra/server the pinned core does not
# match (Workforce Nexus, 2026-10-28). package.json pins it through "overrides".
RUN npm ci --include=dev --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src

FROM deps AS build
# --no-install: use the lockfile's CLI or fail, never fetch the newest one.
RUN npx --no-install mastra build

FROM deps AS dev
RUN chown -R node:node /app
USER node
ENV MASTRA_HOST=0.0.0.0
ENV MASTRA_TELEMETRY_DISABLED=1
EXPOSE 4111
CMD ["npm", "run", "dev"]

FROM node:24-bookworm-slim AS production
WORKDIR /app
COPY --from=build --chown=node:node /app/.mastra/output ./
COPY --chown=node:node runtime/start.mjs ./start.mjs
# Fails the build when the bundled server imports a name the installed @mastra packages lack,
# so a bad image never replaces a running one. Run here, not in the build stage, where Node
# would also find the build tools' packages one folder up.
COPY scripts/check-bundle-imports.mjs /tmp/check-bundle-imports.mjs
RUN node /tmp/check-bundle-imports.mjs /app && rm /tmp/check-bundle-imports.mjs
USER node
ENV NODE_ENV=production
ENV MASTRA_HOST=0.0.0.0
ENV MASTRA_TELEMETRY_DISABLED=1
EXPOSE 4111
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4111/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Standby unless ASSISTANT_ENABLED=true; then the built server, which exits on invalid settings.
CMD ["node", "start.mjs"]
