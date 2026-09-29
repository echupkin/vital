// ── Boot-time live dataset warm-up (Node runtime only) ──
//
// Loaded by `register()` in `instrumentation.ts` only on the Node runtime; see
// that file for what the warm-up is and is not.

export async function warmUp(): Promise<void> {
  const started = Date.now();
  const { warmLiveDataset } = await import('@/lib/adapters/live');
  const { readProfile } = await import('@/lib/profile/store');
  // Warm the entry requests will hit: the dataset is cut in the profile's zone.
  const { timezone } = await readProfile();
  const warm = warmLiveDataset({ timezone });
  if (!warm) return; // demo mode, or the export API is not configured

  console.log('[vital] live dataset cache warm-up started (read-only cache fill).');
  void warm.then(outcome => {
    const elapsed = Date.now() - started;
    console.log(
      outcome.ok
        ? `[vital] live dataset cache warm-up finished in ${elapsed} ms; the next request is served from cache.`
        : `[vital] live dataset cache warm-up failed after ${elapsed} ms: ${outcome.reason} ` +
          'The next request will retry and report the failure.'
    );
  });
}
