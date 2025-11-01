# Builder stage: Install all dependencies (including dev) and build
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies (including dev dependencies for build tools)
# Explicitly copy both package files to ensure lock file is included
COPY package.json package-lock.json* ./
RUN npm install --include=dev --no-audit --no-fund

# Copy source and build
COPY . .
ENV NODE_ENV=production
RUN npm run build

# Migrate stage: For running database migrations
FROM node:20-alpine AS migrate
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
# Install all dependencies including dev (needed for drizzle-kit)
RUN npm install --include=dev --no-audit --no-fund

# Copy source files (migrations, drizzle.config.ts, etc.)
COPY . .

# Default command (can be overridden in docker-compose)
CMD ["npm", "run", "db:migrate"]

# Runtime stage: Only production dependencies
FROM node:20-alpine AS runtime
WORKDIR /app

# Install only production dependencies
# Explicitly copy both package files to ensure lock file is included
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Runtime environment
ENV NODE_ENV=production \
    PORT=5000

EXPOSE 5000
CMD ["node", "dist/index.js"]


