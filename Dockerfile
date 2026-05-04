# ── Stage 1: build ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm ci --workspaces --ignore-scripts

COPY server/src ./server/src
COPY server/tsconfig.json ./server/tsconfig.json
COPY client/src ./client/src
COPY client/tsconfig.json ./client/tsconfig.json
RUN npm run build -w server && npm run build -w client

# ── Stage 2: runtime ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

COPY server/entrypoint.sh ./server/entrypoint.sh
RUN chmod +x ./server/entrypoint.sh

EXPOSE 3000
CMD ["./server/entrypoint.sh"]
