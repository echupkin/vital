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
import { getSeries, storeClient, type SeriesProfile } from '@/lib/db/lab-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = { 'Cache-Control': 'no-store, private' } as const;

const SELECT_PROFILE_FACTS = `
  SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth, sex
    FROM profile
   WHERE id = 1
`;

async function readProfileFacts(client: NonNullable<ReturnType<typeof storeClient>>): Promise<SeriesProfile | null> {
  try {
    const result = await client.query(SELECT_PROFILE_FACTS);
    const row = result.rows[0];
    if (!row) return null;
    const sex = row.sex === 'male' || row.sex === 'female' ? row.sex : null;
    const dateOfBirth = typeof row.date_of_birth === 'string' ? row.date_of_birth : null;
    return { dateOfBirth, sex };
  } catch {
    // A profile read failure must not hide the results: the series is served
    // unscored rather than not at all.
    return null;
  }
}

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

  const profile = await readProfileFacts(client);
  const series = await getSeries(client, profile);

  return NextResponse.json(
    { available: true, profile: { sexSet: profile?.sex !== null && profile?.sex !== undefined, dateOfBirthSet: Boolean(profile?.dateOfBirth) }, ...series },
    { status: 200, headers: NO_STORE }
  );
}