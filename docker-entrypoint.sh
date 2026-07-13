#!/bin/sh
# Container entrypoint: ensure the Postgres schema exists (prisma db push),
# seed it from the workbook only when empty (so runtime data survives restarts),
# then start the API. DATABASE_URL points at the Azure Postgres Flexible Server.
set -e

echo "[entrypoint] Applying database schema (prisma db push)..."
npx prisma db push --skip-generate

echo "[entrypoint] Seeding database if empty..."
npx tsx scripts/ensureSeed.ts

echo "[entrypoint] Starting API..."
exec npx tsx apps/api/src/server.ts
