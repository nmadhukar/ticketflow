## 1) Builder stage - produces ./dist (client + server bundle)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Build client (vite) and server bundle (esbuild)
ENV NODE_ENV=production
RUN npm run build

## 2) Runtime stage - installs deps (incl. dev) and runs the server bundle
FROM node:20-alpine AS runtime
WORKDIR /app
COPY package*.json ./
# Install with dev deps so dev-only imports (e.g., vite) resolve if referenced
RUN npm ci --include=dev
ENV NODE_ENV=production \
    PORT=5000
COPY --from=builder /app/dist ./dist
EXPOSE 5000
CMD ["node", "dist/index.js"]


