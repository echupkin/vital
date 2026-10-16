// ── The shipped migrations ──────────────────────────────────────────────────
//
// The runner refuses two files with the same version, and the container
// entrypoint refuses to start when the runner fails. A clash can arrive through
// a merge (two branches each adding "the next" number), so the real
// db/migrations directory is checked here rather than only at deploy time.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMigrations } from './migrate-core.mjs';

const DIR = join(process.cwd(), 'db', 'migrations');

function shipped() {
  return readdirSync(DIR)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .map(filename => ({ filename, sql: readFileSync(join(DIR, filename), 'utf8') }));
}

describe('db/migrations', () => {
  it('builds: every version is claimed by exactly one file', () => {
    expect(() => buildMigrations(shipped())).not.toThrow();
  });

  it('ships 0010 source credentials, with no health-value column', () => {
    const file = shipped().find(m => m.filename === '0010-source-credentials.sql');
    expect(file).toBeDefined();
    const columns = [...file!.sql.matchAll(/^\s{2}(\w+)\s+(?:text|bytea|timestamptz|integer)\b/gm)].map(m => m[1]);
    expect(columns).toEqual([
      'source_id',
      'ciphertext',
      'iv',
      'auth_tag',
      'key_id',
      'scopes',
      'access_expires_at',
      'connected_at',
      'updated_at',
      'revision',
    ]);
  });

  it('ships 0011 source tags: ids only, no health value, and a backfill that cannot re-tag', () => {
    const file = shipped().find(m => m.filename === '0011-source-provenance.sql');
    expect(file).toBeDefined();
    const sql = file!.sql;
    expect(sql).toMatch(/ALTER TABLE analyst_messages\s+ADD COLUMN IF NOT EXISTS source_ids text\[\] NOT NULL DEFAULT '\{\}'/);
    expect(sql).toMatch(/ALTER TABLE analyst_conversations\s+ADD COLUMN IF NOT EXISTS source_ids text\[\] NOT NULL DEFAULT '\{\}'/);
    expect(sql).toMatch(/USING gin \(source_ids\)/);
    const columns = [...sql.match(/CREATE TABLE IF NOT EXISTS data_sources_seen \(([\s\S]*?)\n\);/)![1].matchAll(/^\s{2}(\w+)\s/gm)].map(m => m[1]);
    expect(columns).toEqual(['source_id', 'first_active_at', 'last_active_at', 'removed_at']);
    // Both backfills touch only untagged rows.
    expect([...sql.matchAll(/WHERE (?:c\.)?source_ids = '\{\}'::text\[\]/g)]).toHaveLength(2);
  });

  it('ships 0014 silenced quality findings: ids only, keyed by check and metric', () => {
    const file = shipped().find(m => m.filename === '0014-quality-silenced.sql');
    expect(file).toBeDefined();
    const sql = file!.sql;
    const body = sql.match(/CREATE TABLE IF NOT EXISTS quality_silenced \(([\s\S]*?)\n\);/)![1];
    expect([...body.matchAll(/^\s{2}(\w+)\s/gm)].map(m => m[1])).toEqual(['check_id', 'metric_id', 'silenced_at', 'PRIMARY']);
    expect(body).toMatch(/metric_id\s+TEXT\s+NOT NULL DEFAULT ''/);
    expect(body).toMatch(/PRIMARY KEY \(check_id, metric_id\)/);
  });

  it('ships 0015 dashboard cards: ids, a spec, layout and timestamps; no health data', () => {
    const file = shipped().find(m => m.filename === '0015-dashboard-cards.sql');
    expect(file).toBeDefined();
    const sql = file!.sql;
    const body = sql.match(/CREATE TABLE IF NOT EXISTS dashboard_cards \(([\s\S]*?)\n\);/)![1];
    expect([...body.matchAll(/^\s{2}(\w+)\s/gm)].map(m => m[1])).toEqual([
      'id', 'mode', 'card_type', 'spec', 'schema_version', 'position',
      'width', 'height', 'revision', 'created_at', 'updated_at', 'CONSTRAINT',
    ]);
    expect(body).toMatch(/mode\s+TEXT\s+NOT NULL CHECK \(mode IN \('demo', 'live'\)\)/);
    expect(body).toContain("CHECK (card_type ~ '^[a-z][a-z0-9-]{0,31}$')");
    expect(body).not.toMatch(/card_type\s+\w*enum/i);
    expect(body).toMatch(/spec\s+JSONB\s+NOT NULL CHECK \(jsonb_typeof\(spec\) = 'object'\s+AND octet_length\(spec::text\) <= 2048\)/);
    expect(body).toMatch(/schema_version\s+INTEGER\s+NOT NULL CHECK \(schema_version >= 1\)/);
    expect(body).toMatch(/position\s+INTEGER\s+NOT NULL CHECK \(position >= 0\)/);
    expect(body).toMatch(/width\s+SMALLINT\s+NOT NULL DEFAULT 1 CHECK \(width BETWEEN 1 AND 4\)/);
    expect(body).toMatch(/height\s+SMALLINT\s+NOT NULL DEFAULT 1 CHECK \(height BETWEEN 1 AND 4\)/);
    expect(body).toMatch(/revision\s+INTEGER\s+NOT NULL DEFAULT 1 CHECK \(revision >= 1\)/);
    expect(body).toMatch(/CONSTRAINT dashboard_cards_mode_position UNIQUE \(mode, position\)\s+DEFERRABLE INITIALLY IMMEDIATE/);
    expect(body).toMatch(/id\s+TEXT\s+PRIMARY KEY/);
  });

  it('ships 0016 corrections turned off: a check id only', () => {
    const file = shipped().find(m => m.filename === '0016-quality-corrections-off.sql');
    expect(file).toBeDefined();
    const body = file!.sql.match(/CREATE TABLE IF NOT EXISTS quality_correction_off \(([\s\S]*?)\n\);/)![1];
    expect([...body.matchAll(/^\s{2}(\w+)\s/gm)].map(m => m[1])).toEqual(['check_id', 'turned_off_at']);
    expect(body).toMatch(/check_id\s+TEXT\s+PRIMARY KEY/);
  });

  it('numbers each file as its header says', () => {
    for (const { filename, sql } of shipped()) {
      const version = filename.slice(0, 4);
      expect(sql.split('\n')[0], filename).toContain(`── ${version} —`);
    }
  });
});
