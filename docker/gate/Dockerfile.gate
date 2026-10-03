FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# Install pg for local postgres (replaces @neondatabase/serverless)
RUN npm install pg @types/pg

# Copy the local-db adapter that replaces server/db.ts
COPY docker/db.ts /app/server/db.ts

# Copy everything else
COPY . .

# Overwrite again just in case (COPY . . might overwrite)
COPY docker/db.ts /app/server/db.ts

# Default command
CMD ["npx", "tsx", "server/index.ts"]
