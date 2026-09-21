#!/usr/bin/env bash
# Rebuild and restart the Vital stack, then wait for the healthcheck.
set -euo pipefail
# Run from the repository root, wherever it happens to live on this machine.
cd "$(dirname -- "$0")/.."
docker compose up -d --build
echo "--- waiting for healthy ---"
for i in $(seq 1 60); do
  status=$(docker inspect --format '{{.State.Health.Status}}' vital-vital-1 2>/dev/null || echo unknown)
  echo "attempt $i: $status"
  if [ "$status" = "healthy" ]; then
    break
  fi
  sleep 5
done
docker compose ps
