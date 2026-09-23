import { describe, it, expect } from 'vitest';
import {
  allowanceFor,
  ageOn,
  bandForObservation,
  flagDirection,
  isScored,
  labelFor,
  resolveBand,
  resolveIntervalFor,
  scoreResult,
  toneFor,
  SLIGHTLY_OUT_FRACTION,
  type StatusInput,
} from './status';
import { analyteByKey, type LabBand } from './analytes';

const twoSided: LabBand = {
  sex: 'any',
  low: 10,
  high: 20,
  refText: '10-20',
  source: 'textbook',
  sourceUrl: 'https://example.test',
};

function score(input: Partial<StatusInput>): ReturnType<typeof scoreResult> {
  return scoreResult({
    value: null,
    valueText: null,
    refLow: null,
    refHigh: null,
    printedFlag: null,
    ...input,
  });
}

describe('the boundary rule', () => {
  it('treats a value exactly at either endpoint as IN RANGE', () => {
    const low = score({ value: 10, refLow: 10, refHigh: 20 });
    const high = score({ value: 20, refLow: 10, refHigh: 20 });
    expect(low.status).toBe('in_range');
    expect(high.status).toBe('in_range');
    expect(low.tone).toBe('good');
  });

  it('puts a value just inside an endpoint in range and just outside in slightly_out', () => {
    expect(score({ value: 10.1, refLow: 10, refHigh: 20 }).status).toBe('in_range');
    expect(score({ value: 9.9, refLow: 10, refHigh: 20 }).status).toBe('slightly_out_low');
    expect(score({ value: 20.1, refLow: 10, refHigh: 20 }).status).toBe('slightly_out_high');
  });

  it('uses 10% of the interval WIDTH as the two-sided allowance', () => {
    // width 10 => allowance 1
    expect(allowanceFor(10, 20)).toBeCloseTo(1);
    expect(score({ value: 9, refLow: 10, refHigh: 20 }).status).toBe('slightly_out_low');
    expect(score({ value: 8.99, refLow: 10, refHigh: 20 }).status).toBe('out_low');
    expect(score({ value: 21, refLow: 10, refHigh: 20 }).status).toBe('slightly_out_high');
    expect(score({ value: 21.01, refLow: 10, refHigh: 20 }).status).toBe('out_high');
  });

  it('exposes the percentage as the documented presentation constant', () => {
    expect(SLIGHTLY_OUT_FRACTION).toBe(0.1);
  });
});

describe('one-sided intervals', () => {
  it('uses 10% of the single endpoint as the allowance on a "<high" interval', () => {
    // <200 mg/dL => allowance 20
    expect(allowanceFor(null, 200)).toBeCloseTo(20);
    expect(score({ value: 200, refHigh: 200 }).status).toBe('in_range');
    expect(score({ value: 210, refHigh: 200 }).status).toBe('slightly_out_high');
    expect(score({ value: 220.1, refHigh: 200 }).status).toBe('out_high');
    // Nothing on the low side, so a tiny value is still in range.
    expect(score({ value: 5, refHigh: 200 }).status).toBe('in_range');
  });

  it('uses 10% of the single endpoint as the allowance on a ">low" interval', () => {
    // >40 => allowance 4
    expect(allowanceFor(40, null)).toBeCloseTo(4);
    expect(score({ value: 40, refLow: 40 }).status).toBe('in_range');
    expect(score({ value: 36, refLow: 40 }).status).toBe('slightly_out_low');
    expect(score({ value: 35.9, refLow: 40 }).status).toBe('out_low');
    expect(score({ value: 500, refLow: 40 }).status).toBe('in_range');
  });
});

describe('unscored outcomes', () => {
  it('leaves a result with no interval and no band unscored', () => {
    const result = score({ value: 5 });
    expect(result.status).toBe('unscored_no_range');
    expect(result.tone).toBe('neutral');
    expect(isScored(result.status)).toBe(false);
    expect(result.interval.origin).toBe('none');
  });

  it('leaves a non-numeric result unscored, and says what was printed', () => {
    const result = score({ value: null, valueText: 'Negative', refLow: 0, refHigh: 1 });
    expect(result.status).toBe('unscored_non_numeric');
    expect(result.tone).toBe('neutral');
    expect(result.notes.join(' ')).toContain('Negative');
  });

  it('does not score a value when only valueText is present', () => {
    expect(score({ valueText: 'TRACE', refLow: 0, refHigh: 10 }).status).toBe('unscored_non_numeric');
  });
});

