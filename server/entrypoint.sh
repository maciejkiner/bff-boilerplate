#!/bin/sh
set -e

echo "[entrypoint] Syncing database schema..."
cd /app/server
if ! npx drizzle-kit push --force; then
  echo "[entrypoint] ERROR: schema sync failed. Server will not start."
  exit 1
fi
echo "[entrypoint] Schema sync complete."

echo "[entrypoint] Starting server..."
exec node dist/index.js
