// ── Tests for the Lab palette destinations ──────────────────────────────────
//
// The palette indexes wearable metric names; it must index the lab analytes too,
// or a reader searching for a name the Lab page renders would be told there is
// no such thing.

import { describe, it, expect } from 'vitest';
import { labDestinationFor, searchLabAnalytes } from './search';

describe('lab destinations for the command palette', () => {
  it('offers a real route for a registered analyte', () => {
    const destination = labDestinationFor('ldl_c');
    expect(destination).not.toBeNull();
    expect(destination!.href).toBe('/lab/ldl_c');
    expect(destination!.label).toBe('LDL cholesterol');
    expect(destination!.description).toContain('Lipids');
  });

  it('offers nothing for a key the registry does not know', () => {
    expect(labDestinationFor('widget_one')).toBeNull();
  });

  it('finds an analyte by its display name, key or alias', () => {
    expect(searchLabAnalytes('LDL cholesterol').map(d => d.href)).toContain('/lab/ldl_c');
    expect(searchLabAnalytes('triglycerides').map(d => d.href)).toContain('/lab/triglycerides');
    expect(searchLabAnalytes('HbA1c').map(d => d.href)).toContain('/lab/hba1c');
  });

  it('returns nothing for a query too short to be one', () => {
    expect(searchLabAnalytes('')).toEqual([]);
    expect(searchLabAnalytes('l')).toEqual([]);
  });

  it('returns nothing for a name no analyte carries', () => {
    expect(searchLabAnalytes('zzzznotanalabtest')).toEqual([]);
  });

  it('caps how many analytes one query may add to the palette', () => {
    expect(searchLabAnalytes('a', 3)).toHaveLength(0); // too short
    expect(searchLabAnalytes('ol', 2).length).toBeLessThanOrEqual(2);
  });
});