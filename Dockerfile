FROM node:20-alpine
WORKDIR /app

# 1) Install ALL dependencies (including dev) for building and runtime
COPY package*.json ./
RUN npm install --include=dev --no-audit --no-fund

# 2) Copy source and build (produces ./dist)
COPY . .
ENV NODE_ENV=production \
    PORT=5000
RUN npm run build

# 4) Run the server bundle
EXPOSE 5000
CMD ["node", "dist/index.js"]