describe('the printed interval wins over a fallback band', () => {
  it('uses the printed interval and ignores the band', () => {
    const interval = resolveIntervalFor({ refLow: 4, refHigh: 6, band: twoSided });
    expect(interval.origin).toBe('report');
    expect(interval.low).toBe(4);
    expect(interval.high).toBe(6);
  });

  it('falls back to the band only when nothing was printed', () => {
    const interval = resolveIntervalFor({ refLow: null, refHigh: null, band: twoSided });
    expect(interval.origin).toBe('reference_table');
    expect(interval.low).toBe(10);
    expect(interval.bandNote).toBeNull();
  });

  it('labels a fallback interval as a general reference interval, not a personal one', () => {
    const result = scoreResult({
      value: 15,
      valueText: null,
      refLow: null,
      refHigh: null,
      printedFlag: null,
      band: twoSided,
    });
    expect(result.status).toBe('in_range');
    expect(result.notes.join(' ')).toContain('general reference interval');
  });
});

describe('a printed flag is corroboration only', () => {
  it('agrees silently when the flag matches the interval verdict', () => {
    const result = score({ value: 25, refLow: 10, refHigh: 20, printedFlag: 'H' });
    expect(result.status).toBe('out_high');
    expect(result.notes).toHaveLength(0);
  });

  it('keeps the interval verdict when the flag disagrees, and records a note', () => {
    const result = score({ value: 15, refLow: 10, refHigh: 20, printedFlag: 'H' });
    expect(result.status).toBe('in_range');
    expect(result.notes.join(' ')).toContain('corroboration only');
  });

  it('records a note when the flag points the other way', () => {
    const result = score({ value: 25, refLow: 10, refHigh: 20, printedFlag: 'L' });
    expect(result.status).toBe('out_high');
    expect(result.notes.join(' ')).toContain('corroboration only');
  });

  it('never scores from the flag alone when there is no interval', () => {
    const result = score({ value: 300, printedFlag: 'HH' });
    expect(result.status).toBe('unscored_no_range');
  });

  it('ignores an unrecognised marker token but says so', () => {
    const result = score({ value: 15, refLow: 10, refHigh: 20, printedFlag: 'A' });
    expect(result.status).toBe('in_range');
    expect(result.notes.join(' ')).toContain('not a recognised');
  });
});

describe('flag classification', () => {
  it('classifies the tokens a report prints', () => {
    expect(flagDirection('H')).toBe('high');
    expect(flagDirection('HH')).toBe('high');
    expect(flagDirection('High')).toBe('high');
    expect(flagDirection('L')).toBe('low');
    expect(flagDirection('LL')).toBe('low');
    expect(flagDirection('Low')).toBe('low');
    expect(flagDirection('A')).toBeNull();
    expect(flagDirection('')).toBeNull();
    expect(flagDirection(null)).toBeNull();
  });
});

describe('labels and tones', () => {
  it('gives every status a label and a tone, so colour is never the only signal', () => {
    for (const status of [
      'in_range',
      'slightly_out_low',
      'slightly_out_high',
      'out_low',
      'out_high',
      'unscored_no_range',
      'unscored_non_numeric',
    ] as const) {
      expect(labelFor(status).length).toBeGreaterThan(0);
      expect(['good', 'caution', 'attention', 'neutral']).toContain(toneFor(status));
    }
  });
});

describe('age from a date of birth', () => {
  it('computes whole years at the observation date', () => {
    expect(ageOn('1980-06-15', '2026-06-14')).toBe(45);
    expect(ageOn('1980-06-15', '2026-06-15')).toBe(46);
    expect(ageOn('1980-06-15', '2026-06-16')).toBe(46);
  });

  it('returns null when either date is missing or unreadable', () => {
    expect(ageOn(null, '2026-01-01')).toBeNull();
    expect(ageOn('1980-01-01', null)).toBeNull();
    expect(ageOn('not-a-date', '2026-01-01')).toBeNull();
    expect(ageOn('1980-01-01', '2026-13-40')).toBeNull();
  });
});

