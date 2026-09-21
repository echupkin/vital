Below is a copy-ready prompt designed for a smaller coding model. It prioritizes a polished, working product, gives concrete visual direction, and separates real functionality from features that require backend or AI integration.

```text
You are a senior product designer and full-stack frontend engineer. Build a working, premium personal health intelligence web application called “Vital.”

Do not merely describe the design. Implement it in the available project.

PRODUCT PROMISE
“Your health. Your data. Your intelligence.”

The application transforms Apple Health history into an understandable daily briefing, meaningful trends, evidence-linked insights, and contextual answers.

The interface must answer:
1. What is happening?
2. What changed?
3. Why might it matter?

This is a private consumer health product—not a hospital portal, fitness game, generic admin dashboard, or Grafana replacement with prettier charts.

────────────────────────────────────────
1. EXECUTION RULES AND PRIORITIES
────────────────────────────────────────

First inspect the existing project and reuse its framework, dependencies, and conventions. Do not replace a working project unnecessarily.

If starting from an empty project, use:
- Next.js with App Router
- React and TypeScript
- Tailwind CSS
- shadcn/ui primitives where useful
- Recharts for visualizations
- Lucide icons

Use custom composition and styling so the result does not look like an unmodified component-library template.

Build in this order:
1. Design system, application shell, coherent sample dataset.
2. Exceptional Overview page.
3. Reusable metric detail experience.
4. Trends, domain pages, and Insights.
5. AI analyst, search, and Settings.
6. Responsive behavior, accessibility, interaction testing.

Prioritize a polished vertical slice over superficial breadth. Reuse well-designed components rather than creating unrelated layouts for every page.

Do not stop after planning. Implement, run available checks, and fix errors.

When external services or credentials are unavailable:
- Deliver a fully usable, clearly labeled demo.
- Use deterministic local data and real client-side calculations.
- Keep integration boundaries clean.
- Never pretend a live connection, AI response, automated job, or security feature exists.

────────────────────────────────────────
2. ART DIRECTION
────────────────────────────────────────

Create an original visual identity inspired by premium consumer health products and refined financial analytics applications.

Borrow these qualities, not another brand’s assets or exact layout:
- Editorial typography
- Generous whitespace
- Restrained color
- Strong contrast
- Softly rounded surfaces
- Beautiful, legible charts
- Natural-language interpretation
- Clear hierarchy

Desired first impression:
“Calm, intelligent, personal, trustworthy.”

Avoid:
- Dense grids of identical KPI cards
- Bright rainbow charts
- Excessive borders and shadows
- Large decorative medical illustrations
- Stock photography
- Glowing neon effects
- Gradient text
- Decorative charts with no underlying data
- Arbitrary health scores
- Constant red/green judgments

The product should feel designed, not assembled.

────────────────────────────────────────
3. DESIGN TOKENS
────────────────────────────────────────

Use semantic CSS variables for all colors and support light and dark themes from the beginning.

Light theme:
- Page background: warm ivory, approximately #F6F5F1
- Card surface: #FFFFFF
- Muted surface: #EEEDE7
- Primary text: #202722
- Secondary text: #626B65
- Subtle border: #E1E4DD
- Primary accent: deep forest green, approximately #285C49
- Accent tint: #E7EFE8
- Hero surface: follows the theme. Light theme: the accent tint #E7EFE8 with the deep green-black #172B24 as its text. Dark theme: deep green-black, approximately #0E1E18.
  (Owner decision, Sep 20 2026: a permanently dark hero read as the wrong theme leaking into the light UI, so the briefing surface now follows the theme. The `hero.*` tokens in `src/app/globals.css` are the single place this lives.)

Dark theme:
- Page background: #101713
- Card surface: #19221D
- Elevated surface: #222E27
- Primary text: #F1F4EF
- Secondary text: #ABB6AC
- Subtle border: #334238
- Primary accent: muted mint, approximately #A9CBB2

Category accents, used sparingly:
- Activity: muted teal
- Cardiovascular: soft coral
- Sleep: dusty indigo
- Body: warm taupe
- Nutrition: sage
- Respiratory: muted cyan
- Recovery: subdued violet
- Attention: amber

Verify accessible contrast. Suggested colors may be adjusted to meet it.

Typography:
- Use Geist, Inter, or an available equivalent.
- Prefer locally bundled fonts; do not require third-party font requests.
- Use tabular numerals for measurements and comparisons.
- Desktop greeting: approximately 40–48px.
- Hero statement: approximately 30–38px.
- Section titles: approximately 22–26px.
- Primary measurements: approximately 32–44px.
- Body text: approximately 14–16px.
- Avoid excessive all-caps labels.

Layout:
- Desktop sidebar: approximately 224px.
- Main content: maximum width around 1360px.
- Desktop content padding: 32–40px.
- Mobile content padding: 16–20px.
- Main section gaps: 28–36px.
- Cards: 20–24px corner radius.
- Controls: 10–14px corner radius.
- Use an 8px spacing rhythm.
- Shadows should be extremely subtle.

Motion:
- Gentle 150–250ms transitions.
- Restrained chart transitions and panel reveals.
- Respect prefers-reduced-motion.
- Do not animate every number on every render.

────────────────────────────────────────
4. APPLICATION SHELL
────────────────────────────────────────

Desktop:
- Quiet left sidebar with Vital wordmark and a small original abstract icon.
- Main navigation:
  Overview
  Trends
  Health
  Activity
  Sleep
  Body
  Nutrition
  Workouts
  Insights
  AI Analyst
- Settings and theme control anchored near the bottom.
- Give AI Analyst a subtle accent treatment.
- Active navigation uses a tinted pill, not a loud solid block.

Top utility area:
- Global search: “Search your health data…”
- Keyboard shortcut hint.
- Data freshness button.
- Small personal avatar or initials.
- Keep chrome minimal.

Tablet:
- Collapse the sidebar into a compact rail or drawer.

Mobile:
- Bottom navigation: Overview, Trends, Insights, AI, More.
- Put remaining destinations in More.
- Respect device safe areas.
- Never require horizontal page scrolling.
- Charts may simplify labels without losing meaning.

Use real routes and active states. Support browser back and forward navigation.

────────────────────────────────────────
5. OVERVIEW: THE MOST IMPORTANT SCREEN
────────────────────────────────────────

Compose an editorial dashboard, not a uniform widget grid.

At approximately 1440px desktop width, the first viewport should show:
- Greeting and date
- Main health briefing
- Core signals
- Beginning of “What changed”

A. Greeting

“Good morning, Alex”
“Your health snapshot for Thursday, September 17”

Use the application clock consistently:
- Live mode uses the actual current date and selected timezone.
- Demo mode uses one fixed reference date matching the dataset.

Show “Demo data” clearly when applicable. Freshness text must also be labeled as simulated in demo mode.

B. Main briefing hero

Use a wide, dark forest-colored card occupying roughly two-thirds of a desktop row, with a smaller light card beside it.

Hero:
Small label: “TODAY’S BRIEFING”
Headline: “Your signals are broadly within your recent baseline.”

Supporting copy should briefly summarize the strongest supported pattern.

Include a restrained row of category summaries:
- Sleep: Within baseline
- Recovery: Stable
- Activity: Above recent average
- Cardiovascular: Within baseline

These statuses must reflect available evidence. Use “Not enough data” when appropriate.

Add “View your health story” with a directional icon.

No numerical health score, fake confidence percentage, or decorative gauge.

Companion card:
“One thing to watch”
Show one measured change, its comparison window, and a link to evidence.
Use a quiet amber accent only when justified.
If no meaningful change exists, display a calm, honest alternative.

C. Core health signals

Use three focused cards:
- Resting heart rate
- HRV
- Sleep duration

Illustrative latest values:
- Resting heart rate: 58 BPM
- HRV: 62 ms
- Sleep: 7h 42m

Each card includes:
- Metric name
- Large value and unit
- Measurement date or period
- Change versus yesterday
- Previous 30-day baseline
- Thin sparkline
- A clear route to the detail view

Do not force these example values if the generated data differs. All labels and charts must agree.

Avoid automatically coloring lower heart rate or higher HRV as “good.” Prefer neutral comparison language.

D. What changed?

A wider comparison panel:
- Heading: “What changed this week?”
- Current seven days versus the preceding seven days
- Four compact rows: Sleep, Resting HR, HRV, Exercise
- Exact values or deltas
- One short contextual summary
- “Explore changes” action

Use aligned comparison rows or subtle bars—not another row of cards.

E. Health story and insights

A larger editorial “Your health story” panel:
- A short summary of the last 90 days
- Two or three evidence-linked observations
- Small supporting trend visualization
- Period selector

Alongside it, two compact insight cards:
- Observation title
- Short explanation
- Date range
- Evidence quality or coverage
- “View evidence”

F. Ask your health data

A spacious, lightly tinted section:
“Make sense of the bigger picture.”

Input:
“Ask about your sleep, recovery, activity…”

Suggested questions:
- Why was my resting heart rate higher this week?
- How has my sleep changed over the last 3 months?
- Are my workouts associated with better sleep?

Submitting opens AI Analyst with the question preserved.

────────────────────────────────────────
6. REUSABLE METRIC DETAIL EXPERIENCE
────────────────────────────────────────

Every metric card opens a real detail route.

Desktop may use a full page or a spacious side panel with a shareable route. Mobile should use a full-width view.

Include:
- Name and category
- Latest available value and timestamp
- Unit
- Today, yesterday, seven-day average, previous 30-day baseline
- Range controls: 7D, 30D, 90D, 1Y, All
- Custom date range
- Interactive chart
- Tooltip with actual value, date, and unit
- Toggle for baseline band
- Average, minimum, maximum, and valid observation count
- Brief factual trend summary
- Related available metrics
- Provenance and underlying records where present
- Accessible data-table alternative

Use a brush or range selector for zooming.

Only show anomaly markers when they are actually calculated. Explain their methodology in a disclosure.

Distinguish:
- No reading today
- Latest available reading
- Incomplete day
- Insufficient history
- Stale source data

Never substitute zero for missing data.

────────────────────────────────────────
7. OTHER DESTINATIONS
────────────────────────────────────────

Use shared domain templates but give each domain an appropriate main visualization.

Trends:
- “What changed?” comparison workspace
- Date-range and comparison controls
- Searchable metric selector
- Multiple aligned charts
- Relationships tab with scatter plot

Health:
- Cardiovascular-first summary
- Resting HR, HRV, walking HR, VO₂ max
- Blood pressure and blood oxygen only when available
- Discoverable additional categories and metrics

Sleep:
- Latest sleep episode
- Sleep duration timeline
- Sleep stages when supported by source data
- Consistency and bedtime variability
- “Sleep and recovery” aligned charts
- Clearly distinguish time asleep from time in bed

Activity:
- Steps, exercise minutes, distance, active calories, stand hours
- Activity history
- Workout frequency
- Recent workouts

Workouts:
- Filterable workout list
- Activity-type filters
- Detail view with duration, distance, heart rate, and calories
- Compare similar workouts only when enough comparable records exist

Body:
- Long-term weight trajectory as the main visual
- Body fat, lean mass, BMI, and waist when available
- Do not interpret sparse measurements as daily observations

Nutrition:
- Clearly labeled logged intake
- Calories, protein, carbohydrates, fat, water, caffeine
- Additional nutrients discovered from available data
- Explain that missing food logs are not zero intake
- Association links only when coverage is sufficient

Insights:
- Filters for trends, changes, associations, and reports
- Evidence-linked insight cards
- Daily briefing
- Weekly and monthly report archive
- Health story view
- Reports must be generated from the dataset, not unrelated static prose

Settings:
- Units
- Timezone
- Theme
- Data coverage
- Available metrics
- Connection configuration/status
- Baseline explanation
- AI privacy and provider configuration state
- Notification preferences

Persist harmless preferences locally. Never store API keys or raw health records in localStorage.

────────────────────────────────────────
8. AI ANALYST
────────────────────────────────────────

This should feel like a health data analysis workspace, not a generic chat widget.

Header:
“Ask about your health”

Subtitle:
“Explore patterns in your Apple Health history.”

Layout:
- Conversation area
- Suggested prompts
- Optional collapsible context/evidence panel
- Composer with clear send state
- Evidence cards and small charts inside answers
- Useful follow-up suggestions

Answers should distinguish:
1. Observed measurements
2. Possible interpretations
3. Missing context and uncertainty

Every factual numerical claim must link to:
- Metric
- Date window
- Aggregation
- Sample count or coverage
- Relevant chart or records

Medical boundaries:
- Interpret data; do not diagnose.
- Do not imply that correlation establishes causation.
- Do not infer a condition from an isolated wearable reading.
- Do not prescribe treatment.
- Do not present a personal baseline as a medical safety range.
- Suggest professional evaluation where appropriate without alarmist copy.
- Include a concise educational-information notice.

If no AI provider is configured:
- Label the feature “Demo analyst.”
- Implement several useful question handlers grounded in the shared dataset.
- Return deterministic, computed responses for supported questions.
- For unsupported questions, explain the limitation and offer supported prompts.
- Never portray canned output as a live model response.

Architecture:
- Define a server-side analyst service boundary.
- Retrieve only relevant metric summaries and bounded records.
- Do not send the entire database to a model.
- Treat imported notes and user content as untrusted data, not instructions.
- Keep queries read-only and validated.
- Require explicit consent before sending health context to an external provider.
- Show which provider receives which categories of data.
- Keep model credentials on the server.

────────────────────────────────────────
9. SHARED DATA AND ANALYTICS
────────────────────────────────────────

Create one canonical deterministic sample dataset used across every page.

Include approximately 180 days of plausible synthetic history with:
- Resting heart rate
- HRV
- Sleep episodes and duration
- Steps
- Exercise minutes
- Active calories
- Respiratory rate
- Weight
- VO₂ max
- Logged caffeine and nutrition
- Several workout types

Include:
- Some missing days
- Different sampling frequencies
- A few clearly synthetic trend changes
- Partial current-day activity
- Source and import timestamps
- Coverage metadata

Use a seeded generator or fixed fixtures. Do not use fresh random values on each render.

Charts, deltas, insights, reports, and analyst responses must derive from this same dataset.

Create a metric registry containing:
- Stable ID
- Display name
- Category
- Canonical unit
- Display formatter
- Data type
- Appropriate aggregation
- Source availability
- Minimum coverage requirements

Render metrics dynamically from the registry and actual availability. Unknown supported numeric metrics should have a safe generic detail view.

Calculation rules:
- Baselines exclude the period being evaluated.
- Clearly label every comparison window.
- Compare complete periods where possible.
- Do not compare partial current-day steps with yesterday’s full total as if equivalent.
- Use the user’s timezone and handle daylight-saving boundaries.
- Assign overnight sleep consistently to its waking date.
- Preserve missingness and source coverage.
- Do not blindly sum overlapping records from multiple devices.
- Use explicit source-priority/deduplication rules.
- Use metric-specific aggregation rather than averaging everything.
- Handle unit conversions consistently.
- Avoid percentage changes when the denominator is zero.
- Apply minimum-data rules before producing insights.

Initial anomaly detection can use a documented robust rolling baseline. Do not claim clinical significance or implement complex methods only in name.

Relationship explorer:
- Metric X and metric Y selectors
- Date range
- Scatter plot
- Computed correlation coefficient
- Number of paired observations
- Explicit same-day or lagged alignment
- Clear insufficient-data state
- “Association does not establish causation”

Do not invent confidence intervals, statistical significance, or causal explanations. Treat exploratory associations cautiously because missingness, repeated observations, confounders, and testing many relationships can mislead.

────────────────────────────────────────
10. BACKEND AND INTEGRATION BOUNDARY
────────────────────────────────────────

The existing Health Auto Export ecosystem is the intended source, with MongoDB remaining the source of truth.

The supplied specification mentions:
- Ingestion: /api/data
- Metric retrieval: /api/metrics/:selected_metric
- Workout endpoints whose exact contracts must be verified

Do not assume different repository forks expose identical APIs.

Create:
- A typed HealthDataAdapter interface
- A working DemoHealthDataAdapter
- A clearly separated integration adapter/configuration boundary

Inspect available source or documentation before implementing live requests. Do not invent payload schemas, authentication methods, or workout URLs.

Keep ingestion separate from dashboard reads.

Conceptual architecture:
Source API → normalization → aggregation → baseline/insights → web UI and analyst context

For live integrations:
- Use a server-side proxy/service.
- Never expose database access or service credentials in browser code.
- Validate upstream data.
- Provide clear loading, unavailable, stale, and error states.
- Never silently replace failed live data with demo data.
- Do not claim background processing exists unless implemented.

Freshness button opens a “Data pipeline” panel showing:
Apple Health → Health Auto Export → Health API → MongoDB → Intelligence → Dashboard

Only mark individual stages healthy when their status is known. Unknown is a valid state.

────────────────────────────────────────
11. PRIVACY AND SECURITY
────────────────────────────────────────

- No third-party analytics, tracking pixels, or external telemetry.
- No health values in ordinary application logs.
- No secrets in source code or client bundles.
- Provide an environment-variable example without real credentials.
- Avoid shared/public caching of personal health responses.
- Document private LAN/VPN or authenticated reverse-proxy deployment.
- Do not equate “no traditional login” with safe public access.
- Do not claim HIPAA compliance or production security certification.

A local demo may run without authentication. A live deployment must have an explicit access-control boundary.

────────────────────────────────────────
12. INTERACTIONS AND ACCESSIBILITY
────────────────────────────────────────

Every visible control must work or clearly communicate why it is unavailable.

Required interactions:
- Navigation
- Metric drill-down
- Chart range changes
- Chart tooltips
- Theme switching with persistence
- Unit switching with consistent conversions
- Timezone preference
- Search and keyboard command palette
- Insight evidence links
- Suggested analyst questions
- Follow-up questions
- Data pipeline panel
- Mobile navigation

Search should support:
- Metric names and aliases such as “HRV”
- Navigation destinations
- A few bounded time queries such as “sleep last month”
- Routing longer questions to AI Analyst

Do not imply unrestricted natural-language parsing if only specific patterns are supported.

Accessibility:
- Semantic landmarks and headings
- Visible keyboard focus
- Accessible labels for icon buttons
- Keyboard-operable dialogs and menus
- Focus trapping and restoration for dialogs
- Escape to dismiss overlays
- Minimum 44px touch targets
- WCAG AA text contrast
- No meaning conveyed by color alone
- Chart summaries and accessible tabular values
- Screen-reader-friendly loading and response states

Include polished:
- Loading skeletons
- Empty states
- Insufficient-data states
- Connection error states
- Retry actions
- Stale-data indicators

────────────────────────────────────────
13. IMPLEMENTATION QUALITY
────────────────────────────────────────

Organize code into clear modules for:
- Application shell
- UI primitives
- Metric registry
- Adapters and fixtures
- Analytics utilities
- Charts
- Evidence/provenance
- Domain pages
- Analyst service
- Preferences

Suggested reusable components:
- AppShell
- Sidebar
- MobileNavigation
- CommandPalette
- FreshnessIndicator
- BriefingHero
- MetricCard
- MetricChart
- ComparisonPanel
- InsightCard
- EvidencePanel
- HealthStory
- AnalystMessage
- DataState

Avoid a giant single-file implementation.

Add focused tests for:
- Comparison and baseline windows
- Missing-data behavior
- Zero denominators
- Unit conversion
- Timezone/day boundaries
- Correlation pairing
- Data-consistent insight generation

Use existing project tooling. Run type checking, linting, tests, and a production build where supported.

────────────────────────────────────────
14. ACCEPTANCE CRITERIA
────────────────────────────────────────

Before finishing, verify:

Visual:
- Overview feels premium and editorial.
- The dark briefing hero anchors a warm, restrained interface.
- The layout is not a wall of identical KPI cards.
- Charts remain readable in both themes.
- No overflow at approximately 375px, 768px, and 1440px.

Functional:
- All navigation destinations work.
- Core cards open metric details.
- Range selectors change both chart data and summary calculations.
- Insight evidence links open the relevant metric and period.
- Search returns useful results.
- Analyst suggestions produce grounded demo answers or real configured responses.
- Preferences persist appropriately.
- Browser refresh and direct route loading work.

Trust:
- Demo data is unmistakably labeled.
- All numbers come from the shared dataset.
- Missing values are not shown as zeros.
- No fabricated health score, medical conclusion, live connection, or AI capability.
- Personal baselines are not presented as proof of medical normality.
- Integration limitations are explicit.

Final delivery:
1. The implemented application.
2. A concise summary of completed features.
3. Setup and run instructions.
4. A clear list of demo-only functionality and remaining integrations.
5. The checks actually run and their results.

Start by inspecting the project, then build. Make reasonable decisions without unnecessary clarification questions.

Above all: make the Overview feel like a thoughtful personal morning briefing, and make every important statement traceable to evidence.
```