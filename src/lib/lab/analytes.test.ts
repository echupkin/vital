import { describe, it, expect } from 'vitest';
import {
  ANALYTES,
  analyteByKey,
  displayNameFor,
  normalizeName,
  resolveAnalyte,
  slugFor,
} from './analytes';

describe('the registry is a transcription of the cited document', () => {
  it('has no duplicate keys', () => {
    const keys = ANALYTES.map(analyte => analyte.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every band a source and a source URL', () => {
    for (const analyte of ANALYTES) {
      for (const band of analyte.bands) {
        expect(['published_lab', 'guideline', 'textbook', 'secondary']).toContain(band.source);
        expect(band.sourceUrl.length).toBeGreaterThan(0);
        expect(band.refText.length).toBeGreaterThan(0);
        // A band must constrain at least one side; an all-null band is a bug.
        expect(band.low ?? band.high).not.toBeUndefined();
      }
    }
  });

  it('carries the document flags as band notes, not as invented numbers', () => {
    const rdw = analyteByKey('rdw');
    expect(rdw?.bands).toHaveLength(2);
    expect(rdw?.bands[0]?.low).toBe(9);
    expect(rdw?.bands[1]?.low).toBe(11.5);
    expect(rdw?.bands[0]?.note ?? '').toContain('two sources disagree');
  });

  it('encodes "no agreed interval — leave unscored" rows with NO bands', () => {
    for (const key of ['homa_ir', 'egfr', 'hs_crp', 'psa', 'bnp']) {
      const analyte = analyteByKey(key);
      expect(analyte, key).not.toBeNull();
      expect(analyte?.bands, key).toHaveLength(0);
      expect(analyte?.note ?? '', key).toContain('unscored');
    }
  });

  it('keeps two-sided and one-sided intervals exactly as the document states', () => {
    expect(analyteByKey('total_cholesterol')?.bands[0]?.low).toBeNull();
    expect(analyteByKey('total_cholesterol')?.bands[0]?.high).toBe(200);
    expect(analyteByKey('triglycerides')?.bands[0]?.high).toBe(150);
    expect(analyteByKey('hdl_c')?.bands[0]?.low).toBe(40);
  });
});

describe('alias resolution', () => {
  it('normalises case, whitespace and punctuation', () => {
    expect(normalizeName('  SGPT (ALT) ')).toBe('sgptalt');
    expect(resolveAnalyte('SGPT (ALT)').key).toBe('alt');
    expect(resolveAnalyte('sgpt (alt)').key).toBe('alt');
    expect(resolveAnalyte('SGPT(ALT)').key).toBe('alt');
  });

  it('resolves every legacy name the real reports print', () => {
    const cases: Array<[string, string]> = [
      ['SGPT (ALT)', 'alt'],
      ['SGOT (AST)', 'ast'],
      ['Glycohemoglobin (GHb),Total', 'hba1c'],
      ['CHD', 'cholesterol_hdl_ratio'],
      ['NE%', 'neutrophils_pct'],
      ['LY%', 'lymphocytes_pct'],
      ['MO%', 'monocytes_pct'],
      ['EO%', 'eosinophils_pct'],
      ['BA%', 'basophils_pct'],
      ['NE#', 'neutrophils_abs'],
      ['LY#', 'lymphocytes_abs'],
      ['MO#', 'monocytes_abs'],
      ['EO#', 'eosinophils_abs'],
      ['BA#', 'basophils_abs'],
      ['Ca', 'calcium'],
      ['ECO2', 'co2_bicarbonate'],
      ['Calculated BUN/Creat', 'bun_creatinine_ratio'],
      ['Estimated Average Glucose', 'estimated_average_glucose'],
      ['NE% LY% MO% EO% BA%', 'differential_percent'],
      ['NE# LY# MO# EO# BA#', 'differential_absolute'],
    ];
    for (const [printed, key] of cases) {
      expect(resolveAnalyte(printed).key, printed).toBe(key);
      expect(resolveAnalyte(printed).analyte, printed).not.toBeNull();
    }
  });

  it('resolves the keys the extractor already writes', () => {
    const cases: Array<[string, string]> = [
      ['cholesterol_total', 'total_cholesterol'],
      ['hdl', 'hdl_c'],
      ['ldl', 'ldl_c'],
      ['co2', 'co2_bicarbonate'],
      ['bilirubin_total', 'total_bilirubin'],
      ['phosphate', 'phosphorus'],
      ['protein_total', 'total_protein'],
      ['alkalinephosphatase', 'alp'],
      ['creatininekinase', 'ck'],
      ['creatinineserum', 'creatinine'],
      ['phos', 'phosphorus'],
      ['hgb', 'hemoglobin'],
      ['plt', 'platelets'],
    ];
    for (const [printed, key] of cases) {
      expect(resolveAnalyte(printed).key, printed).toBe(key);
    }
  });

  it('resolves the display names and canonical keys', () => {
    expect(resolveAnalyte('Total cholesterol').key).toBe('total_cholesterol');
    expect(resolveAnalyte('total_cholesterol').key).toBe('total_cholesterol');
    expect(resolveAnalyte('Hgb A1c').key).toBe('hba1c');
  });

  it('falls back to the documented slug for an unrecognised name, never dropping it', () => {
    const name = 'Widget One';
    const resolution = resolveAnalyte(name);
    expect(resolution.analyte).toBeNull();
    expect(resolution.fallback).toBe(true);
    expect(resolution.key).toBe('widget_one');
    expect(slugFor(name)).toBe('widget_one');
    expect(slugFor('!!!')).toBe('unknown');
  });

  it('gives a display name from the registry, or the printed name when unknown', () => {
    expect(displayNameFor('alt')).toBe('Alanine aminotransferase');
    expect(displayNameFor('widget_one', 'Widget One')).toBe('Widget One');
    expect(displayNameFor('widget_one')).toBe('widget_one');
  });
});

describe('the exact legacy duplicate names carry disjoint bands', () => {
  it('resolves each of the three duplicate display names to one analyte', () => {
    expect(resolveAnalyte('Protein Total').key).toBe('total_protein');
    expect(resolveAnalyte('A/G Ratio').key).toBe('albumin_globulin_ratio');
    expect(resolveAnalyte('Ca').key).toBe('calcium');
  });
});

describe('every name in the registry resolves, by key or by alias', () => {
  // The guard this registry was missing. A name the registry itself publishes —
  // its canonical key, its display name or one of its aliases — must resolve
  // back to THAT entry. If it does not, the name is a hole: a stored row using
  // it renders with a generic name, no category, no unit and no description.
  it('resolves every canonical key, display name and alias to its own entry', () => {
    for (const analyte of ANALYTES) {
      const names = [analyte.key, analyte.displayName, ...analyte.aliases];
      for (const name of names) {
        expect(resolveAnalyte(name).analyte?.key, `${analyte.key} → ${name}`).toBe(analyte.key);
        expect(analyteByKey(name)?.key, `${analyte.key} → ${name} (by key)`).toBe(analyte.key);
      }
    }
  });
});

describe('the keys the owner’s stored rows already use', () => {
  // Measured from the live database: these 14 stored `analyte_key` values
  // resolved to no registry entry, so they rendered with no category, no unit
  // and no description. The keys come from the extractor's own alias table
  // (extract/parse.ts), which is frozen — the owner's rows are already stored
  // under them — so the REGISTRY is extended to cover them instead.
  const STORED_KEYS: Array<[string, string]> = [
    ['alkaline_phosphatase', 'alp'],
    ['basophils_pct', 'basophils_pct'],
    ['bilirubin_total', 'total_bilirubin'],
    ['calculated_bun_creat', 'bun_creatinine_ratio'],
    ['cholesterol_total', 'total_cholesterol'],
    ['co2', 'co2_bicarbonate'],
    ['eosinophils_pct', 'eosinophils_pct'],
    ['glucose', 'glucose'],
    ['hdl', 'hdl_c'],
    ['ldl', 'ldl_c'],
    ['lymphocytes_pct', 'lymphocytes_pct'],
    ['monocytes_pct', 'monocytes_pct'],
    ['neutrophils_pct', 'neutrophils_pct'],
    ['protein_total', 'total_protein'],
  ];

  it('resolves every one of them to a registry entry', () => {
    for (const [stored, canonical] of STORED_KEYS) {
      const analyte = analyteByKey(stored);
      expect(analyte, stored).not.toBeNull();
      expect(analyte?.key, stored).toBe(canonical);
      // A resolved entry is what gives the card its name, its category, its
      // unit convention and its description.
      expect(analyte?.displayName.length ?? 0, stored).toBeGreaterThan(0);
      expect(analyte?.category, stored).toBeTruthy();
    }
  });

  it('keeps the differential percentage and the differential count apart', () => {
    // The percentage a report prints as `BA%` and the count it prints as `BA#`
    // are DIFFERENT analytes and must resolve to different entries, or one
    // series is charted against the other's interval. So must the two spellings
    // of the percentage itself: `basophils` (a bare `BASOPHILS`) and
    // `basophils_pct` (the `BA%` column) are two series, each named for what it
    // is — neither is an alias of the other, and neither renders as "Basophils".
    for (const [pct, abs] of [
      ['neutrophils_pct', 'neutrophils_abs'],
      ['lymphocytes_pct', 'lymphocytes_abs'],
      ['monocytes_pct', 'monocytes_abs'],
      ['eosinophils_pct', 'eosinophils_abs'],
      ['basophils_pct', 'basophils_abs'],
    ]) {
      expect(analyteByKey(pct)?.unit, pct).toContain('%');
      expect(analyteByKey(abs)?.unit, abs).toContain('/µL');
      expect(analyteByKey(pct)?.key, pct).not.toBe(analyteByKey(abs)?.key);
    }
    for (const bare of ['neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils']) {
      expect(analyteByKey(`${bare}_pct`)?.key, bare).toBe(`${bare}_pct`);
      expect(analyteByKey(bare)?.key, bare).toBe(bare);
      expect(analyteByKey(bare)?.displayName, bare).not.toBe(analyteByKey(`${bare}_pct`)?.displayName);
    }
  });

  it('keeps a bare glucose distinct from the fasting glucose entry', () => {
    // A report printing a bare "GLUCOSE" never states that the sample was
    // fasting, so it must NOT inherit the fasting interval.
    expect(analyteByKey('glucose')?.key).toBe('glucose');
    expect(analyteByKey('glucose')?.bands).toHaveLength(0);
    expect(analyteByKey('glucose_fasting')?.key).toBe('glucose_fasting');
    expect(analyteByKey('glucose_fasting')?.bands).toHaveLength(1);
    expect(resolveAnalyte('Glucose').key).toBe('glucose');
    expect(resolveAnalyte('Glucose, Fasting').key).toBe('glucose_fasting');
  });

  it('still treats a genuinely unknown key as unregistered', () => {
    expect(analyteByKey('widget_one')).toBeNull();
    expect(analyteByKey('some_new_marker')).toBeNull();
  });
});

describe('the LDL/HDL ratio the owner’s report prints', () => {
  it('is registered with a name, a category and a unit', () => {
    const ratio = analyteByKey('ldl_hdl_ratio');
    expect(ratio).not.toBeNull();
    expect(ratio?.displayName).toBe('LDL/HDL ratio');
    expect(ratio?.category).toBe('Lipids');
    expect(ratio?.unit).toBe('ratio');
    expect(ratio?.bands).toHaveLength(0);
    expect(ratio?.note ?? '').toContain('unscored');
  });
});