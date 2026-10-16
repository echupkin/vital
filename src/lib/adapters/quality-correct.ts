// ── Correcting data-quality findings in Vital's own totals (pure) ───────────
//
// Two checks find records that only repeat others: overlapping exports (finer
// records beside the hourly total that already contains them) and duplicate
// readings (an on-the-hour copy of a reading). Vital cannot change the export
// server — it holds only the read token — but it can leave those records out
// when it adds the data up, which is what the reader would otherwise do by hand
// on the server. `findRedundant` in `quality.ts` decides which records they
// are, for the report and for this correction alike.
//
// The correction is on by default. The reader can turn it off per check
// (stored as configuration in `quality_correction_off`, migration 0016); the
// finding then comes back with a "Fix it" button that turns it on again.

import { compactRecords, findRedundant, CORRECTABLE_CHECKS, type CorrectableCheck } from './quality';
import type { DayAggregation } from './normalize';

export { CORRECTABLE_CHECKS, type CorrectableCheck };

/** The check that corrects a metric aggregated this way, if any. */
export function correctionFor(aggregation: DayAggregation): CorrectableCheck | null {
  return aggregation === 'sum' ? 'overlapping-exports' : aggregation === 'latest' ? 'duplicate-readings' : null;
}

/**
 * The records left after the correction for this aggregation, and how many
 * went. Records are returned unchanged when the correction is off, when there
 * is none for the aggregation, or when nothing repeats.
 */
export function dropRedundant<T extends { date: string; value: number; source?: string }>(
  records: T[],
  aggregation: DayAggregation,
  corrections: ReadonlySet<CorrectableCheck> | undefined,
  tz: string
): { kept: T[]; dropped: number } {
  const check = correctionFor(aggregation);
  if (!check || !corrections?.has(check) || records.length === 0) return { kept: records, dropped: 0 };
  // Packing skips records without a readable instant; keep them out of the index space, and keep them.
  const timed = records.filter(r => Number.isFinite(Date.parse(r.date)));
  const { drop, count } = findRedundant(
    aggregation,
    compactRecords(timed.map(r => ({ date: r.date, value: r.value, source: r.source ?? '' }))),
    tz
  );
  if (count === 0) return { kept: records, dropped: 0 };
  const gone = new Set(timed.filter((_, i) => drop[i] === 1));
  return { kept: records.filter(r => !gone.has(r)), dropped: count };
}

// ── Input validation (shared by the correct routes) ─────────────────────────

export type CorrectionInput = { ok: true; checkId: CorrectableCheck } | { ok: false; error: string };

export function validateCorrectionInput(body: unknown): CorrectionInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'The request body must be a JSON object.' };
  }
  const { checkId, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return { ok: false, error: `Unknown field(s): ${Object.keys(rest).join(', ')}.` };
  if (typeof checkId !== 'string' || !(CORRECTABLE_CHECKS as readonly string[]).includes(checkId)) {
    return { ok: false, error: `"checkId" must be one of: ${CORRECTABLE_CHECKS.join(', ')}.` };
  }
  return { ok: true, checkId: checkId as CorrectableCheck };
}
