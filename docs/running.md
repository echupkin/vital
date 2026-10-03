# Running Vital

Docker in detail, the database, local development and the published port.

[← Back to the README](../README.md)

---

# Docker quick start

Requires Docker with the Compose v2 plugin.

```bash
cd vital      # the directory containing docker-compose.yml
cp .env.example .env        # demo mode works with no values set
# for live data, set VITAL_DATA_MODE=live plus HAE_API_URL / HAE_API_KEY in .env
npm run db:init             # generates the Postgres password + settings into .env (once, idempotent)
docker compose up -d --build
```

That starts **two** services: `vital-postgres` (the database, published on
`127.0.0.1:5433` — *not* 5432, so it does not clash with a database already on the host) and `vital`
(the app on `:8080`). The app's entrypoint applies any pending migrations and **refuses to start
if they fail**, so it can never serve a half-migrated database.

What lives in Postgres: your configuration — the profile (name, date of birth, timezone, briefing
hour, notes) and the display preferences (theme mode and light/dark theme picks, units,
notifications). **No health data**: no
observations, metric series or workouts are ever written to it; health history stays with the
Health Auto Export source and is read server-side. See `db/migrations/0001-init.sql`.

With **no** database configured the app does **not** run: the container entrypoint refuses to
start and prints the reason, because this deployment stores its settings in Postgres and has no
file fallback. Settings follow you between browsers and devices, because the server owns them —
the browser keeps only a cache used to avoid a theme flash before first paint.

```bash
npm run db:migrate                    # apply migrations from the host (no-op when up to date)
docker compose exec vital-postgres psql -U vital -d vital -c '\dt'   # inspect the schema
docker compose down                   # stops containers; the named volume keeps the data
docker compose down -v                # the ONLY command that deletes the database
```

Then open **http://localhost:8080** (health: `docker compose ps` → `healthy`).

```bash
docker compose logs -f vital    # follow logs
docker compose down             # stop and remove the container
```

The image is built from `node:22-alpine` in three stages (`deps` → `builder` → `runner`);
the runtime stage contains only the Next.js standalone server bundle, runs as the
unprivileged user `nextjs` (uid 1001), needs no package manager, and carries no secrets.

---

# Local development (no Docker)

```bash
npm install
npm run seed    # regenerate src/data/health-fixtures.json (deterministic; already committed)
npm run dev     # http://localhost:3000
```

`npm run seed` is optional — the fixture file is committed, so a fresh clone runs without it.
Useful when developing without Docker because port 3000 is the app's normal dev port.

---

# Why port 8080, and how to change it

Vital listens on **3000 inside the container** (the Next.js standalone default) and is
published on **8080 on the host**. Port 3000 is the usual development port and is often taken by other tools, so 8080 avoids
clashing with them.

Change the published port with `VITAL_PORT` — either in `.env` or inline:

```bash
VITAL_PORT=9090 docker compose up -d
```

Only the host side moves; the container port stays 3000.

---

# Continuous integration and container images

`.github/workflows/ci.yml` runs the quality commands on every pull request and push. It then builds the image natively for `linux/amd64` and `linux/arm64` and smoke-tests each one: the container starts against a throwaway Postgres, applies the migrations and must answer `/api/health` and `/`. Pull requests stop there and push nothing.

Pushes to `main` and `v*` tags publish a multi-arch image to the GitHub Container Registry of the repository that runs the workflow, `ghcr.io/<owner>/<repo>`, using the built-in `GITHUB_TOKEN`:

| Event | Tags |
|-------|------|
| push to `main` | `main`, `sha-<short>` |
| tag `v1.2.3` | `1.2.3`, `1.2`, `latest`, `sha-<short>` |

A new GHCR package starts private. Make it public in the package settings, or give the runtime pull credentials.

To run the image outside Compose (on Kubernetes, for example), supply the same environment as the `vital` service in `docker-compose.yml`. At minimum that is `DATABASE_URL` or the `VITAL_PG_*` variables; without a database the container refuses to start. The image runs as uid/gid 1001 and listens on port 3000. Its Docker `HEALTHCHECK` is not used by Kubernetes, so point liveness and readiness probes at `GET /api/health`, which touches no database, model or data source.
