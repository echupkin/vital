# Reference

Routes, what is still demo or unwired in this build, and the quality commands.

[← Back to the README](../README.md)

---

# Routes

| Route | Page |
|-------|------|
| `/` | Overview — the daily briefing, today's signals and your health story |
| `/trends` | Compare periods; explore how two metrics move together |
| `/health` | Heart, blood pressure and other health signals |
| `/activity` | Steps, exercise and movement |
| `/activity/maps` | Maps of where outdoor workouts went, with highlights |
| `/sleep` | Nights, stages, consistency |
| `/body` | Weight, body composition |
| `/nutrition` | Logged dietary intake |
| `/medications` | Logged doses, today and per medication |
| `/lab`, `/lab/[analyteKey]` | Lab results, and one analyte over time |
| `/workouts` | The training routine dashboard |
| `/workouts/routine/[pathId]` | One progression path of the plan |
| `/workouts/routine/workouts/[templateId]` | One workout in the plan |
| `/workouts/recovery` | Recovery signals the plan checks |
| `/workouts/all` | Every recorded session, with filters and comparisons |
| `/insights` | Observations and the weekly / monthly report archive |
| `/analyst` | The AI analyst |
| `/themes` | Light and dark colour themes |
| `/settings` | Account (profile and goals), preferences, data and coverage, connections, AI privacy |
| `/metric/[metricId]` | One metric in detail |

The API lives under `/api/*`: `activity-coverage`, `activity-maps`, `analyst` (with `conversations`
and `stream`), `briefing`, `geocode`, `lab`, `medications`, `pipeline/status`, `preferences`,
`profile`, `routine`, `workout-sources` and a `health` liveness probe.

---

# Demo-only

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
- **Several metrics are requested under HAE's name, not the registry id.** HAE stores walking
  heart rate as `walking_heart_rate_average`, VO₂ max as `vo2_max`, cycling distance as
  `cycling_distance` and sodium as `sodium`; its `walking_heart_rate` and `vo2max`
  collections are always empty, summarized export or not. The mapping table in
  `src/lib/adapters/normalize.ts` records each pairing.
- **`apple_stand_time`, `apple_sleeping_wrist_temperature` raw fields and the empty upstream
  metrics** (`mindful_minutes`, `blood_glucose`, `apple_move_time`) are deliberately **not
  requested**: they are known to have no records, and the app renders them from the registry
  as "No readings of this metric are recorded" — never as zero.
- **There is still no authentication, no TLS and no rate limiting.** Run it on a private LAN
  or behind an authenticated reverse proxy.
- **The live dataset is cached in process memory.** One read-only cache fill warms it at
  process start, and stale-while-revalidate refreshes it in the background after the TTL
  lapses; a request only waits for upstream on a genuinely cold process. There is still no
  background ingestion job and no persisted copy of the dataset on disk; the only timer is the
  daily briefing's (it writes the briefing at the profile's briefing hour).

---

# Quality commands

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run lint` | ESLint (`next lint`) |
| `npm run test` | Vitest suite |
| `npm run build` | Production build (standalone output) |
