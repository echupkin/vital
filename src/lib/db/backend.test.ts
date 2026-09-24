// ── Configuration backend resolution ────────────────────────────────────────
//
// Postgres is the ONLY place configuration may live. These tests pin the two
// failure modes as hard errors with an actionable reason (there is no JSON-file
// fallback), and the success mode as Postgres.

import { describe, expect, it } from 'vitest';
import {
  NO_DATABASE_CONFIGURED_REASON,
  describeBackend,
  isDatabaseConfigured,
  resolveBackend,
} from '@/lib/db/backend';

/** A complete, usable discrete-parts configuration. */
const CONFIGURED = {
  VITAL_PG_HOST: 'db',
  VITAL_PG_PORT: '5432',
  VITAL_PG_DATABASE: 'vital',
  VITAL_PG_USER: 'vital',
  VITAL_PG_PASSWORD: 'not-a-real-secret',
} as unknown as NodeJS.ProcessEnv;

describe('configuration backend — Postgres or a loud error', () => {
  it('resolves to Postgres when a database is configured', () => {
    const backend = resolveBackend(CONFIGURED);
    expect(backend.kind).toBe('postgres');
    expect(backend.target).toMatch(/^postgres:\/\//);
    expect(describeBackend(CONFIGURED)).toMatch(/^Postgres \(/);
    expect(isDatabaseConfigured(CONFIGURED)).toBe(true);
  });

  it('throws the actionable reason when nothing is configured — never a file', () => {
    expect(() => resolveBackend({} as NodeJS.ProcessEnv)).toThrow(NO_DATABASE_CONFIGURED_REASON);
    expect(() => resolveBackend({} as NodeJS.ProcessEnv)).toThrow(/VITAL_PG_/);
    expect(describeBackend({} as NodeJS.ProcessEnv)).toMatch(/unavailable/);
    expect(isDatabaseConfigured({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('throws the reason when a configured database is invalid', () => {
    const invalid = { VITAL_PG_PORT: 'not-a-port' } as unknown as NodeJS.ProcessEnv;
    expect(() => resolveBackend(invalid)).toThrow(/Postgres configuration is invalid/);
    expect(isDatabaseConfigured(invalid)).toBe(true);
  });
});
