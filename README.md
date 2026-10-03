# Vital — Health Intelligence Dashboard

**Vital turns the health data already on your iPhone into answers.** Instead of a wall of charts, it
tells you in plain language how the last week compares with the weeks before, what is worth
noticing, and what to do next — and lets you ask follow-up questions of your own data. It runs
privately on your own machine, and nothing about your health leaves it unless you choose a hosted AI
model.

Apple Health is very good at *collecting* data and not very good at *telling you what it means*.
Vital is the missing second half: it reads your Apple Health history (through the free Health Auto
Export app), reads your lab reports and your training logs, and puts it all in one calm,
goal-aware dashboard.

---

## What it is for

- **Knowing how you are actually doing** — a short briefing every morning, written about *your*
  goals, with every number checked against your data.
- **Asking questions instead of hunting through charts** — *"Why was my sleep worse this month?"*,
  *"What do my latest labs mean?"*, *"Is my resting heart rate improving?"*
- **Making lab results readable** — upload the PDF and see each result against the range your own
  lab printed, with a history of every value.
- **Following a training plan that adapts to you** — progress is measured from your logged sessions,
  not a calendar, so you are never told you are "behind".
- **Keeping your health data yours** — self-hosted, no accounts, no analytics, no tracking.

**Who it is for:** one person (or one household) who wears an Apple Watch or logs health data on an
iPhone, is comfortable running a Docker container, and wants more insight than the Health app gives.
It is a personal dashboard for a trusted, private network — **not a medical device**, and not a
substitute for a clinician.

---

## A look inside

Screenshots of the running app, with names and other personal details removed.

<p align="center">
  <img src="docs/screenshots/overview.png" alt="The Overview: a daily briefing, core health signals and what changed this week" width="49%">
  <img src="docs/screenshots/sleep.png" alt="The Sleep page: the latest night, stage breakdown and sleep stages by night" width="49%">
</p>
<p align="center">
  <img src="docs/screenshots/health.png" alt="The Health page in the light theme: signals mapped on a body figure, with cardiovascular cards" width="49%">
  <img src="docs/screenshots/health-dark.png" alt="The same Health page in the dark theme" width="49%">
</p>
<p align="center">
  <img src="docs/screenshots/trends.png" alt="Trends: compare periods with a 7, 30, 90 or custom date range" width="49%">
  <img src="docs/screenshots/activity.png" alt="The Activity page: steps, exercise minutes, distance, calories and stand hours" width="49%">
</p>
<p align="center">
  <img src="docs/screenshots/body.png" alt="The Body page: weight, composition and a weight trajectory" width="49%">
  <img src="docs/screenshots/themes.png" alt="Themes: five light and nine dark colour themes" width="49%">
</p>

---

## What Vital can do

### A daily briefing built around your goals
Every morning the top of the Overview tells you, in a few sentences, how the last seven days
compare with the weeks before, the single pattern most worth noticing, and two to four practical
next steps.

- **It follows what you are working toward.** Write your goals in *Settings → Account → Goals* —
  *"lose weight and build muscle"*, *"build up to a 10k"*, *"bring my resting heart rate down"* — and
  the briefing leads with the measurements that bear on them instead of defaulting to sleep and
  recovery. With no goals you get an all-round summary.
- **You can trust the numbers.** Every figure in the written text is checked against your data
  before it is shown. If the text cites a number it was not given, it is thrown away and a plainly
  labelled computed summary is shown instead.
- **Predictable.** One briefing per day at the hour you choose, written once; a *Regenerate*
  button when you want another.

### An AI analyst you can talk to
Ask in ordinary language and get an answer that reads like a short medical analysis, not a data dump.

- **Prose with meaning.** The reply explains what the pattern is consistent with (named as
  *possibilities*, never as a diagnosis), what it does not tell you, and what to do next — with a
  short list of next steps and a closing summary.
- **It points rather than recites.** Measurements appear as links to their own pages, so the answer
  stays readable and the numbers are one click away.
- **What you tell it counts.** Say *"I have no fever"* and, if a temperature reading exists, it
  compares the two, names the difference and goes with your account.
- **Conversations are saved**, listed newest first, and can be reopened, renamed or deleted. Answers
  stream in as they are written.
