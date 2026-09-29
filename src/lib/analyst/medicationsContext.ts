// ── Loading the analyst's medications context (SERVER ONLY) ─────────────────
//
// The medication records live upstream in the owner's Health Auto Export API,
// not in the metric dataset the retrieval bundle is built from, so they are read
// here — asynchronously, bounded to a window, and only through the existing
// adapter (`fetchMedications`), which owns the auth header, the cache policy and
// the error mapping. Nothing here re-implements window maths or the grouping
// key: the block states exactly what the Medications page states.
//
// FAILURE IS STATED, NEVER HIDDEN. An unconfigured API, an unreachable one, an
// HTTP error or an unreadable body all yield `available: false` with the reason;
// the analyst then says the medication data is absent rather than answering from
// an empty set. A medication read failure must never fail the whole question,
// and it must never look like "there are no medication records".
//
// NOTHING IS PERSISTED. Health data never reaches the database; this reads the
// API at request time and holds the result only for the life of the call.

import { fetchMedications, type MedicationRecord } from '@/lib/adapters/medications';
import { readProfile } from '@/lib/profile/store';
import type { RequestDeps } from '@/lib/adapters/hae';
import {
  medicationsWindow,
  MEDICATIONS_LOOKBACK_DAYS,
} from '@/lib/medications/view';
import { dayKey } from '@/lib/analytics/windows';
import {
  buildMedicationSnapshot,
  unavailableMedicationSnapshot,
} from './medicationSnapshot';
import type { MedicationContextSnapshot } from './types';

/** The shape the service injects in tests; the real one reads the live API. */
export type MedicationLoader = (
  question: string,
  deps?: { env?: NodeJS.ProcessEnv }
) => Promise<MedicationContextSnapshot | null>;

const NOT_CONFIGURED_REASON =
  'The Health Auto Export API is not configured, so no medication records can be read. No medication data is in this context.';

function reasonFrom(error: unknown): string {
  const detail =
    error instanceof Error && error.message
      ? error.message
      : 'the medication records could not be read';
  return `The medication records could not be read (${detail}). No medication data is in this context.`;
}

/**
 * Read the medication records for one analyst question and build the block.
 *
 * The question is not used to select a subset: the whole medication set is small
 * (one row per medication, not per dose), and an answer about one medication
 * needs the window's context around it to be meaningful. The argument is kept so
 * the loader matches the lab loader's shape and can be narrowed later without a
 * signature change.
 */
export async function loadMedicationSnapshot(
  _question: string,
  deps: { env?: NodeJS.ProcessEnv; fetchImpl?: RequestDeps['fetchImpl']; timezone?: string } = {}
): Promise<MedicationContextSnapshot> {
  const now = deps.env?.VITAL_REFERENCE_NOW ?? new Date().toISOString();
  // Days are attributed in the profile's timezone, as on the Medications page.
  const timezone = deps.timezone ?? (await readProfile(deps.env)).timezone;
  const referenceDay = dayKey(new Date(now), timezone);
  const window = medicationsWindow(referenceDay, MEDICATIONS_LOOKBACK_DAYS);

  let records: MedicationRecord[];
  let from: string | null = window.from;
  let to: string | null = window.to;
  try {
    const result = await fetchMedications(window, {
      env: deps.env,
      timezone,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });
    records = result.records;
    from = result.window.from ?? from;
    to = result.window.to ?? to;
  } catch (error) {
    // A failed read is stated, never turned into an empty record set.
    if (error instanceof Error && /not configured/i.test(error.message)) {
      return unavailableMedicationSnapshot(NOT_CONFIGURED_REASON);
    }
    return unavailableMedicationSnapshot(reasonFrom(error));
  }

  return buildMedicationSnapshot(
    { records, from, to, readAt: now },
    { lookbackDays: MEDICATIONS_LOOKBACK_DAYS, referenceDay }
  );
}
