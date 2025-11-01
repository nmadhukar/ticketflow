# Builder stage: Install all dependencies (including dev) and build
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies (copy package files first for better layer caching)
COPY package.json package-lock.json ./
RUN npm install --include=dev --no-audit --no-fund --prefer-offline

# Copy source and build
COPY . .
RUN npm run build

# Runtime stage: Only production dependencies
FROM node:20-alpine AS runtime
WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund --prefer-offline && \
    npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Runtime environment
ENV NODE_ENV=production \
    PORT=5000

EXPOSE 5000
CMD ["node", "dist/index.js"]


