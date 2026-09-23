# syntax=docker/dockerfile:1
#
# Vital — multi-stage production image.
# Stages run sequentially, so peak memory is bounded by the heaviest single
# stage (the builder). Every stage caps node's old-space heap so the build fits
# small hosts instead of being OOM-killed.

# ── deps: install exactly the locked dependency tree ──────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=1400
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── builder: compile the Next.js standalone bundle ────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=1400
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── runner: slim, non-root, no toolchain, no secrets ──────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=384 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Dedicated unprivileged account (uid/gid 1001).
RUN addgroup -g 1001 -S nodejs \
 && adduser -S -u 1001 -G nodejs nextjs

# Standalone output ships its own minimal node_modules and server.js.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# pdfjs-dist is a server-external package (it must not be bundled). Next's file
# tracer only reliably carries it once `outputFileTracingIncludes` names it, so
# copy the package explicitly as a second guarantee: without it the lab PDF
# parser throws MODULE_NOT_FOUND at runtime, on the first upload.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist

# ── migration step ───────────────────────────────────────────────────────────
# The container applies pending SQL migrations BEFORE it serves, so the image
# needs the migration CLI, the SQL it applies, and the two small modules it
# imports. `pg` arrives with the standalone node_modules because the app's own
# data layer imports it; the entrypoint verifies that at runtime and refuses to
# start the server if the migration step cannot complete.
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/db ./db
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/db ./src/lib/db
USER root
RUN chmod +x /app/scripts/docker-entrypoint.sh
USER nextjs

EXPOSE 3000

# Real probe against the app's own overview route (busybox wget ships with alpine).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

# Migrate, then serve. With no database configured the migration step is a no-op
# and the app runs on its JSON files exactly as before.
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "server.js"]