- **Bring your own model.** Any OpenAI-compatible endpoint (OpenAI, OpenRouter, LM Studio, Ollama,
  vLLM, llama.cpp) or the Anthropic API — including a model running entirely on your own computer.
  With none configured, a built-in demo analyst answers common questions offline.
- **Guard rails.** Lifestyle guidance, yes. Diagnosis, prescribing, or advice on medication and
  doses, never.

### Every metric, charted and compared
- **The Overview** shows today's signals, your health story over the period you pick, and what
  changed this week measured against *your own* baseline — never against a generic "normal".
- **34 metrics**, each with its own page: chart, baseline band, a table view, how complete the data
  is, and related metrics. A day with no reading is shown as missing, never as zero.
- **Dedicated pages** for **Sleep** (nights, stages, consistency, time asleep vs in bed), **Health**
  (heart, blood pressure, oxygen), **Activity**, **Body** and **Nutrition**.
- **Trends** compares any period with the one before — or the same period last year — and shows how
  two metrics move together, same-day or lagged. Relationships are described as association, never
  as cause.
- **Insights** surfaces the changes the data supports well enough to mention, and keeps a weekly and
  monthly report archive.
- **One date control everywhere.** Every page with a date selection offers 7, 30 or 90 days, or any
  custom number of days.

### Lab results you can read
Upload a lab PDF from *Settings* and Vital turns it into one observation per test per date.
Quest Diagnostics and MyChart (Epic) reports are recognised, along with generic multi-date reports.

- **Scored against your report's own range.** Each value is judged against the reference range
  printed on *that* report — not an assumed adult range.
- **Words stay words.** "Positive", "negative" and "none seen" are kept as written; nothing is
  turned into a number it never was.
- **A history for every test**, with a chart, the change since the last result, and a plain-language
  description of what the test measures.

### Medications you have logged
The Medications page shows what you logged in Apple Health: today's doses and a per-medication
history for the last 30 days. It is a *record*, not a verdict — no adherence score, no "missed dose"
alarms, no advice — and the same record is available to the analyst as context.

### Maps of where you went
Activity → Maps draws every outdoor workout that recorded a GPS route as one coverage map — the
streets you have walked, run or ridden, with the ones you use most standing out — rather than a
squiggle per session.

- **As many maps as you like**, each an area you frame: search for a place (or type `lat, lon`, or
  use your location), then pan and zoom until the frame holds what you want.
- **Each map keeps its own view**: which activities to draw, a date range, and what the line colour
  means — how often you travelled a stretch, or your average heart rate along it.
- **Your choice of map underneath**: CARTO (light, dark, or following your theme; needs a free key),
  OpenStreetMap or OpenTopoMap terrain, chosen per map. Settings → Connections shows which are ready.
- **Highlights beside the map**: workouts, time and distance in the area, distinct and new ground,
  your longest session there and your hardest stretch — hover one to see it on the map.

### Training routines that follow your progress
Workouts is a routine dashboard rather than a log: your current phase, the next session, recovery
and deload status, and a card per progression path showing how close you are to the next stage.

- **Progress, not the calendar.** Phases advance when your sessions show you are ready, so nobody is
  ever shown as behind.
- **Plan with the analyst.** *"Build me a 12-week 10k plan, four runs a week"* or *"my lower back is
  sore after reverse crunches."* Every change is saved as a revision, and any change can be undone.
- **Real training detail.** Connect **Hevy** for exercises, sets, reps, load and effort alongside
  your Apple Health workouts.
- **A full history** — every session with filters, sorting and comparisons — at `/workouts/all`.

### Comfortable to live in
- **Themes** — five light and nine dark (Default, Solarized, GitHub, Gruvbox, Catppuccin, Monokai,
  Dracula, Nord, Tokyo Night, One Dark), with a separate pick for each side.
- **A command palette** (`Ctrl/⌘ + K`), breadcrumbs, and a sidebar that opens into sub-pages.
- **Your timezone and units** — metric or imperial, and every day boundary and clock time follows
  your profile.

### Private by design
- Keys and tokens stay on the server and never reach the browser.
- The database holds **configuration only** — profile, preferences, saved conversations, training
  plans and the areas your maps show. Your health history, routes included, stays with Health Auto
  Export and is read live.
- No analytics, no trackers, no telemetry, and no health values in logs.
- Honest failure: when a source cannot be read you get a clear message and a retry, never quietly
  substituted demo data.

