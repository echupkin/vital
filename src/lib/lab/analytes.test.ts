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
      ['NE%', 'neutrophils'],
      ['LY%', 'lymphocytes'],
      ['MO%', 'monocytes'],
      ['EO%', 'eosinophils'],
      ['BA%', 'basophils'],
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