describe('band selection', () => {
  const maleAdult: LabBand = { ...twoSided, sex: 'male', refText: 'M 10-20' };
  const femaleAdult: LabBand = { ...twoSided, sex: 'female', refText: 'F 8-18', low: 8, high: 18 };
  const maleAge: LabBand = { ...twoSided, sex: 'male', minAge: 40, maxAge: 54, refText: 'M 40-54 12-22' };

  it('uses a sex-specific band when the sex is set', () => {
    const picked = resolveBand([maleAdult, femaleAdult], { age: 45, sex: 'male' });
    expect(picked.band?.refText).toBe('M 10-20');
  });

  it('does NOT use a sex-specific band when the sex is unset, and says why', () => {
    const picked = resolveBand([maleAdult, femaleAdult], { age: 45, sex: null });
    expect(picked.band).toBeNull();
    expect(picked.reason).toBe('sex_unset');
  });

  it('prefers the age-constrained band that spans the person', () => {
    const picked = resolveBand([maleAdult, maleAge], { age: 45, sex: 'male' });
    expect(picked.band?.refText).toBe('M 40-54 12-22');
  });

  it('falls back to the unconstrained band outside the age window', () => {
    const picked = resolveBand([maleAdult, maleAge], { age: 70, sex: 'male' });
    expect(picked.band?.refText).toBe('M 10-20');
  });

  it('includes a band whose boundary is exactly the age', () => {
    expect(resolveBand([maleAge], { age: 40, sex: 'male' }).band).not.toBeNull();
    expect(resolveBand([maleAge], { age: 54, sex: 'male' }).band).not.toBeNull();
  });

  it('refuses an age-bound band when the age is unknown, and says why', () => {
    const picked = resolveBand([maleAge], { age: null, sex: 'male' });
    expect(picked.band).toBeNull();
    expect(picked.reason).toBe('age_unknown');
  });

  it('reports no_bands when the analyte has none', () => {
    expect(resolveBand([], { age: 40, sex: 'male' }).reason).toBe('no_bands');
    expect(resolveBand(null, { age: 40, sex: 'male' }).reason).toBe('no_bands');
  });

  it('resolves the band for an observation through bandForObservation', () => {
    const picked = bandForObservation([maleAdult], { dateOfBirth: '1980-06-15', sex: 'male' }, '2026-06-15');
    expect(picked.band?.refText).toBe('M 10-20');
  });

  it('leaves the band unusable when the profile has no sex', () => {
    const picked = bandForObservation([maleAdult], { dateOfBirth: '1980-01-01', sex: null }, '2026-01-01');
    expect(picked.band).toBeNull();
    expect(picked.reason).toBe('sex_unset');
  });
});

// ── sex-specific bands against the real registry ────────────────────────────
//
// `profile.sex` exists for exactly one job, and this is it. `creatinine` in the
// registry carries ONLY sex-specific bands, so it is the honest witness: with sex
// set the fallback interval applies, with sex unset there is no interval at all
// and the result stays unscored — the reason is recorded, and nothing is silently
// banded by an assumed sex.

describe('sex-specific bands are used only when sex is set', () => {
  const creatinine = analyteByKey('creatinine')!;

  function scoreCreatinine(sex: 'male' | 'female' | null) {
    const selection = bandForObservation(creatinine.bands, { dateOfBirth: '1980-06-15', sex }, '2026-06-15');
    const scored = scoreResult({
      value: 1.2,
      valueText: null,
      refLow: null,
      refHigh: null,
      printedFlag: null,
      band: selection.band,
    });
    return { scored, selection };
  }

  it('scores against the sex-specific band when the sex is set', () => {
    const { scored, selection } = scoreCreatinine('male');
    expect(scored.status).toBe('in_range');
    expect(scored.interval.origin).toBe('reference_table');
    expect(scored.interval.refBasis).toContain('male');
    expect(selection.reason).toBeNull();
  });

  it('leaves the result UNSCORED with the sex_unset reason when sex is unset', () => {
    const { scored, selection } = scoreCreatinine(null);
    expect(scored.status).toBe('unscored_no_range');
    expect(scored.tone).toBe('neutral');
    expect(scored.interval.origin).toBe('none');
    expect(scored.interval.band).toBeNull();
    expect(selection.band).toBeNull();
    expect(selection.reason).toBe('sex_unset');
    // It is never quietly scored against either sex's band.
    expect(scored.interval.low).toBeNull();
    expect(scored.interval.high).toBeNull();
  });

  it('picks a different band for each sex, so neither is a default', () => {
    expect(scoreCreatinine('male').scored.interval.low).not.toBe(
      scoreCreatinine('female').scored.interval.low
    );
  });
});