// ── The closed qualitative vocabulary (pure) ─────────────────────────────────
//
// The importer interprets EXACTLY THREE words, case-insensitively: POSITIVE,
// NEGATIVE, NONE SEEN. This module is the one place that rule lives, so the
// importer and the read-time status engine cannot disagree about a row. The
// tests below pin the closure itself — what is in the vocabulary, what a
// per-field suffix does, and that anything else is refused rather than guessed.

import { describe, expect, it } from 'vitest';
import {
  DESCRIPTIVE_ANALYTES,
  QUALITATIVE_VOCABULARY,
  descriptiveNote,
  isDescriptiveAnalyte,
  qualitativeWord,
  resolveQualitative,
  stripFieldSuffix,
  uninterpretedNote,
  unresolvedNote,
} from './qualitative';

describe('the vocabulary is closed', () => {
  it('contains three words and no more', () => {
    const words = QUALITATIVE_VOCABULARY.split(',').map(word => word.trim());
    expect(words).toEqual(['POSITIVE', 'NEGATIVE', 'NONE SEEN']);
  });

  it('reads the three words case-insensitively, with the report’s own spacing', () => {
    expect(qualitativeWord('POSITIVE')).toBe('positive');
    expect(qualitativeWord('positive')).toBe('positive');
    expect(qualitativeWord('  Negative  ')).toBe('negative');
    expect(qualitativeWord('NONE  SEEN')).toBe('none_seen');
    expect(qualitativeWord('None seen')).toBe('none_seen');
  });

  it('refuses every other non-numeric word', () => {
    for (const word of ['YELLOW', 'TRACE', 'CLEAR', '1+', '2+', 'SEE NOTE:', 'WITHIN NORMAL LIMITS']) {
      expect(qualitativeWord(word), word).toBeNull();
    }
    expect(qualitativeWord('')).toBeNull();
    expect(qualitativeWord(null)).toBeNull();
    expect(qualitativeWord(undefined)).toBeNull();
  });
});

describe('a per-field suffix', () => {
  it('is dropped for the comparison and never changes what was seen', () => {
    expect(stripFieldSuffix('NONE SEEN /HPF')).toBe('NONE SEEN');
    expect(stripFieldSuffix('NONE SEEN /LPF')).toBe('NONE SEEN');
    expect(stripFieldSuffix('NONE SEEN')).toBe('NONE SEEN');
    expect(stripFieldSuffix('NONE SEEN / hpf')).toBe('NONE SEEN');
  });

  it('does not make a word from outside the vocabulary interpretable', () => {
    expect(qualitativeWord('YELLOW /HPF')).toBeNull();
    expect(qualitativeWord('1+ /HPF')).toBeNull();
  });
});

describe('resolving a qualitative result', () => {
  it('returns null for a result that is not in the vocabulary at all', () => {
    expect(resolveQualitative({ valueText: 'YELLOW', expectedText: 'YELLOW' })).toBeNull();
    expect(resolveQualitative({ valueText: '1+', expectedText: 'NEGATIVE' })).toBeNull();
  });

  it('calls a match in range and says the basis is the printed expectation', () => {
    const resolved = resolveQualitative({ valueText: 'NEGATIVE', expectedText: 'NEGATIVE' });
    expect(resolved?.status).toBe('in_range');
    expect(resolved?.note).toMatch(/matches the expected value the report printed/i);
    expect(resolved?.note).toMatch(/No number is involved/i);
  });

  it('calls a polarity the other way out of the report’s own expectation', () => {
    expect(resolveQualitative({ valueText: 'POSITIVE', expectedText: 'NEGATIVE' })?.status).toBe(
      'out_of_expected'
    );
    expect(resolveQualitative({ valueText: 'NEGATIVE', expectedText: 'POSITIVE' })?.status).toBe(
      'out_of_expected'
    );
    const note = resolveQualitative({ valueText: 'POSITIVE', expectedText: 'NEGATIVE' })?.note ?? '';
    expect(note).toMatch(/the report prints NEGATIVE as the expected result/i);
    expect(note).toMatch(/not a diagnosis/i);
  });

  it('reads NONE SEEN as zero and lets it satisfy an upper limit at or above zero', () => {
    const resolved = resolveQualitative({
      valueText: 'NONE SEEN',
      expectedText: '< OR = 5 /HPF',
      upperLimit: true,
      upperLimitValue: 5,
    });
    expect(resolved?.status).toBe('in_range');
    expect(resolved?.note).toMatch(/Nothing was seen/i);
    expect(resolved?.note).toMatch(/upper limit/i);
  });

  it('does not let zero satisfy an upper limit BELOW zero', () => {
    const resolved = resolveQualitative({
      valueText: 'NONE SEEN',
      expectedText: '< -1',
      upperLimit: true,
      upperLimitValue: -1,
    });
    expect(resolved?.status).toBe('out_of_expected');
    expect(resolved?.note).toMatch(/BELOW zero/i);
  });

  it('accepts an upper limit written with the report’s stranded `<`', () => {
    expect(
      resolveQualitative({ valueText: 'NONE SEEN', expectedText: '< OR = 2 /HPF' })?.status
    ).toBe('in_range');
  });

  it('does not guess at a combination the vocabulary does not cover', () => {
    // NEGATIVE against a printed count of `<5`: the polarity rule needs a
    // POSITIVE/NEGATIVE pair, and the zero rule needs `NONE SEEN`.
    expect(resolveQualitative({ valueText: 'NEGATIVE', expectedText: '<5' })).toBeNull();
    expect(resolveQualitative({ valueText: 'POSITIVE', expectedText: 'NONE SEEN' })).toBeNull();
    expect(resolveQualitative({ valueText: 'NONE SEEN', expectedText: 'NEGATIVE' })).toBeNull();
  });

  it('does not resolve a vocabulary word when the report printed no expectation', () => {
    expect(resolveQualitative({ valueText: 'NEGATIVE', expectedText: null })).toBeNull();
  });
});

