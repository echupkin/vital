# Vital — Health Intelligence Dashboard

Vital turns Apple Health history into a readable daily briefing: overview metrics, trend
analysis, sleep/activity/body/nutrition views, evidence-linked insights, and a question
console. It is a Next.js 15 (App Router, React 19, TypeScript) app styled with Tailwind CSS
3.4, charted with Recharts, deployed here as a single Docker container.

**Important:** the app runs in one of two data modes. `VITAL_DATA_MODE=live` reads a real
Health Auto Export history **server-side** (the browser never calls the health API and never
receives the token); `demo` serves the committed deterministic fixtures. The analyst is a
deterministic local engine until you configure a model provider — see *AI Analyst
configuration*. It is a personal dashboard for a trusted, private network — not a medical
device and not a HIPAA/production-hardened service. See *Data modes* and *Privacy and
security* below.

---

## Architecture

Vital is a **layered monolith**: one Next.js application serves both the UI and the HTTP API from a
single Node process. There is no separate backend service and no separate frontend build — one repo,
one build, one deployable.

```text
browser ──── HTTP ────┐
                      │   one container, one process (`next-server`)
  ┌───────────────────▼──────────────────────────────────────────┐
  │ src/app          12 page routes       7 API route handlers    │
  ├───────────────────────────────────────────────────────────────┤
  │ src/components   28 client components (charts, chat, forms)   │
  ├───────────────────────────────────────────────────────────────┤
  │ src/lib          adapters · analytics · metrics · briefing    │
  │                  analyst · db · prefs · profile · pipeline    │
  └───────────────────────────────────────────────────────────────┘
        │                    │                      │
   metrics API          PostgreSQL 16         model endpoints
   (pulled, cached      (config, profile,     (briefing: local-first;
    in the process)      preferences,          analyst: configured
                         conversations)        provider)
```

### The three surfaces

| Surface | Lives in | What it is |
|---|---|---|
| UI | `src/app/*/page.tsx` | 12 routes. Each page is a thin server file (metadata + a mounted component); interactivity lives in client components. |
| API | `src/app/api/**/route.ts` | 7 route handlers / 14 methods: analyst chat and its saved conversations, the daily briefing, pipeline status, preferences, profile. |
| Domain | `src/lib/**` | Every rule: source normalization, source de-duplication, day aggregation, the metric registry and its formatters, briefing generation, the analyst, persistence. |

Both surfaces call `src/lib` directly, in-process. Server-rendered pages do not make HTTP requests to
their own API, and the API is a thin surface over the same modules the pages use — so there is one
implementation of each rule rather than one per consumer. The API exists for the browser's
interactive work (sending a question, saving preferences, refreshing the briefing) and for anything
else that wants a machine-readable view of what the app shows.

### What runs inside the process

- **The health-data pipeline.** Health records are pulled from the metrics API server, normalized and
  de-duplicated, then aggregated per day and cached in the running process. The health API token never
  reaches the browser; the browser never calls the health API.
- **The daily briefing scheduler and its cache.** The briefing for a day is written once, at the
  configured hour, and cached in the process. A restart clears that cache, so the first request after a
  restart past the configured hour triggers a fresh write.
- **All model calls.** The briefing and the analyst both run server-side, which is why their keys are
  configuration the client never sees.

PostgreSQL holds configuration, profile, preferences and AI conversations. It deliberately holds **no
health data**.

### What this shape costs

- The API cannot be scaled, versioned or released independently of the UI: they ship as one image.
- Heavy work runs in the same process that serves pages. A briefing write can occupy a model call for
  a minute or more, and simultaneously occupies the web process.
- State that lives in the process — the health cache, the briefing cache, the scheduler timer — is
  per-process and per-container. Running two replicas without a shared store would give each replica its
  own copy and its own schedule.
- A crash or an out-of-memory event takes down the UI and the API together, because they are one
  process.

### If it ever needs to split

