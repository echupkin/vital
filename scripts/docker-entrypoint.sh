#!/bin/sh
# ── Vital container entrypoint ────────────────────────────────────────────────
#
# Migrate first, serve second. This wraps the existing standalone start
# (`node server.js`) rather than changing the app's request path: the server
# binary, the healthcheck and every route are untouched.
#
#   * no database configured   → the migration CLI prints one line and exits 0,
#                                and the app starts in file-backed mode;
#   * database configured      → migrations run to completion first;
#   * a migration fails, or the database is unreachable while configured → the
#     script does NOT start the server. Serving a half-migrated app (or one that
#     pretends a broken database is fine) is worse than a container that refuses
#     to start and says why in its log.
#
# `set -e` makes a non-zero exit from the migration CLI fatal here.

set -e

echo "[vital] entrypoint: applying database migrations (no-op when no database is configured)…"
if ! node scripts/migrate.mjs; then
  echo "[vital] FATAL: migrations did not complete; refusing to start the server. Fix the database and restart." >&2
  exit 1
fi

echo "[vital] entrypoint: starting the server."
exec node server.js
