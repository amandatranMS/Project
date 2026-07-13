#!/bin/sh
# Container entrypoint: ensure the SQLite schema exists on the mounted volume,
# seed it from the workbook only when empty (so runtime data survives restarts),
# then start the API.
set -e

mkdir -p /data

echo "[entrypoint] Applying database schema (prisma db push)..."
npx prisma db push --skip-generate

echo "[entrypoint] Seeding database if empty..."
npx tsx scripts/ensureSeed.ts

echo "[entrypoint] Starting API..."
exec npx tsx apps/api/src/server.ts
