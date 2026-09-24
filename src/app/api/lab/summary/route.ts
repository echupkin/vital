// ── /api/lab/summary — the series read model ─────────────────────────────────
//
//   GET → getSeries(): per analyte, its observations ordered by result date with
//         their intervals and computed status, plus the earliest and latest
//         values and the delta, and a collisions count where two rows share
//         (analyte_key, result_on).
//
// The band is chosen from the owner's own `profile` row (date of birth and sex).
// SEX IS NEVER INFERRED: with `profile.sex` unset a sex-specific band is not
// used and the result stays unscored, with a warning — see status.ts.

import { NextResponse } from 'next/server';
import { getSeries, readSeriesProfile, storeClient } from '@/lib/db/lab-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

export async function GET() {
  const client = storeClient();
  if (!client) {
    return NextResponse.json(
      {
        available: false,
        reason:
          'No Postgres database is configured, so no lab series can be read. Configure DATABASE_URL or the VITAL_PG_* variables.',
        analytes: [],
        totalObservations: 0,
        collisions: 0,
      },
      { status: 200, headers: NO_STORE }
    );
  }

  const profile = await readSeriesProfile(client);
  const series = await getSeries(client, profile);

  return NextResponse.json(
    { available: true, profile: { sexSet: profile?.sex !== null && profile?.sex !== undefined, dateOfBirthSet: Boolean(profile?.dateOfBirth) }, ...series },
    { status: 200, headers: NO_STORE }
  );
}