describe('the wording of a refusal', () => {
  it('names the vocabulary when the word is not in it', () => {
    const note = uninterpretedNote('YELLOW', 'YELLOW');
    expect(note).toMatch(/not one of the qualitative values this importer interprets/);
    expect(note).toMatch(/POSITIVE, NEGATIVE, NONE SEEN/);
    expect(note).toMatch(/no number is invented/i);
  });

  it('says no expectation was printed, when none was', () => {
    expect(uninterpretedNote('TRACE', null)).toMatch(/no expected value/);
    expect(unresolvedNote('NEGATIVE', '')).toMatch(/no expected value/);
  });

  it('says what was compared and that nothing was guessed, when the pair is unsupported', () => {
    const note = unresolvedNote('NEGATIVE', '<5');
    expect(note).toMatch(/"NEGATIVE"/);
    expect(note).toMatch(/"<5"/);
    expect(note).toMatch(/left unscored rather than guessed at/i);
  });
});

// ── The descriptive analytes, which are not an interpretation ────────────────

describe('the descriptive analytes', () => {
  it('is a short closed list, exactly COLOR and APPEARANCE', () => {
    expect(DESCRIPTIVE_ANALYTES).toEqual(['COLOR', 'APPEARANCE']);
  });

  it('matches the printed name whole, case- and spacing-insensitively', () => {
    expect(isDescriptiveAnalyte('COLOR')).toBe(true);
    expect(isDescriptiveAnalyte('color')).toBe(true);
    expect(isDescriptiveAnalyte('  Appearance ')).toBe(true);
    expect(isDescriptiveAnalyte('APPEARANCE')).toBe(true);
  });

  it('does not match a name that merely contains the word', () => {
    // The list is closed and matched whole: a name that happens to end in
    // "COLOR" is an ordinary measured analyte and keeps its warning.
    expect(isDescriptiveAnalyte('GAMMA COLOR')).toBe(false);
    expect(isDescriptiveAnalyte('COLOR TWO')).toBe(false);
    expect(isDescriptiveAnalyte('URINE COLOR')).toBe(false);
    expect(isDescriptiveAnalyte('KETONES')).toBe(false);
    expect(isDescriptiveAnalyte('')).toBe(false);
    expect(isDescriptiveAnalyte(null)).toBe(false);
  });

  it('explains that the row is a description, kept as text and not scored', () => {
    const note = descriptiveNote('YELLOW');
    expect(note).toMatch(/described rather than measured/i);
    expect(note).toMatch(/"YELLOW"/);
    expect(note).toMatch(/kept as text and is not scored/i);
  });

  it("quotes the report's own status word when one was printed, as the report's statement", () => {
    const note = descriptiveNote('CLEAR', 'In Range');
    expect(note).toMatch(/"CLEAR"/);
    expect(note).toMatch(/The report printed "In Range"/);
  });

  it('says nothing about a status word that was not printed', () => {
    expect(descriptiveNote('CLEAR', null)).not.toMatch(/status column/);
    expect(descriptiveNote('CLEAR', '   ')).not.toMatch(/status column/);
  });

  it('never turns a description into a number or a call', () => {
    const note = descriptiveNote('YELLOW', 'In Range');
    expect(note).not.toMatch(/\d/);
    expect(note).not.toMatch(/normal|abnormal|positive|negative/i);
  });
});