---

## Try it in a few minutes

You need Docker with the Compose v2 plugin.

```bash
git clone <repository-url> vital && cd vital
cp .env.example .env        # demo mode works with no values set
npm run db:init             # generates the database password into .env (once)
docker compose up -d --build
```

Open **http://localhost:8080**. With nothing else configured Vital serves a built-in 180-day demo
dataset, so you can explore every page before connecting anything.

### Connect your own data

1. Run a [Health Auto Export metrics server](https://github.com/HealthyApps/health-auto-export-server)
   and point the iPhone app at it.
2. In `.env`, set `VITAL_DATA_MODE=live`, `HAE_API_URL` and `HAE_API_KEY`.
3. Restart: `docker compose up -d`.

### Turn on the AI analyst and briefing

Add a model in `.env`. A hosted one:

```bash
ANALYST_PROVIDER=openai
ANALYST_MODEL=openai/gpt-4o-mini
ANALYST_API_URL=https://openrouter.ai/api/v1
ANALYST_API_KEY=…
```

or one running on your own machine (no key needed):

```bash
ANALYST_PROVIDER=openai
ANALYST_MODEL=local-model
ANALYST_API_URL=http://host.docker.internal:1234/v1
```

### Make it yours

- *Settings → Account* — your name, timezone, the hour the briefing is written, and your **Goals**.
- *Settings → Connections* — status of the health source and any workout source (Hevy).
- *Themes* — pick a look for light and dark.

The app listens on port **8080** (change it with `VITAL_PORT`) and Postgres on `127.0.0.1:5433`.
For development without Docker, `npm install && npm run dev` serves on port 3000.

---

## License

Vital is free software, licensed under the **[GNU Affero General Public License v3.0](LICENSE)**
(`AGPL-3.0-only`).

In plain terms: you may use, study, change and share it, including at work. If you distribute a
modified version, or let other people use a modified version over a network (for example by hosting
it), you must offer them the corresponding source code under the same license. The license text in
[`LICENSE`](LICENSE) is the only authoritative statement of your rights and obligations; this
summary is not legal advice.

Copyright (C) 2026 the Vital contributors.

## Trademarks and affiliations

Vital is an independent project. It is **not affiliated with, endorsed by, sponsored by, or
otherwise connected to** any company or product it can read from or talk to.

All product names, service names, logos and trademarks that appear in this repository, its
documentation or the application — including, without limitation, **Apple**, **Apple Health**,
**Apple Watch** and **iPhone** (Apple Inc.); **Health Auto Export**; **Hevy**; **Quest Diagnostics**;
**MyChart** and **Epic** (Epic Systems Corporation); and the names of AI providers and models such as
**OpenAI**, **Anthropic**, **OpenRouter**, **LM Studio**, **Ollama** and **llama.cpp** — are the
property of their respective owners. They are used only to describe what Vital is compatible with.

The same applies to every data source, workout source, lab format or AI provider that is added to
Vital in future: each name belongs to its owner, and mentioning it implies no relationship, approval
or partnership. Vital reads data you already have the right to access, through interfaces those
services make available to you; using them remains subject to their own terms of service. Vital is
not a medical device and is not provided by, or on behalf of, any of the parties named above.

---

## Learn more

| | |
|---|---|
| [Configuration](docs/configuration.md) | The analyst and its providers, the profile and goals, the training routine, the daily briefing |
| [Data sources and modes](docs/data-sources.md) | Health Auto Export, Hevy, demo vs live data, de-duplication and the adapters |
| [Architecture](docs/architecture.md) | How the app is put together, and what that shape costs |
| [Running it](docs/running.md) | Docker in detail, the database, local development, changing the port, CI and published images |
| [Reference](docs/reference.md) | Every route, what is demo-only in this build, and the quality commands |
| [Privacy and security](docs/privacy-and-security.md) | What is stored, what is sent where, and what to put in front of it |

## Good to know

- There is **no built-in login or TLS**. Run Vital on a private network or behind an authenticating
  reverse proxy.
- Licensed under the [AGPL-3.0](LICENSE); third-party names are trademarks of their owners, see
  [Trademarks and affiliations](#trademarks-and-affiliations).
- It is a personal project, **not a medical device**. It interprets your own recorded data; it does
  not diagnose, treat or rule anything out.
- Quality checks: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
