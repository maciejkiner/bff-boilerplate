#!/bin/sh
set -e

echo "Waiting for database to be ready..."
echo "Syncing database schema..."
cd /app/server
npx drizzle-kit push --force

echo "Starting server..."
exec node dist/index.js
