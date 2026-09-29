// ── Next.js instrumentation hook (SERVER-SIDE ONLY) ─────
//
// `register()` runs exactly once per server process, before the server starts
// answering requests. It warms the live dataset cache, so the first visitor
// after a deploy or restart does not pay the cold upstream pass.
//
// This is a read-only cache fill, never an ingestion job: no timer, no schedule,
// no write — one fetch-and-normalize pass into the in-process cache, and then the
// ordinary stale-while-revalidate refresh keeps it current. The warm-up is
// fire-and-forget so it can never delay the server coming up, and it is skipped
// entirely in demo mode, when the API is unconfigured, and during the build.
//
// The log line records a duration and an outcome only: never a metric value and
// never the read token.

// The hook also runs for the edge runtime and for the production build; the
// live adapter is Node-only, so both are skipped.
//
// It warms the live dataset only. The briefing writer lives in the Overview
// route's own graph instead (src/lib/briefing/scheduler.ts): Next runs this hook
// in its own module graph, so a briefing cached here is not the one
// `/api/briefing` reads.

export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  // The import sits inside a positive runtime check so the bundler drops it —
  // and the Postgres-backed profile store it reads — from the edge build.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { warmUp } = await import('./instrumentation-node');
    await warmUp();
  }
}
