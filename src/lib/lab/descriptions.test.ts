// ── Tests for the analyte descriptions ──────────────────────────────────────
//
// Two things are pinned here. First, the copy is RENDERED VERBATIM: what the UI
// shows is the string the audit pass checked against the cited page, never a
// trimmed or reflowed version. Second, the lookup is by WHAT THE ANALYTE IS: a
// stored key the extractor wrote (`protein_total`) finds the description of its
// registry entry (`total_protein`), and an analyte with no entry returns null so
// the UI renders nothing rather than a placeholder.

import { describe, it, expect } from 'vitest';
import raw from './analyte-descriptions.json';
import { ANALYTES, analyteByKey } from './analytes';
import { DESCRIBED_KEYS, analyteDescription, type AnalyteDescription } from './descriptions';

const RAW: Record<string, AnalyteDescription> = raw;

describe('the description file', () => {
  it('has an entry for every key it declares, and every one is a registry key', () => {
    expect(DESCRIBED_KEYS.length).toBeGreaterThan(0);
    for (const key of DESCRIBED_KEYS) {
      // A description keyed to a name the registry does not know could never be
      // reached by the UI, so it would be a silent hole.
      expect(analyteByKey(key)?.key, key).toBe(key);
    }
  });

  it('gives every entry a whatItIs, a source title and an https source URL', () => {
    for (const key of DESCRIBED_KEYS) {
      const entry = RAW[key]!;
      expect(entry.whatItIs.trim().length, key).toBeGreaterThan(0);
      expect(entry.sourceTitle.trim().length, key).toBeGreaterThan(0);
      expect(entry.sourceUrl, key).toMatch(/^https:\/\//);
      // Any high/low text that exists must carry something.
      if (entry.ifHigh !== undefined) expect(entry.ifHigh.trim().length, `${key} ifHigh`).toBeGreaterThan(0);
      if (entry.ifLow !== undefined) expect(entry.ifLow.trim().length, `${key} ifLow`).toBeGreaterThan(0);
    }
  });

  it('describes the LDL/HDL ratio the owner’s report prints', () => {
    expect(analyteDescription('ldl_hdl_ratio')).not.toBeNull();
  });
});

describe('the copy is rendered verbatim', () => {
  it('returns exactly the audited string for every entry', () => {
    for (const key of DESCRIBED_KEYS) {
      const shown = analyteDescription(key)!;
      expect(shown.whatItIs, key).toBe(RAW[key]!.whatItIs);
      expect(shown.ifHigh, key).toBe(RAW[key]!.ifHigh);
      expect(shown.ifLow, key).toBe(RAW[key]!.ifLow);
      expect(shown.sourceTitle, key).toBe(RAW[key]!.sourceTitle);
      expect(shown.sourceUrl, key).toBe(RAW[key]!.sourceUrl);
    }
  });

  it('never trims, reflows or appends to whatItIs', () => {
    for (const key of DESCRIBED_KEYS) {
      const shown = analyteDescription(key)!.whatItIs;
      expect(shown, key).toBe(shown.trim());
      expect(shown, key).not.toContain('\n');
    }
  });
});

describe('the lookup is by what the analyte is, not by how its key was spelled', () => {
  it('finds the entry behind a stored key the extractor wrote', () => {
    // `protein_total` is the extractor's key; `total_protein` is the registry's.
    expect(analyteDescription('protein_total')?.whatItIs).toBe(RAW.total_protein!.whatItIs);
    expect(analyteDescription('cholesterol_total')?.whatItIs).toBe(RAW.total_cholesterol!.whatItIs);
    expect(analyteDescription('bilirubin_total')?.whatItIs).toBe(RAW.total_bilirubin!.whatItIs);
    expect(analyteDescription('hdl')?.whatItIs).toBe(RAW.hdl_c!.whatItIs);
    expect(analyteDescription('co2')?.whatItIs).toBe(RAW.co2_bicarbonate!.whatItIs);
    expect(analyteDescription('alkaline_phosphatase')?.whatItIs).toBe(RAW.alp!.whatItIs);
  });

  it('returns null — never an invented or borrowed entry — when there is none', () => {
    // No description exists for a bare glucose, and borrowing the fasting
    // entry's copy would assert a fasting state the document never printed.
    expect(analyteDescription('glucose')).toBeNull();
    expect(analyteDescription('widget_one')).toBeNull();
    expect(analyteDescription('')).toBeNull();
  });

  it('renders a description for 13 of the 14 stored keys the owner’s data uses', () => {
    // The 14 keys measured from the live database. Registering them is what lets
    // the Lab card and the detail route find copy: 13 resolve to a described
    // entry; only the bare `glucose` has none.
    const stored = [
      'alkaline_phosphatase',
      'basophils_pct',
      'bilirubin_total',
      'calculated_bun_creat',
      'cholesterol_total',
      'co2',
      'eosinophils_pct',
      'glucose',
      'hdl',
      'ldl',
      'lymphocytes_pct',
      'monocytes_pct',
      'neutrophils_pct',
      'protein_total',
    ];
    const described = stored.filter(key => analyteDescription(key) !== null);
    expect(described).toHaveLength(13);
    expect(stored.filter(key => analyteDescription(key) === null)).toEqual(['glucose']);
  });

  it('leaves the four derived entries with no description, as the file intends', () => {
    const derived = ['differential_absolute', 'differential_percent', 'estimated_average_glucose', 'homa_ir'];
    for (const key of derived) {
      expect(DESCRIBED_KEYS, key).not.toContain(key);
      expect(analyteDescription(key), key).toBeNull();
    }
    // The only other registry entry without copy is the bare `glucose` entry
    // this gate registers: the audited copy describes a FASTING glucose, and
    // borrowing it would assert a fasting state the document never printed.
    const withoutCopy = ANALYTES.filter(analyte => !DESCRIBED_KEYS.includes(analyte.key)).map(
      analyte => analyte.key
    );
    expect(withoutCopy.sort()).toEqual([...derived, 'glucose'].sort());
    expect(analyteDescription('glucose')).toBeNull();
  });
});
