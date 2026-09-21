#!/bin/sh
# ── Configure .env for the Vital Postgres service (idempotent) ───────────────
#
#   npm run db:init
#   sh scripts/init-env.sh [path/to/.env]
#
# What it does, and only what it does:
#
#   1. creates `.env` from `.env.example` when there is none (a fresh clone);
#   2. generates a strong random database password THE FIRST TIME and appends it;
#   3. appends any missing VITAL_PG_* setting, with working defaults for a local
#      Docker stack;
#   4. prints which variables it added — and never the password itself.
#
# It never overwrites a value that is already set, so re-running it is a no-op
# and an existing password (a rotated one, a Kubernetes secret mounted as a
# file) is left exactly as it was. The database host default is 127.0.0.1 and
# the port default is 5433, NOT 5432: 5432 is used by another Postgres on this
# host and Vital must not collide with it.
#
# The generated password is written straight into the gitignored `.env` and is
# never echoed, logged, or passed on a command line.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${1:-"$ROOT/.env"}
EXAMPLE_FILE="$ROOT/.env.example"

say() { printf '%s\n' "$*"; }

# `has_key KEY` — true only for a live (uncommented) assignment.
has_key() {
  [ -f "$ENV_FILE" ] && grep -qE "^[[:space:]]*$1[[:space:]]*=" "$ENV_FILE"
}

# A URL-safe, 64-character hex secret. `openssl` first; a POSIX fallback keeps
# this working in a minimal image.
new_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -tx1 /dev/urandom | tr -d ' \n' | cut -c1-64
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$EXAMPLE_FILE" ]; then
    cp "$EXAMPLE_FILE" "$ENV_FILE"
    say "created $ENV_FILE from .env.example"
  else
    : >"$ENV_FILE"
    say "created an empty $ENV_FILE"
  fi
fi

ADDED=""

# `set_key KEY VALUE` — append to the managed block only when the key is absent.
set_key() {
  key=$1
  value=$2
  if has_key "$key"; then
    return 0
  fi
  printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  ADDED="$ADDED $key"
}

if ! grep -q "managed by scripts/init-env.sh" "$ENV_FILE" 2>/dev/null; then
  printf '\n# ── Vital Postgres (managed by scripts/init-env.sh; safe to re-run) ──\n' >>"$ENV_FILE"
fi

set_key VITAL_PG_HOST 127.0.0.1
set_key VITAL_PG_PORT 5433
set_key VITAL_PG_DATABASE vital
set_key VITAL_PG_USER vital
set_key VITAL_PG_PASSWORD "$(new_password)"
set_key VITAL_PG_SSL false

if [ -n "$ADDED" ]; then
  say "added to $ENV_FILE:$ADDED"
else
  say "$ENV_FILE already configures every VITAL_PG_* variable — nothing changed."
fi

say ""
say "The database password is in $ENV_FILE (gitignored). It is deliberately not printed here."
say "Next:  docker compose up -d --build     # starts vital-postgres (:5433) and the app (:8080)"
say "       npm run db:migrate                # from the host, when running the app outside Docker"
