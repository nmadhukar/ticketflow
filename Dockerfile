# Builder stage: Install all dependencies (including dev) and build
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies with better caching (copy package files first for layer caching)
COPY package.json package-lock.json ./
# Use npm ci for faster, reproducible installs (requires package-lock.json)
# --mount=type=cache improves build speed by caching npm cache
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev --no-audit --no-fund

# Copy source and build (this layer changes more often, so placed after dependency install)
COPY . .
# Don't set NODE_ENV=production in builder stage (can interfere with build tools)
RUN npm run build

# Migrate stage: For running database migrations (uses npx, no full install needed)
FROM node:20-alpine AS migrate
WORKDIR /app

# Copy only what's needed for migrations
COPY package.json package-lock.json ./
COPY drizzle.config.ts ./
COPY migrations/ ./migrations/
COPY shared/schema.ts ./shared/schema.ts

# Use npx to run drizzle-kit without installing all dev dependencies
# npx will download and cache drizzle-kit on first run
CMD ["npx", "drizzle-kit", "migrate"]

# Runtime stage: Only production dependencies
FROM node:20-alpine AS runtime
WORKDIR /app

# Install only production dependencies with caching
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Runtime environment
ENV NODE_ENV=production \
    PORT=5000

EXPOSE 5000
CMD ["node", "dist/index.js"]


