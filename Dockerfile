# Ruling R35: Node 24 (package.json engines: node >=22.12; sanitize-html 2.18 needs it).
FROM node:24-alpine
WORKDIR /app

# 1) Install exactly the locked dependency tree. Dev dependencies are included on
#    purpose: vite/esbuild build the bundle, and drizzle-kit + pg run the schema
#    steps (npm run db:migrate-sql, npm run db:push) when the container starts.
#    NODE_ENV=production is set only after this, or npm would leave them out.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

# 2) Copy source and build (produces ./dist)
COPY . .
ENV NODE_ENV=production \
    PORT=5000
RUN npm run build

# 3) Apply the schema, then run the server bundle: the same three steps, in the same order, as
#    the `command:` in docker-compose.yml (R66; a unit test keeps the two identical). A
#    Dockerfile-only deploy (Coolify) therefore migrates too, and the R32 drift check still
#    applies: the hand-written idempotent migrations run first, then drizzle-kit push, and the
#    server refuses to boot if a required schema object is still missing. The last step is
#    `exec node ...` so node replaces the shell as PID 1 and receives SIGTERM from `docker stop`; server/shutdown.ts handles it.
EXPOSE 5000
CMD ["sh", "-c", "npm run db:migrate-sql && npm run db:push && exec node dist/index.js"]
