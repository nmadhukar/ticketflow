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

# 3) Run the server bundle. This CMD alone runs NEITHER `npm run db:migrate-sql` NOR
#    `npm run db:push`; the schema check then refuses to boot on an unmigrated database.
#    docker-compose.yml overrides the command to do the schema steps first:
#    `npm run db:migrate-sql && npm run db:push && node dist/index.js`. Deploy with the compose file.
EXPOSE 5000
CMD ["node", "dist/index.js"]
