# Data sources, modes and integrations

Where Vital reads your health and workout data from, how demo and live modes differ, and how the adapters are laid out.

[← Back to the README](../README.md)

> **Trademarks.** Health Auto Export, Apple Health, Oura, Hevy and every other source named here are
> trademarks of their respective owners and are mentioned only to describe compatibility. Vital is not
> affiliated with or endorsed by any of them, and this applies equally to sources added later. See
> [Trademarks and affiliations](../README.md#trademarks-and-affiliations).

---

# Data sources

**Vital supports two health-data sources: Apple Health, via the Health Auto Export app for
iPhone, paired with a self-hosted metrics API server —
[HealthyApps/health-auto-export-server](https://github.com/HealthyApps/health-auto-export-server) —
and, optionally, the Oura Ring through Oura's own cloud API (see [Oura Ring](#oura-ring)).**

The chain has three links, and Vital implements only the last one:

| Link | What it is | Provided by |
|------|-----------|-------------|
| iPhone | Apple Health records exported by the **Health Auto Export** app for iOS, on a schedule or on change | You (the app) |
| Metrics API server | [`HealthyApps/health-auto-export-server`](https://github.com/HealthyApps/health-auto-export-server) — a Node.js server that receives those exports, stores them, and exposes `GET /api/metrics/:metric` and `GET /api/workouts` | **Required** — paired with the app; it is the only thing Vital can read |
| Vital | Reads that server **server-side**, normalizes it into the internal dataset | This repository |

What that means in practice:

- **The metrics API server is not optional.** Apple Health has no public cloud API, a web app
  cannot read HealthKit, and the phone cannot be queried directly. Run your
  `health-auto-export-server` instance and connect it in **Settings → Sources** (its address and
  read key; the key is stored encrypted), or run in `demo` mode, or use Oura alone (live mode needs
  at least one of the two).
- **No other health source is supported, partially or otherwise.** There is no direct HealthKit or iCloud
  bridge; no Google Fit, Android or Samsung Health; no Garmin, Fitbit or Withings; no Apple
  Health `export.xml` upload and no CSV/JSON import. The adapter layer knows one wire protocol, and
  the pipeline panel lists only the stages this build can actually check.
- **Demo mode is not a source.** `VITAL_DATA_MODE=demo` serves the committed fixtures
  (`src/data/health-fixtures.json`) and is labelled as demo; it connects to nothing.
- **Adding a source means implementing its contract** under `src/lib/adapters/` (see
  *Integrations*): a module that knows the wire protocol, a mapping into the internal dataset
  shape, and a unit mapping. Nothing else in the app changes, because both modes produce the same
  dataset.

## Setting up Health Auto Export for complete data

Vital can only show what reaches the metrics server, and the server stores exactly what the app
sends it. Most "missing data" is a setup problem on the phone, not in Vital. These settings keep
the history complete and stop it from being counted twice. The app's menus change between
versions, so the setting names below describe what to look for rather than quote the app.

1. **Send everything to one server: the one Vital reads.** Every automation and every manual
   export should post to the same `…/api/data` URL that Vital's `HAE_API_URL` points at, with the
   server's write token in the `api-key` header. With a second server in the picture (an old
   local one, a test copy), the phone can export to one while Vital reads the other. The data is
   then "missing" in Vital even though the app reported success.
2. **Use the REST API automation, JSON format, and select every metric you want to see.**
   Nutrition (dietary energy, protein, carbohydrates, total fat, fiber and the rest) is a
   separate group of metrics in the app. If it isn't selected, the Nutrition page and the body
   goal's energy balance stay empty however long you log food.
3. **Choose one time grouping and keep it: 1 hour is recommended.** The app can send every
   individual sample or totals per minute, hour or day. Vital works with any of them, but the
   server merges two records only when their timestamp and source match exactly. Data re-sent
   at a different grouping is stored *beside* what is already there. Vital then adds both
   together, so steps, active and basal energy, distance and calories count twice on every day
   where the two overlap. Hourly totals are a good default for three reasons:
   - The payloads stay small.
   - Health has already counted steps that the iPhone and the Watch recorded at the same time
     once.
   - Food logged at a meal time lines up with the hour.
4. **Re-send a few recent days on every sync, not only what is new.** A food entry back-dated or
   edited after its day was synced never reaches the server if each sync sends only what is new
   since the last one. Re-sending a trailing window (the last several days) is safe at the same
   time grouping, because the server updates matching records instead of adding them.
5. **Backfill the history once, with the phone unlocked.** A new automation only sends from now
   on. Run a manual export over your whole history, at the **same time grouping** as the
   automation. iOS blocks apps from reading Health data while the phone is locked, so keep the
   app open until the export finishes. Split very long ranges into months.
6. **Check that the data arrived; the app's success message is not proof.** The server answers
   "N metrics saved successfully", where N is the number of metric *types* in the upload, not
   records. An upload whose metrics carry no data gets the same answer. Afterwards, open
   **Settings → Data & coverage** in Vital and check that the days you expect are covered. You
   can also ask the server directly:
   `GET /api/metrics/step_count?from=2026-06-01&to=2026-06-30` with the read token.

**Settings → Connections → Data pipeline** runs these checks for you under **Data quality**. They
run in the background after each load of the live data, so no page waits for them; the panel
shows that they are running until the result is ready. It reads the records as the server stores them, before they are
added up per day. Each finding explains what it found, lists the affected days, and gives the
steps that fix it, or fixes it for you where Vital can:

| Check | What it flags |
|---|---|
| Overlapping exports | Hourly totals stored beside the finer records they already contain, so daily sums count that activity twice (step 3) |
| Duplicate readings | A weigh-in or similar reading stored again as an on-the-hour copy |
| Missing days | Steps, energy or distance absent on days the watch recorded heart rate or other activity (steps 2 and 5) |
| History that starts late | A metric, usually food, that begins long after the rest of the history (step 5) |
| New data arriving | Nothing new from the watch for 36 hours: the automation has stopped, or posts elsewhere (step 1) |

A finding whose affected days are all more than 90 days old is shown as a **note**, not a
problem: recent figures (the trends, baselines and body goal) are not affected, and fixing it
only completes the older history.

**Overlapping exports and duplicate readings are corrected automatically.** The records that
only repeat others are left out of Vital's own totals: inside each hour that holds an hourly
total, the finer records it already contains (only on days the check flags, so a stray hour is
never touched), and the on-the-hour copy of a reading. The check then reads **Corrected by
Vital** with how many records were left out. Vital never writes to the export server, so other
readers of it (Grafana, say) still see the doubled records; repair those at the source as below.
**Stop correcting** next to a corrected check counts every record again, and the finding comes
back with a **Fix it** button that turns the correction back on. The choice is stored as
configuration only (`quality_correction_off`, migration 0016). Missing days, a late start and a
stalled automation cannot be corrected by Vital: the data never reached the server, so those
findings keep their steps.

Each finding has a **Silence** button. A silenced finding, identified by its check and its
metric, stops showing everywhere, including the pipeline stage text and counts. Silenced findings
are listed under the report, and **Restore** brings one back. Silencing is stored as
configuration only; it never changes the data.

### If the data already mixes groupings

The symptom is daily steps, active energy or basal energy at roughly double the usual on some
days, usually right after a manual export at a different time grouping. Vital corrects this in
its own totals (above). To repair it on the server itself, for every other reader of it:

1. **Back up the server's database first.** For the reference server this is
   `mongodump --db health-auto-export --gzip --archive=…`.
2. **Remove the finer records that the coarser totals already contain.** For each summed metric
   and each hour that has an hourly total, delete the other records inside that hour.
3. **Remove duplicate readings.** For weight, heart rate and other readings, delete the copies
   that the export added beside the original readings.

After that, keep to step 3 above.

## Oura Ring

Oura is an optional second live source. It is read server-to-server through Oura's cloud API, and
it works on its own (no Health Auto Export needed) or next to it. Oura retired personal access
tokens, so a token cannot be pasted anywhere: Vital signs in with OAuth2 (authorization code
with PKCE) and you press **Connect** in *Settings → Sources*.

### Set it up

1. Register an app at <https://cloud.ouraring.com/oauth/applications>. Add one redirect URI that
   matches the address you browse Vital from, for example
   `http://localhost:8080/api/sources/oura/callback`.
2. Make sure `VITAL_SECRET_KEY` is set (`npm run db:init` generates one, or
   `openssl rand -base64 32`). It encrypts the credentials and tokens stored in Postgres.
3. Open *Settings → Sources*, enter the app's client ID, client secret and redirect URI in the
   Oura card, and save. The redirect URI is prefilled from the address you are browsing from. The
   client secret is stored encrypted and is never shown again.
4. Press **Connect** and approve the scopes on Oura's page.

Vital requests the scopes `daily heartrate workout spo2`. VO2 max needs one more scope, `heart_health`, which is off by default: add it to `OURA_SCOPES` (and enable *Heart Health* on your Oura app) and reconnect to include it. You can grant fewer: the endpoints whose
scope was not granted are skipped, and Settings says which. Until the app credentials are saved,
Oura is off. The tuning variables (`OURA_*`) are admin settings and are listed in `.env.example`.

### Connecting when Vital runs on another machine

Oura allows a plain `http://` redirect address only for `localhost`. The redirect is followed by
your **browser**, not by Oura's servers, so Vital never has to be reachable from the internet. If
your browser is on a different computer from Vital (a home server, a NAS), carry `localhost`
across with an SSH tunnel for the few seconds the sign-in takes:

1. Register a `localhost` redirect address with Oura (scheme, host, port and path must match
   exactly), for example `http://localhost:8080/api/sources/oura/callback`. You enter the same
   string as the redirect URI in the Oura card in Settings.

2. On the computer that runs your browser, open the tunnel (`vital.example.lan` stands for
   however you reach the server):

   ```bash
   ssh -L 8080:localhost:8080 you@vital.example.lan
   ```

3. Browse to `http://localhost:8080`, open *Settings → Sources*, check that the redirect URI in
   the Oura card is the `localhost` one (it is prefilled from the address you browse from), and
   press **Connect**. Start from `localhost`, not from the server's name: the sign-in state lives in a cookie tied to the
   host name, so a different host fails the state check.
4. Close the tunnel when Oura shows as connected. Vital keeps the encrypted refresh token and
   renews it itself, so day-to-day use at the server's normal address is unaffected. You only need
   the tunnel again to reconnect after revoking access.

If port 8080 is taken on the browser's computer, use another local port (`-L 9090:localhost:8080`)
and put that port in the redirect URI in the Oura card and in Oura's portal. If you get a "state mismatch" error, try
another browser: some refuse `Secure` cookies over `http://localhost`.

Alternatively, serve Vital over HTTPS (a reverse proxy with a certificate your browser trusts) and
register the `https://` address as the redirect.

### What is stored

Only the app credentials (client ID, secret and redirect URI) and the access and refresh tokens,
all encrypted with `VITAL_SECRET_KEY`, in Postgres. **No Oura reading is ever stored**: not
in the database, not in a file, not in a log. Readings are fetched on demand, held in server memory
for `OURA_CACHE_TTL_SECONDS` (default 300), and dropped on restart, on Disconnect, or when Oura is
disconnected. Vital shows no Oura score (readiness, sleep, activity, stress, resilience or
cardiovascular age): only the measurements.

### What is the same measure and what is not

Mixing two different measures under one metric would draw a trend that does not exist, so Vital
merges only measures that mean the same thing.

| Oura field | Vital metric | Same as Apple Health's? | What Vital does |
|---|---|---|---|
| Sleep periods: bed time, time in bed, total sleep, deep, light, REM and awake time | Sleep (light sleep shown as core) | Yes, the stages map one to one | Merged under the priority rule |
| Average breathing rate during sleep | Respiratory rate | Yes (breaths per minute) | Merged |
| Daily average blood oxygen | Blood oxygen saturation (%) | Yes | Merged |
| Daily steps | Steps | Yes | Merged |
| Active calories | Active energy (kcal) | Yes | Merged |
| VO2 max | VO2 max | Both are estimates in ml/kg/min | Merged |
| Heart rate samples | Heart rate, daily mean | Yes | Merged |
| Workouts | Workouts (distance in km) | The same session can appear in both | Merged; overlapping sessions count once |
| Average HRV during sleep | Overnight HRV (RMSSD), new | **No.** Oura reports RMSSD overnight; Apple reports SDNN | Shown as its own metric |
| Lowest heart rate during sleep | Lowest overnight heart rate, new | **No.** It is not Apple's resting heart rate | Shown as its own metric |
| Temperature deviation | Temperature deviation, new | **No.** A change from your baseline, not a wrist temperature | Shown as its own metric |
| Equivalent walking distance | none | **No.** An energy equivalent, not a distance | Not used |
| Breathing disturbance index | none | **No.** Apple's metric is a count | Not used |
| Readiness, sleep and activity scores, stress, resilience, cardiovascular age | none | Vendor scores | Excluded |

### How the two sources are merged

- **Daily metric in both sources:** the preferred source for that metric group supplies the day.
  The other source fills only the days the preferred one lacks. Values are never summed or
  averaged across sources.
- **Sleep:** one episode per night, from the preferred source; the other fills only nights with
  none.
- **Workouts:** the union of both. An Oura and an Apple workout that overlap by at least half of
  the shorter one (with five minutes of slack) are one workout, and the preferred source's record
  is kept.
- **Preference:** `OURA_PREFERRED_FOR` lists the groups where the ring wins over the watch, from
  `sleep`, `recovery` (breathing rate, blood oxygen), `activity` (steps, active energy), `heart`
  (heart rate, VO2 max) and `workouts`. The default is `sleep,recovery`. The three ring-only
  metrics need no preference.
- **No double counting:** the Oura app also writes into Apple Health, so Health Auto Export can
  carry the same nights. While Oura is connected, Vital ignores ring-sourced records coming through
  Health Auto Export and reads them once, directly. If Oura is not connected, nothing changes.
- **If one source fails** and the other works, you get the working one's data and the failure is
  shown in Settings and the pipeline panel. If both fail, the app reports the live source as
  unavailable; it never substitutes demo data.

### Removing a source

A source is removed when you press **Disconnect** on Health Auto Export, Oura or Hevy in
Settings, remove the Oura credentials, or delete the last lab report. Removal takes effect
immediately: Vital erases that source's cached data, workout sessions, briefings and the analyst
conversations tagged with it, and then behaves as if the source had never existed.

| Where the source's data or anything derived from it can live | When it is removed |
|---|---|
| Live data, route cache, workout sessions (all in memory) | Dropped at once |
| Pages and charts | Rebuilt from the remaining sources |
| Daily briefing | Dropped and written again from the remaining sources |
| Analyst conversations and thread memory (Postgres) | Conversations tagged with the source are deleted whole, messages included |
| Stored credential (Postgres) | Deleted |
| Lab reports and files | The per-report delete. Deleting the **last** report also erases the lab-tagged conversations; the app asks first and says how many |
| Dashboard cards (Postgres) | Kept: they hold metric ids only; a card whose data is gone shows that it has no readings |
| Logs | Nothing to erase: Vital logs outcomes, never values or tokens |

Only a deliberate removal erases conversations. A source that is merely inactive (not yet
re-entered after an upgrade or restore, a restart, a failed read) keeps its conversations. If the
source comes back, nothing is lost.

Kept on purpose, because they are configuration and not data: your profile, preferences, training
plans (targets, never observations) and activity-map areas.

One consequence: if you remove Oura but the Oura app still writes into Apple Health, those readings
come back through Health Auto Export. That is Health Auto Export's own data, and the result matches
what Vital showed before Oura was ever connected. To drop them, stop Oura writing to Apple Health.

## Workout sources (detailed training data)

Apple Health knows a strength session only as "Strength Training" with a duration and calories.
A **workout source** reads a training app's own API for what was actually done — exercises,
sets, reps, load, duration, distance and RPE — which the training routine on `/workouts` needs.
Sources are plugins under `src/lib/workout-sources/<id>/`, registered in `registry.ts`; each
normalizes into the shared `TrainingSession` model, so nothing downstream knows which app a
session came from.

**Hevy** is the first source (Hevy Pro; create a key at hevy.com/settings?developer):

Open *Settings → Sources → Workout sources*, enter the key (and, only if you need it, another API address) in the
Hevy card, and save. Vital makes one read-only request to check it and, only if that works, stores
it in Postgres, encrypted with `VITAL_SECRET_KEY`. The key is never shown again. Two admin
settings in the environment tune it:

```bash
# .env
# HEVY_CACHE_TTL_SECONDS=300       # how long synced sessions are served before a refresh
# WORKOUT_SOURCE_LOOKBACK_DAYS=400 # how far back the first sync reads
```

The first sync pages `GET /v1/workouts` back to the lookback window and reads the exercise
catalogue once; later syncs read only Hevy's change feed (`GET /v1/workouts/events?since=`).
Like the Health Auto Export history, sessions live in server memory and are **never written to
the database**; demo mode serves committed demo sessions (`src/data/training-fixtures.json`)
and calls nothing. Settings → Sources → Workout sources shows each source's status.

## Workout routes (Activity → Maps)

Health Auto Export's workout list carries no GPS, so the maps read each workout's route and heart
rate from `GET /api/workouts/:id?include=route,heartRateData` — **once per workout**:

- The route is packed into typed arrays (about 13 bytes a point) and held in server memory, keyed
  by workout id and end time, so a re-exported session is read again and an unchanged one never
  is. A workout without a route (a strength session) is remembered as having none. Nothing is
  written to the database or to disk, and no coordinate is logged.
- At most four reads run at once across the process. The first visit to the Maps page after a
  restart reads every workout in the 400-day window (a few seconds for a few hundred workouts);
  after that, changing a map's filters is answered from memory.
- `ROUTE_CACHE_MAX_POINTS` (default `3000000`, about 40 MB) caps the points held; beyond it the
  least recently used routes are dropped and read again when next needed.
- Heart rate is interpolated linearly in time onto each route point (HR arrives about once a
  minute against a point a second) and held, not extrapolated, past the last sample. A point with
  no reading is drawn as "no reading", never as resting.
- A workout whose route could not be read is left off the map and counted in a note under it, and
  retried on the next load. If every read fails, the map says the routes are unavailable rather
  than drawing an empty map.

The coverage itself is computed per request: route points are snapped to a grid sized to the map
(about 1/1000 of its diagonal, 5–50 m), so both sides of a street and both directions of travel
merge into one path with a traversal count, and the paths are dissolved into polylines. Demo mode
draws deterministic synthetic routes around Golden Gate Park for the demo walks, runs and rides,
and reads nothing.

### Map tiles

Each map is drawn on the provider, tile style and light/dark rendering chosen in its edit dialog.
Tiles load from the provider straight into the browser.

| Provider | Styles | Light / dark | Key |
|----------|--------|--------------|-----|
| CARTO | Positron / Dark Matter (with or without labels), Voyager | Light, Dark or Auto (follows your theme); Voyager is light only | `MAP_TILES_CARTO_KEY` ([free for non-commercial use](https://carto.com/basemaps/apikey)) |
| OpenStreetMap | Standard | Light | None |
| OpenTopoMap | Terrain | Light | None |

Every provider can be chosen whether or not its key is set. A map on a provider whose key is
missing still requests its tiles, without the key (the provider may refuse them), and says the key
is missing. Keys are read from the
server environment only; Settings → Sources → Map sources shows which providers are ready, never the
key.

---

# Data modes

| Mode | Dataset | How it is read |
|------|---------|----------------|
| `demo` (default) | `src/data/health-fixtures.json` — deterministic, committed, 180 days | Imported in-process; the browser bundle already contains it |
| `live` | The real Health Auto Export history | Fetched and normalized **on the server**, cached in-process with a TTL + single-flight + stale-while-revalidate and warmed once at process start, then injected into the same internal dataset shape |

Switch modes with `VITAL_DATA_MODE` and restart the process: `live` reads the real history,
anything else (including unset, or `VITAL_DATA_MODE=demo`) serves the committed fixtures. In
`live` mode at least one source must be connected in Settings → Sources, or the app reports
the live source as unavailable instead of falling back. `HAE_CACHE_TTL_SECONDS` (default 300) is the
cache TTL in seconds; it does not control how often a page waits — see below.

**First run (live mode only).** Until at least one source is connected *and* a read succeeds, Vital
is in setup mode: the navigation, search and breadcrumbs are hidden, every address redirects to
Settings → Sources, and a banner above the tabs gives the real reason nothing is shown, with a
Retry button. Once data loads the full app returns by itself, and saving a first connection takes
you to the overview. Demo mode has no such gate.

Both modes produce the *same* internal dataset, so no page or component has to know which one
it is reading. In live mode:

- **The browser never talks to the health API.** All reads happen in server code, and
  the Health Auto Export key is read from the encrypted Postgres row, on the server only. The
  served client bundle contains neither the token nor any live health value (verified by grepping `.next/static/chunks`).
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
  all) waits for upstream. Even then the browser does not stare at a blank tab: the layout
  hands the load to the page as a promise, so the sidebar and top bar paint at once, each page
  shows "Loading your health data…" until its data arrives, and Settings renders immediately
  (its Data & coverage tab waits; the pipeline stages each show "Checking…" until their own
  check answers). Both are read-only cache fills: no ingestion job, no timer and no
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

# Integrations

**Hevy — implemented (server-side), as a workout source** (see *Workout sources*): `GET
/v1/workouts`, `/v1/workouts/events`, `/v1/exercise_templates` and `/v1/user/info` (probe) with an
`api-key` header, in `src/lib/workout-sources/hevy/`.

**Health Auto Export — implemented (server-side), and the only health-data source.** Apple Health records are
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
all: it is the `profile` row in Postgres (`id = 1`, see *The profile*) rather than an
environment variable, and it holds no secret.
