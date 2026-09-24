// ── Tests for the panel/specimen reading ────────────────────────────────────
//
// The one thing this module decides is whether the heading a report printed says
// the row came from URINE. Everything else in the series split follows from it, so
// the reading is pinned here rather than through the store or the page.

import { describe, it, expect } from 'vitest';
import { analyteKeyOfSeriesId, isUrinePanel, seriesIdOf, seriesNameOf, specimenOfPanel } from './panel';

describe('reading a specimen out of a panel heading', () => {
  it('takes the document at its word when the heading names a urinalysis', () => {
    expect(isUrinePanel('URINALYSIS, COMPLETE')).toBe(true);
    expect(isUrinePanel('URINALYSIS, MICROSCOPIC WITH REFLEX TO CULTURE')).toBe(true);
    expect(isUrinePanel('Urine protein, random')).toBe(true);
    expect(isUrinePanel('24 hour urine collection')).toBe(true);
    // The lab's own trend export name, which is the only place such a document
    // states what it covers.
    expect(isUrinePanel('Result Trends - Urinalysis - Sep 14, 2026')).toBe(true);
  });

  it('claims nothing else', () => {
    for (const heading of [
      'COMPREHENSIVE METABOLIC PANEL',
      'LIPID PANEL WITH RATIOS',
      'CBC (INCLUDES DIFF/PLT)',
      'THYROID PANEL WITH TSH',
      'TESTOSTERONE, FREE, BIOAVAILABLE AND TOTAL, MS',
      'Metabolic,Comprehensive',
      'Hemoglobin A1C-Hplc',
    ]) {
      expect(isUrinePanel(heading), heading).toBe(false);
    }
  });

  it('treats a page that printed no heading as making NO statement about the specimen', () => {
    // Not urine: the row keeps the analyte's ordinary series rather than being
    // moved into the urine one on a guess.
    expect(specimenOfPanel(null)).toBe('other');
    expect(specimenOfPanel(undefined)).toBe('other');
    expect(specimenOfPanel('')).toBe('other');
    expect(specimenOfPanel('URINALYSIS, COMPLETE')).toBe('urine');
  });
});

describe('naming a series', () => {
  it('keeps the bare key for an analyte that was not split', () => {
    expect(seriesIdOf('protein', 'urine', false)).toBe('protein');
    expect(seriesNameOf('Protein', 'urine', false)).toBe('Protein');
    expect(seriesIdOf('glucose', 'other', false)).toBe('glucose');
  });

  it('gives each specimen of a split analyte its own id and label', () => {
    expect(seriesIdOf('glucose', 'urine', true)).toBe('glucose~urine');
    expect(seriesIdOf('glucose', 'other', true)).toBe('glucose');
    expect(seriesNameOf('Glucose', 'urine', true)).toBe('Glucose (urine)');
    expect(seriesNameOf('Glucose', 'other', true)).toBe('Glucose (blood)');
  });

  it('reads the analyte key back out of a series id', () => {
    expect(analyteKeyOfSeriesId('glucose~urine')).toBe('glucose');
    // An id with no specimen suffix IS the analyte key, including any key that
    // happens to carry a character the separator does not use.
    expect(analyteKeyOfSeriesId('glucose')).toBe('glucose');
    expect(analyteKeyOfSeriesId('vitamin_d_25oh')).toBe('vitamin_d_25oh');
  });
});
