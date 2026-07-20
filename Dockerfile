# MSX Milestone Assistant API — container image for Azure Container Apps.
# Runs the Express API with tsx (matching dev) so the @msx/shared workspace
# (which resolves to TypeScript source) loads without a separate build step.
# SQLite lives on a mounted volume at /data (DATABASE_URL=file:/data/dev.db).
FROM node:20-bookworm-slim

WORKDIR /app

# Prisma needs OpenSSL at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies (npm workspaces). node_modules is .dockerignore'd so the
# Linux-native Prisma engine and binaries are installed fresh in the image.
# CACHEBUST forces the source COPY (and everything after) to rebuild when passed
# a new value via --build-arg, avoiding stale cached source layers.
ARG CACHEBUST=0
COPY . .
RUN npm ci

# Generate the Prisma client for the container platform.
RUN npx prisma generate

ENV NODE_ENV=production
ENV PORT=4000
# DATABASE_URL is supplied at runtime by the Container App (Postgres connection
# string, stored as the "database-url" secret).

EXPOSE 4000

# Normalize line endings (a Windows checkout may give the script CRLF, which makes
# the kernel look for interpreter "/bin/sh\r" -> "no such file or directory") and
# mark it executable.
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh
ENTRYPOINT ["/app/docker-entrypoint.sh"]