The seams are already the right shape for it: the API surface is separated from the domain modules, and
the domain modules are free of transport concerns. A split would mean a web/BFF process for the
rendered UI and the API, a worker process for asynchronous work (briefing writes, ingestion,
long-running model calls) driven by a durable queue, and a dedicated ingest endpoint — noting that
today the app only *pulls* from a metrics API and exposes no inbound write endpoint at all. That work
is only worth doing for multi-tenancy or for scaling ingest and model work independently of page
traffic; it is not a prerequisite for having an API, which this app already has.

---

## Data sources

**Vital supports exactly one data source today: Apple Health, via the Health Auto Export app for
iPhone, paired with a self-hosted metrics API server —
[HealthyApps/health-auto-export-server](https://github.com/HealthyApps/health-auto-export-server).**

The chain has three links, and Vital implements only the last one:

| Link | What it is | Provided by |
|------|-----------|-------------|
| iPhone | Apple Health records exported by the **Health Auto Export** app for iOS, on a schedule or on change | You (the app) |
| Metrics API server | [`HealthyApps/health-auto-export-server`](https://github.com/HealthyApps/health-auto-export-server) — a Node.js server that receives those exports, stores them, and exposes `GET /api/metrics/:metric` and `GET /api/workouts` | **Required** — paired with the app; it is the only thing Vital can read |
| Vital | Reads that server **server-side**, normalizes it into the internal dataset | This repository |

What that means in practice:

- **The metrics API server is not optional.** Apple Health has no public cloud API, a web app
  cannot read HealthKit, and the phone cannot be queried directly. Point `HAE_API_URL` at your
  `health-auto-export-server` instance and set `HAE_API_KEY` to its token, or run in `demo` mode.
- **No other source is supported, partially or otherwise.** There is no direct HealthKit or iCloud
  bridge; no Google Fit, Android or Samsung Health; no Garmin, Fitbit, Withings or Oura; no Apple
  Health `export.xml` upload and no CSV/JSON import. The adapter layer knows one wire protocol, and
  the pipeline panel lists only the stages this build can actually check.
- **Demo mode is not a source.** `VITAL_DATA_MODE=demo` serves the committed fixtures
  (`src/data/health-fixtures.json`) and is labelled as demo; it connects to nothing.
- **Adding a source means implementing its contract** under `src/lib/adapters/` (see
  *Integrations*): a module that knows the wire protocol, a mapping into the internal dataset
  shape, and a unit mapping. Nothing else in the app changes, because both modes produce the same
  dataset.

---

## Data modes

| Mode | Dataset | How it is read |
|------|---------|----------------|
| `demo` (default) | `src/data/health-fixtures.json` — deterministic, committed, 180 days | Imported in-process; the browser bundle already contains it |
| `live` | The real Health Auto Export history | Fetched and normalized **on the server**, cached in-process with a TTL + single-flight + stale-while-revalidate and warmed once at process start, then injected into the same internal dataset shape |

Switch modes with `VITAL_DATA_MODE` and restart the process: `live` reads the real history,
anything else (including unset, or `VITAL_DATA_MODE=demo`) serves the committed fixtures. In
`live` mode `HAE_API_URL` and `HAE_API_KEY` must both be set, or the app reports the live
source as unavailable instead of falling back. `HAE_CACHE_TTL_SECONDS` (default 300) is the
cache TTL in seconds; it does not control how often a page waits — see below.

Both modes produce the *same* internal dataset, so no page or component has to know which one
it is reading. In live mode:

- **The browser never talks to the health API.** All reads happen in server code, and
  `HAE_API_KEY` is read from the process environment only. The served client bundle contains
  neither the token nor any live health value (verified by grepping `.next/static/chunks`).
- **Every upstream request is windowed** (`from`/`to`, a rolling 400-day lookback) and reduced
  to **one value per day server-side**, so the heavy series (`heart_rate` 32k records,
  `basal_energy_burned` 66k, `active_energy` 39k) never reach a page in raw form.
- **One upstream pass per cache period, and no page waits on it.** `loadLiveDataset()` is
  wrapped in a TTL cache (`HAE_CACHE_TTL_SECONDS`, default 300) with single-flight, so
  concurrent page loads share a single fetch of ~194k upstream records → 1040 daily
  observations across 27 metrics. The cache is also warmed by one **read-only cache fill at
  process start** (`src/instrumentation.ts`), so the first request after a deploy or restart
  normally finds it already filled. Once the TTL lapses the held dataset is served **stale
  immediately** — stale-while-revalidate, single-flight, so N concurrent requests start
  exactly one background refresh — and only a genuinely cold process (no dataset cached at
  all) waits for upstream. Both are read-only cache fills: no ingestion job, no timer and no
  schedule exists, and nothing is persisted to disk.
- **Metric-specific aggregation, not one strategy for everything.** Steps, distance flights,
  exercise minutes, stand hours, active/basal energy, daylight and dietary totals are **summed
  per day**; resting HR, HRV, respiratory rate, SpO₂, wrist temperature and physical effort are
  **averaged per day**; weight, BMI, body fat and lean mass are **latest per day** (individual
  weigh-ins, never presented as daily observations); `heart_rate` is a daily **average** with
  daily max/min computed; `blood_pressure` keeps every reading as a systolic/diastolic pair;
  `sleep_analysis` composes one episode per night.
- **Source de-duplication.** The API returns overlapping device sources and composite values
  (`"Apple Watch|iPhone"`). Vital splits them, keeps **one device per metric per
  interval** using a stated priority (watch → phone, scale for body metrics, cuff for blood
  pressure), and sets the other device's records aside instead of adding them. On the current
  data this sets aside 111 records across 25 intervals; a blind sum would over-count steps by
  ~250/day.
- **A sleep record with no stage split is an in-bed-only record, not a night of zero sleep.**
  Some `sleep_analysis` records carry a valid in-bed window (`inBedStart`/`inBedEnd`) and
  `deep + core + rem == 0`. They are counted as nights, they count towards **time in bed** and
  towards coverage, and they are excluded from **every time-asleep figure** — mean, median, min,
  max, timeline, variability and comparison alike, on the Sleep page, the Overview card, the
  weekly "what changed" row, Insights, Trends and the analyst's context. A genuinely short night
  is still a night; only a record with no stage split drops out, and no split is ever invented
  for one (the stage chart draws it as a single neutral in-bed bar). The counts are stated on
  `/sleep`: *"N nights with a stage split of M records; K records carry only an in-bed window"*.
- **A repeated sleep export is one night.** An episode is identified by its in-bed window plus
  its recorded totals, not by the export `date` (the API has exported the same episode twice
  under two `date` values with an identical window and identical totals). Repeats collapse under
  the same source priority as every other metric; a record that shares a start instant but
  differs in window or totals is kept as a separate episode.
- **Unit conversion once, on the way in**: `lb → kg`, `mi → km`, `degF → degC`,
  `count/min → bpm|breaths/min`, `hr → min`. Round-trips are asserted in `units.test.ts`. The
  unit preference in `/settings` still converts for display only.
- **No silent fallback.** If the source cannot be read, the app renders an explicit connection
  error with retry and never substitutes demo data. The freshness badge shows the real
  data-as-of day derived from the newest observation.

---

## Docker quick start

Requires Docker with the Compose v2 plugin.

```bash
cd vital      # the directory containing docker-compose.yml
cp .env.example .env        # demo mode works with no values set
# for live data, set VITAL_DATA_MODE=live plus HAE_API_URL / HAE_API_KEY in .env
npm run db:init             # generates the Postgres password + settings into .env (once, idempotent)
docker compose up -d --build
```

That starts **two** services: `vital-postgres` (the database, published on
`127.0.0.1:5433` — *not* 5432, which another database on this host already owns) and `vital`
(the app on `:8080`). The app's entrypoint applies any pending migrations and **refuses to start
if they fail**, so it can never serve a half-migrated database.

What lives in Postgres: your configuration — the profile (name, date of birth, timezone, briefing
hour, notes) and the display preferences (theme, units, notifications). **No health data**: no
observations, metric series or workouts are ever written to it; health history stays with the
Health Auto Export source and is read server-side. See `db/migrations/0001-init.sql`.

With **no** database configured the app still runs, storing that configuration in `./data` on the
server instead. Settings follow you between browsers and devices either way, because the server
owns them — the browser keeps only a cache used to avoid a theme flash before first paint.

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

## Local development (no Docker)

```bash
npm install
npm run seed    # regenerate src/data/health-fixtures.json (deterministic; already committed)
npm run dev     # http://localhost:3000
```

`npm run seed` is optional — the fixture file is committed, so a fresh clone runs without it.
Useful when developing without Docker because port 3000 is the app's normal dev port.

## AI Analyst configuration

The analyst has **five configurable things**: provider, model, endpoint, credential and
system prompt. All five are read from the **server** environment, so none of them can reach
the browser bundle. With nothing configured it is the deterministic *Demo analyst* and the
feature works exactly as before.

### Providers

| `ANALYST_PROVIDER` | What it talks to | Default path | Credential header |
|---|---|---|---|
| `demo` (default) | nothing — deterministic handlers over the active dataset | — | — |
| `openai` | **any** OpenAI-compatible `POST /chat/completions`: OpenAI, OpenRouter, LM Studio, llama.cpp, vLLM, Ollama, Together, … | `/chat/completions` | `Authorization: Bearer` |
| `anthropic` | the Anthropic Messages API | `/v1/messages` | `x-api-key` |

`ANALYST_PROVIDER=openai` is deliberately generic: it is not tied to OpenAI. Any server that
speaks the OpenAI chat-completions shape works, which is what makes a local model usable.

### The five settings

| Variable | Meaning | Default |
|---|---|---|
| `ANALYST_PROVIDER` | `demo` \| `openai` \| `anthropic` | `demo` |
| `ANALYST_MODEL` | model id sent to the provider | none — **required** for a remote provider |
| `ANALYST_API_URL` | base URL *or* full endpoint; the provider's default path is appended when missing | none |
| `ANALYST_API_KEY` | credential — sent as `Authorization: Bearer` (openai) or `x-api-key` (anthropic) | none — **required** for non-loopback endpoints, optional for loopback |
| `ANALYST_SYSTEM_PROMPT` | inline system prompt, replacing the built-in one | the built-in analyst prompt |
| `ANALYST_SYSTEM_PROMPT_FILE` | path to a mounted `.md`/`.txt` prompt, re-read at request time when its mtime changes | none — **wins** over the inline value |

Plus request tuning: `ANALYST_MAX_TOKENS` (1200), `ANALYST_TEMPERATURE` (0.2),
`ANALYST_TIMEOUT_MS` (60000), `ANALYST_JSON_MODE` (`auto`).

Rules worth knowing:

- **Loopback endpoints need no key.** `127.0.0.1`, `localhost`, `[::1]` and
  `host.docker.internal` are treated as local: `ANALYST_API_KEY` becomes optional, so a local
  LM Studio just works. Every other host requires a key.
- **A configured provider is used directly.** There is no per-request prompt in front of the
  analyst in this single-user private deployment. `GET /api/analyst`, the Settings → AI
  privacy tab and the Analyst page state which provider, model and destination host handle a
  question.
- **`ANALYST_JSON_MODE=auto`** sends `response_format: {"type":"json_object"}` and retries
  once without it on HTTP 400, so servers that reject the field still work. Anthropic has no
  such field and never receives it.
- **Invalid configuration never crashes.** A bad URL, a missing model or a missing key for a
  non-loopback host is reported as *misconfigured* with the reason, in `/api/analyst` and on
  Settings → AI privacy. The analyst does not fall back to demo answers.

### Local model example (LM Studio on the host)

```bash
# .env — no key needed, because the endpoint is on this machine
ANALYST_PROVIDER=openai
ANALYST_MODEL=local-model
ANALYST_API_URL=http://host.docker.internal:1234/v1
```

`docker-compose.yml` sets `extra_hosts: ["host.docker.internal:host-gateway"]` so the
container can reach a model server running on the host. Ollama and llama.cpp expose the same
shape on their own ports (`.../v1`).

### Hosted provider example

```bash
ANALYST_PROVIDER=openai
ANALYST_MODEL=openai/gpt-4o-mini
ANALYST_API_URL=https://openrouter.ai/api/v1
ANALYST_API_KEY=…            # server-side only
```

### Custom system prompt

```bash
# the file wins over the inline value, and is re-read when it changes
ANALYST_SYSTEM_PROMPT_FILE=/app/config/analyst-prompt.md
```

`./config/analyst-prompt.md` is committed as a starting point and mounted read-only at
`/app/config`. Editing it customizes the analyst's instructions — no rebuild, no restart.
Keep its medical-boundary and grounding rules: the service validates the *shape* of a reply
and audits its numbers, but only the prompt can tell a model not to diagnose.

### What changes in the UI when a provider is configured

- The badge on `/analyst` stops saying *Demo analyst* and shows the provider and model
  (e.g. `OpenAI-compatible · gpt-4o-mini`). The key is never shown — only whether one is
  present.
- The context panel lists the destination host and the categories of data that are sent, and
  names the provider and model that handle the request.
- A question that is a genuine match for a supported question still uses that handler's
  bounded bundle (e.g. *How has my sleep changed over the last month?* retrieves only the
  sleep summary). Anything else — including a question that spans two topics, which the demo
  path's `/sleep/` catch-all used to capture — gets the bounded general bundle, so every part
  of the question is answerable from what was retrieved.
- Answers are still split into observed / interpretation / uncertainty, every evidence card
  still links to a real metric route, and the educational notice is unchanged. A new
  **grounding note** appears in amber when the model cited a figure that is not in the
  selected context — those figures are shown, never silently dropped.
- Settings → AI privacy reports provider, model, endpoint host, credential present/absent,
  prompt source and the reason when the configuration is invalid.

### The profile (Settings → Account)

Vital keeps one small record about the person, owned by the **server** and stored as JSON on a
writable volume:

| | |
|---|---|
| On the host | `./data/profile.json` |
| In the container | `/app/data/profile.json` (`docker-compose.yml` mounts `./data`) |
| Shape reference | `data/profile.example.json` |
| Route | `GET` / `PUT /api/profile` |

- **Fields, and only fields that are used.** `name` (the greeting and the briefing prose),
  `dateOfBirth` (the briefing receives the derived age), `notes` (free text for what the health
  report cannot contain — a training goal, a medication that affects heart rate), `timezone` and
  `briefingHour`. There is no dead field and no secret field.
- **Validated and bounded server-side.** Unknown fields are rejected rather than dropped; every
  type is checked; `name` is capped at 80 characters and `notes` at 500; `timezone` must be a real
  IANA zone and `briefingHour` a whole hour 0–23. A rejected body changes nothing on disk. The
  response body *is* the profile and nothing else.
- **First-run behaviour is explicit.** No file at all means the documented defaults and nothing
  crashes. A corrupt or hand-edited file also falls back to the defaults and reports why, rather
  than 500-ing the app.
- **One timezone.** `timezone` used to be a `localStorage` preference as well, which meant the
  browser and the server could disagree about what day it was. That duplicate has been removed:
  the profile's timezone is now the only one, and it drives both the client's window labelling
  (`useUnits().timezone`) and the server's day boundaries and briefing day.
- **Notes are data, never instructions.** The briefing prompt states it where every other rule
  lives, and the user message repeats it: a note that reads like a command is not followed.
- **Nothing else is stored locally.** Theme, units and the notification flags stay in
  `localStorage`; no API key, token or health record does — and the timezone no longer does either.
  The live profile file is gitignored and excluded from the Docker build context.

### The daily briefing on `/`

The Overview hero (*"Today's briefing"*) is written by the same provider stack described above —
there is no second configuration. It receives only computed summaries (latest value, 7-day mean vs
the preceding 7 days, previous 30-day baseline, coverage, and explicit missing-data notes), never raw
records, and the request is bounded.

- **Attribution is always shown.** `Written by <model>` means a model wrote that text;
  `Computed from your data — analyst model offline` means the deterministic rule-written summary is
  being shown because no model answered. The two are never mixed.
- **Numbers are audited before display.** Every numeral in the generated prose must be traceable to
  the supplied context; if one is not, the model text is discarded and the computed summary is shown
  instead (*fail closed*). Fabricated figures are never published.
- **One briefing per local calendar day.** The cache key is
  `briefing:v<contextVersion>:<local day>:<profile fingerprint>:<unit system>` — no dataset identity.
  New observations arriving during the day do **not** regenerate a briefing already written for that
  day: it describes the last seven days against the seven before them and the previous month, none
  of which changes within a day. There is no cache TTL to tune any more, because the day key is the
  authority (the TTL knob was removed rather than left doing nothing).
- **The briefing hour is configurable.** A new day's briefing is written lazily, by the first request
  at or after the profile's `briefingHour` (Settings → Account, default 06:00) — there is no
  scheduler and no background job; a lazy read-through fill is not a job. The boot warm-up primes
  only when that hour has already passed and the day is not yet cached.
- **Before the hour, the previous day stays on screen.** The hero is labelled with the day it covers
  (`Briefing for Sep 17`) and the generation time, so it is never blank and never claims to be a day
  it is not.
- **`Regenerate` is the one explicit control.** It replaces the current day's briefing once, from the
  hero, so a failed or unwanted day is not stuck until tomorrow. It says what it does and never
  loops. If the model cannot be reached the computed briefing stays, with the reason, and no
  per-request model calls are made (one generation is suppressed for 15 minutes after a failure).
- **The page never waits on the model.** The hero renders the computed briefing in the SSR HTML and
  swaps in the written one when the background read returns it.
- **The profile feeds the prompt.** Name, an age derived from the date of birth, and the free-text
  note are sent as a `profile` block — explicitly labelled in the prompt as the person's own data,
  never as instructions. The note is untrusted data in the same way imported content is.
- **Preferring a local model for the briefing only.** When `VITAL_LLM_BASE_URL` is set *and*
  reachable, the briefing uses it instead of the analyst provider; if it is unset or unreachable the
  briefing falls back to the `ANALYST_*` provider. `VITAL_LLM_MODEL=auto` resolves to the first model
  id the local server advertises. A local server on the host is reachable as `host.docker.internal`
  (`extra_hosts` is already set in `docker-compose.yml`); `VITAL_LLM_API_KEY` is optional for a
  loopback/LAN server. This switch affects the briefing only — the analyst keeps using `ANALYST_*`.

### Safety properties of the live path

- The provider returns **text**; the server parses it (tolerantly, through fences and prose),
  validates every field, caps every string and array, drops empty sections, and drops evidence
  whose metric is not in the registry *and* in the retrieved bundle.
- Every metric in the retrieved context carries a `display` block: the same figures formatted
  by the metric's own registry formatter and unit (`7h 32m`, `+17.1%`, `120 mg`), with the unit
  label, the display name and the window range in plain language. The prompt tells the model to
  quote those strings verbatim and state the unit, and the raw numbers travel alongside them for
  the audit only.
- Numeric claims in `observed`/`interpretation` are matched against the numbers actually in
  the bundle (formatting differences such as `7h 42m` for 462 minutes are accepted), against
  the `display` strings the model was given, and against the numbers those strings state
  (`7h 32m` ⇒ 452). Any unmatched token is reported on the response and in the UI.
- Errors are scrubbed: no credential value, no credential-bearing URL, and upstream bodies are
  truncated to a short excerpt.
- A provider failure returns `status: "error"` with an honest message. Canned text is never
  presented as a model reply, and the analyst never silently falls back to demo output.

## Why port 8080, and how to change it

Vital listens on **3000 inside the container** (the Next.js standalone default) and is
published on **8080 on the host**. On this machine 3000 (Grafana), 3001 (Health Auto Export
API), 27017 (MongoDB) and 8000 are already taken, so 8080 avoids touching those services.

Change the published port with `VITAL_PORT` — either in `.env` or inline:

```bash
VITAL_PORT=9090 docker compose up -d
```

Only the host side moves; the container port stays 3000.

## Quality commands

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run lint` | ESLint (`next lint`) |
| `npm run test` | Vitest suite |
| `npm run build` | Production build (standalone output) |

## Routes

| Route | Page |
|-------|------|
| `/` | Overview — daily briefing |
| `/trends` | Trend analysis |
| `/health` | Cardiovascular and health summary |
| `/activity` | Activity, steps, exercise |
| `/sleep` | Sleep analysis |
| `/body` | Body metrics |
| `/nutrition` | Dietary intake |
| `/workouts` | Workout history |
| `/insights` | Discovered patterns |
| `/analyst` | Question console (demo analyst or configured provider) |
| `/settings` | Preferences, the profile (Account tab), coverage and connections |
| `/metric/[metricId]` | Metric detail |
| `/api/pipeline/status` | Pipeline status report (server-side) |
| `/api/analyst` | Analyst provider state and questions (server-side) |
| `/api/profile` | The profile: `GET`, and `PUT` to replace it (validated, server-side) |
| `/api/briefing` | Today's briefing: `GET` reads it, `POST` regenerates the current day's once |

---

## Demo-only

What is still demo or unwired in this build, exhaustively:

- **Demo mode reads committed fixtures**, `src/data/health-fixtures.json`, generated
  deterministically by `scripts/seed.mjs` (fixed PRNG seed, 180 days ending on the dataset's
  reference date). Demo mode remains the default and is unchanged by the live integration.
- **The analyst runs in one of two modes**, decided by `ANALYST_PROVIDER`:
  - **Demo (default, and the state this checkout ships in).** `demo`/unset means no provider,
    no credential and nothing sent anywhere. Answers come from fixed local handlers over the
    active dataset, labelled "Demo analyst", and anything outside the supported question list
    is refused rather than guessed at.
  - **Live (configured).** `openai` or `anthropic` sends the question plus a bounded selection
    of the dataset to the endpoint you configure, and the model's reply is parsed, validated
    and grounding-checked server-side before it is shown. See *AI Analyst configuration*. A
    provider that is misconfigured or fails is reported honestly — the feature never
    substitutes demo output for a model reply.
- **The pipeline panel checks only the stages this build actually has.** Health Auto Export and
  Health API are probed for real; Intelligence is computed locally from the dataset the app is
  serving; Dashboard *is* the request. There is no ingestion job, no timer and no schedule, and
  the panel says so. The Apple Health and MongoDB stages were removed: neither is a source this
  build can ever read or check, so listing them was a permanent `unknown` that implied a
  connection that does not exist.
- **The `heart_rate` series is normalized (daily average, with daily max/min computed) and
  registered, but no page draws it specifically yet** — it appears only where the registry
  surfaces it.
- **Malformed or missing fields upstream are not repaired.** Records without a numeric value,
  or without `start_time`/`workout_type`, are dropped; the dropped counts are not yet surfaced
  per metric in the UI (only the source-dedup counts are).
- **`apple_stand_time`, `apple_sleeping_wrist_temperature` raw fields and the empty upstream
  metrics** (`walking_heart_rate`, `vo2max`, `waist_circumference`, `cycling_distance`,
  `dietary_caffeine`, `dietary_protein`, `dietary_water`, `mindful_minutes`, `blood_glucose`,
  `apple_move_time`, `dietary_sodium`) are deliberately **not requested**: they are known to
  have no records, and the app renders them from the registry as "not recorded in your Health
  Auto Export history" — never as zero.
- **There is still no authentication, no TLS and no rate limiting.** Run it on a private LAN
  or behind an authenticated reverse proxy.
- **The live dataset is cached in process memory.** One read-only cache fill warms it at
  process start, and stale-while-revalidate refreshes it in the background after the TTL
  lapses; a request only waits for upstream on a genuinely cold process. There is still no
  background ingestion job, no scheduler and no persisted copy of the dataset on disk.

## Integrations

**Health Auto Export — implemented (server-side), and the only source.** Apple Health records are
exported by the iOS app and received by a
[`health-auto-export-server`](https://github.com/HealthyApps/health-auto-export-server) instance —
the metrics API server this app requires — and Vital reads them from that server over these
verified contracts:

- `GET /api/metrics/:metric` with an `api-key` header and `from`/`to` ISO query parameters →
  an array of observations. Plain metrics carry `{ date, qty, units, source }`; `heart_rate`
  carries `{ Avg, Max, Min }`; `blood_pressure` carries `{ systolic, diastolic }`;
  `sleep_analysis` carries stage hours plus `inBedStart`/`inBedEnd`.
- `GET /api/workouts?startDate&endDate` → `[{ id, workout_type, start_time, end_time,
  duration_minutes, calories_burned }]`. No distance and no heart rate are provided, so none is
  invented; `duration_minutes` arrives as a long float and is rounded to one decimal.

The implementation lives in `src/lib/adapters/`:

| File | Role |
|------|------|
| `hae.ts` | The only module that knows the wire protocol; sends the token as `api-key`, validates that responses are arrays, and exposes the bounded probe |
| `normalize.ts` | Pure upstream → internal-shape conversion: the metric mapping table, per-strategy daily aggregation, sleep composition, blood-pressure pairing, coverage/provenance |
| `sources.ts` | The source de-duplication rule (composite splitting, device families, priorities) |
| `units.ts` | Canonical unit conversions, round-trip safe |
| `cache.ts` | TTL cache with single-flight and stale-while-revalidate |
| `live.ts` | `LiveHealthDataAdapter` + `loadLiveDataset()` (bounded windows, fetch-once aggregate-server-side) and the boot-time `warmLiveDataset()` cache fill |
| `runtime.ts` | The mode switch used by the layout and the server routes; raises `LiveDataUnavailableError` instead of falling back to demo |

The `ANALYST_*` variables are live configuration: with `ANALYST_PROVIDER=openai` or
`anthropic` a request *is* sent to the endpoint you configure (see *AI Analyst
configuration*); with `demo` nothing leaves the machine. The profile is not configuration at
all: it is a JSON file the server owns (`./data/profile.json`, see *The profile*) rather than an
environment variable, and it holds no secret.

## Privacy and security

- **No third-party analytics, trackers or telemetry.** `NEXT_TELEMETRY_DISABLED=1` is set in
  every image stage, so Next.js does not phone home either. There is no analytics dependency
  in `package.json`.
- **No health values in logs.** Server logs record pipeline outcomes (HTTP status, duration,
  outcome name), not metric values.
- **No secrets in the client bundle.** All integration variables are unprefixed
  (`HAE_*`, `MONGO*`, `ANALYST_*`) and read only in server modules, so they never reach the
  browser. `src/lib/adapters/index.ts` deliberately does not re-export the server-only entry
  points (`hae.ts`, `live.ts`, `runtime.ts`). Verified by grepping every served
  `.next/static/chunks/*.js` for the token, the configured host and recorded raw live values:
  none is present.
- **Personal health responses are never publicly cacheable.** Every route answers with
  `Cache-Control: private, no-store` (set in `next.config.js` and repeated on the API routes),
  plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and
  `X-Frame-Options: DENY`.
- **No secrets in the image or in git.** `.env` is gitignored and excluded from the build
  context by `.dockerignore`; nothing sensitive is baked into a layer. Runtime configuration
  is passed via the environment, and the token is only ever sent as an upstream HTTP header —
  never written into a file, a URL, a log line or the report.
- **Deploy on a private LAN or VPN, or behind an authenticated reverse proxy.** The container
  has no built-in authentication or TLS: anyone who can reach the port sees the dashboard.
  Put an authenticating reverse proxy in front of it before exposing it beyond a trusted
  network.
- **No HIPAA compliance or production-security claims.** This is a demo build for personal
  use: no audit logging, no encryption at rest, no multi-user isolation, no rate limiting,
  no hardened base-image supply chain process.
