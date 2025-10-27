FROM node:20-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
ENV NODE_ENV=production \
    PORT=5000
COPY --from=builder /app/dist ./dist
EXPOSE 5000
CMD ["node", "dist/index.js"]


