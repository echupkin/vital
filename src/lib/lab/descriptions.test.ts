// ── Tests for the analyte descriptions ──────────────────────────────────────
//
// Two things are pinned here. First, the copy is RENDERED VERBATIM: what the UI
// shows is the string the audit pass checked against the cited page, never a
// trimmed or reflowed version. Second, the lookup is by WHAT THE ANALYTE IS: a
// stored key the extractor wrote (`protein_total`) finds the description of its
// registry entry (`total_protein`), and an analyte with no entry returns null so
// the UI renders nothing rather than a placeholder.
//
// The coverage tests at the bottom are DATA COVERAGE, not counts: they fail when
// a key the owner's data actually uses stops resolving to a registry entry, when
// a urinalysis analyte loses its copy, or when an entry without copy is not one
// the registry declares as derived. None of them pins how MANY entries exist —
// that number is expected to grow as the research pass describes more analytes.

import { describe, it, expect } from 'vitest';
import raw from './analyte-descriptions.json';
import { ANALYTES, UNDESCRIBED_BY_DESIGN, analyteByKey } from './analytes';
import { DESCRIBED_KEYS, analyteDescription, descriptionForSeries, seriesDescription, type AnalyteDescription } from './descriptions';

const RAW: Record<string, AnalyteDescription> = raw as unknown as Record<string, AnalyteDescription>;

/**
 * Every analyte key the owner's imported data uses, measured from the live
 * database. A key that resolves to no registry entry is a silent hole: the Lab
 * page shows it under "Other" with no name of its own and the detail route
 * renders nothing, and the urinalysis series would have no copy to fall back on.
 */
const STORED_KEYS = [
  'absolute_basophils',
  'absolute_eosinophils',
  'absolute_lymphocytes',
  'absolute_monocytes',
  'absolute_neutrophils',
  'adiponectin',
  'albumin',
  'albumin_globulin_ratio',
  'alkaline_phosphatase',
  'alt',
  'anion_gap',
  'apolipoprotein_b',
  'appearance',
  'ast',
  'bacteria',
  'basophils',
  'basophils_abs',
  'basophils_pct',
  'bilirubin',
  'bilirubin_direct',
  'bilirubin_indirect',
  'bilirubin_total',
  'bun',
  'c_peptide',
  'calcium',
  'calculated_bun_creat',
  'carbon_dioxide',
  'chloride',
  'chol_hdlc_ratio',
  'cholesterol_hdl_ratio',
  'cholesterol_total',
  'co2',
  'color',
  'cortisol_total',
  'creatinine',
  'dhea_sulfate',
  'eag_mg_dl',
  'eag_mmol_l',
  'egfr',
  'eosinophils',
  'eosinophils_abs',
  'eosinophils_pct',
  'estimated_average_glucose',
  'estradiol',
  'ferritin',
  'free_t4_index_t7',
  'fructosamine',
  'fsh',
  'ggt',
  'globulin',
  'glucose',
  'hba1c',
  'hdl',
  'hematocrit',
  'hemoglobin',
  'hemoglobin_a1c',
  'hs_crp',
  'hyaline_cast',
  'insulin',
  'iron_binding_capacity',
  'iron_total',
  'ketones',
  'ldl',
  'ldl_hdl_ratio',
  'leptin',
  'leukocyte_esterase',
  'lh',
  'lymphocytes',
  'lymphocytes_abs',
  'lymphocytes_pct',
  'mch',
  'mchc',
  'mcv',
  'monocytes',
  'monocytes_abs',
  'monocytes_pct',
  'mpv',
  'neutrophils',
  'neutrophils_abs',
  'neutrophils_pct',
  'nitrite',
  'non_hdl_cholesterol',
  'occult_blood',
  'ph',
  'platelets',
  'potassium',
  'protein',
  'protein_total',
  'rbc',
  'rdw',
  'red_blood_cell_count',
  'saturation',
  'sex_hormone_binding_globulin',
  'sodium',
  'specific_gravity',
  'squamous_epithelial_cells',
  't3_uptake',
  't4_thyroxine_total',
  'testosterone_bioavailable',
  'testosterone_free',
  'triglycerides',
  'tsh',
  'urea_nitrogen_bun',
  'uric_acid',
  'vitamin_d_25_oh_total_ia',
  'wbc',
  'white_blood_cell_count',
];

/**
 * The urine-only analytes the owner's reports print. Every one is a qualitative
 * dipstick or sediment reading, so each needs BOTH a registry entry (under the
 * Urinalysis category, never "Other") and the copy to go with it.
 */
const URINALYSIS_KEYS = [
  'appearance',
  'bacteria',
  'bilirubin',
  'color',
  'hyaline_cast',
  'ketones',
  'leukocyte_esterase',
  'nitrite',
  'occult_blood',
  'ph',
  'protein',
  'specific_gravity',
  'squamous_epithelial_cells',
];

describe('the description file', () => {
  it('has an entry for every key it declares, and every one is a registry key', () => {
    expect(DESCRIBED_KEYS.length).toBeGreaterThan(0);
    for (const key of DESCRIBED_KEYS) {
      // A description keyed to a name the registry does not know could never be
      // reached by the UI, so it would be a silent hole.
      expect(analyteByKey(key)?.key, key).toBe(key);
    }
  });

  it('declares only an allowed specimen, and only where the registry agrees', () => {
    // The imported JSON widens `specimen` to a plain string (see descriptions.ts),
    // so this pins the VALUE: a mistyped specimen would otherwise make an entry
    // silently unreachable, which is exactly the failure the cast could hide.
    for (const key of DESCRIBED_KEYS) {
      const specimen = RAW[key]!.specimen;
      if (specimen === undefined) continue;
      expect(['urine', 'other'], key).toContain(specimen);
    }
    // The specimen declared today is `urine`, and only on the urinalysis entries:
    // an entry that claims to describe urine must be a urine analyte.
    for (const key of DESCRIBED_KEYS) {
      if (RAW[key]!.specimen === 'urine') {
        expect(analyteByKey(key)?.category, key).toBe('Urinalysis');
      }
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
    // The extractor's own keys resolve to the registry's canonical entries: the
    // stored spelling stays as it is, and the copy is still found.
    expect(analyteDescription('protein_total')?.whatItIs).toBe(RAW.total_protein!.whatItIs);
    expect(analyteDescription('cholesterol_total')?.whatItIs).toBe(RAW.total_cholesterol!.whatItIs);
    expect(analyteDescription('bilirubin_total')?.whatItIs).toBe(RAW.total_bilirubin!.whatItIs);
    expect(analyteDescription('hdl')?.whatItIs).toBe(RAW.hdl_c!.whatItIs);
    expect(analyteDescription('co2')?.whatItIs).toBe(RAW.co2_bicarbonate!.whatItIs);
    expect(analyteDescription('alkaline_phosphatase')?.whatItIs).toBe(RAW.alp!.whatItIs);
    expect(analyteDescription('hemoglobin_a1c')?.whatItIs).toBe(RAW.hba1c!.whatItIs);
    expect(analyteDescription('iron_total')?.whatItIs).toBe(RAW.iron!.whatItIs);
  });

  it('returns null — never an invented or borrowed entry — when there is none', () => {
    // A key nobody knows, an entry the research pass deliberately left undescribed,
    // and empty input all render NOTHING rather than a placeholder.
    expect(analyteDescription('widget_one')).toBeNull();
    expect(analyteDescription('')).toBeNull();
    expect(analyteDescription('differential_percent')).toBeNull();

    // And an entry renders its OWN copy, never a neighbour's: `glucose` is the
    // serum glucose of a chemistry panel, and it must not borrow the audited
    // FASTING entry's text, which would assert a fasting state no document printed.
    expect(analyteDescription('glucose')?.whatItIs).toBe(RAW.glucose!.whatItIs);
    expect(analyteDescription('glucose')?.whatItIs).not.toBe(RAW.glucose_fasting!.whatItIs);
  });

  it('resolves every stored key the owner’s data uses, and describes all but the declared derived', () => {
    // EVERY stored key, resolved. A key the extractor wrote that the registry does
    // not know is a hole in the Lab page; this is the assertion that catches it.
    const unresolved = STORED_KEYS.filter(key => analyteByKey(key) === null);
    expect(unresolved).toEqual([]);

    // Undescribed is allowed ONLY where the registry declares it (a derived row or
    // a duplicate spelling): anywhere else it means copy was dropped by accident.
    const declared = new Set(UNDESCRIBED_BY_DESIGN);
    const undeclared = STORED_KEYS.filter(key => {
      const entry = analyteByKey(key);
      if (entry === null || analyteDescription(key) !== null) return false;
      return !declared.has(entry.key);
    });
    expect(undeclared).toEqual([]);

    // The two stored spellings of one percentage resolve to ONE canonical
    // analyte, and that analyte resolves a description: the merged series is
    // never left bare. The absolute count is a different key and keeps its own,
    // separate copy, so a reader can never confuse the two.
    for (const cell of ['neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils']) {
      expect(analyteByKey(cell)?.key, cell).toBe(`${cell}_pct`);
      expect(analyteByKey(`${cell}_pct`)?.key, cell).toBe(`${cell}_pct`);
      expect(analyteDescription(cell), cell).not.toBeNull();
      expect(analyteDescription(`${cell}_pct`), cell).not.toBeNull();
      expect(analyteDescription(cell)?.whatItIs, cell).toBe(analyteDescription(`${cell}_pct`)?.whatItIs);
      expect(analyteByKey(`${cell}_abs`)?.key, cell).toBe(`${cell}_abs`);
      expect(analyteDescription(`${cell}_abs`), cell).not.toBeNull();
      expect(analyteDescription(`${cell}_abs`)?.whatItIs, cell).not.toBe(analyteDescription(cell)?.whatItIs);
    }
  });

  it('describes every urinalysis analyte, under the Urinalysis category', () => {
    for (const key of URINALYSIS_KEYS) {
      const entry = analyteByKey(key);
      // A dipstick row that fell to "Other" would sit among the blood chemistry
      // with no copy and nothing saying it came from urine.
      expect(entry?.category, key).toBe('Urinalysis');
      expect(analyteDescription(key), key).not.toBeNull();
    }
  });

  it('leaves exactly the declared derived and duplicate entries without copy', () => {
    // Neither a frozen count nor a frozen list of holes: the set of entries with
    // no copy must EQUAL the set the registry declares, so removing a description
    // by accident fails, and a new entry with no copy fails until it is declared.
    const withoutCopy = ANALYTES.filter(entry => analyteDescription(entry.key) === null).map(
      entry => entry.key
    );
    expect(withoutCopy.sort()).toEqual([...UNDESCRIBED_BY_DESIGN].sort());

    // And a declared omission is a decision with a reason: the entry is unscored
    // (no bands to band a value against) and says why in its own note.
    for (const key of UNDESCRIBED_BY_DESIGN) {
      const entry = analyteByKey(key);
      expect(entry, key).not.toBeNull();
      expect(entry?.bands ?? [], key).toEqual([]);
      expect((entry?.note ?? '').trim().length, key).toBeGreaterThan(0);
    }
  });
});

// ── Resolution per series ────────────────────────────────────────────────────
//
// A description is resolved for a SERIES — an analyte together with the specimen
// its rows were printed under — and not for the analyte key alone, because one
// key can name two different measurements: `glucose` is blood sugar on a
// chemistry panel and a dipstick reading on a urinalysis one. The
// specimen-qualified entry (`<key>_<specimen>`) wins; the base entry is used ONLY
// when its own specimen does not contradict the series'. A series no honest
// entry describes resolves to null, which the UI renders as NOTHING — the same
// convention an analyte with no entry has always followed.

describe('a series resolves the copy of its own specimen', () => {
  const source = { sourceTitle: 'Fixture source', sourceUrl: 'https://example.invalid/page' };

  /** A fixture: one analyte key measured on two specimens, each with its own copy. */
  const TWO_SPECIMENS: Record<string, AnalyteDescription> = {
    glucose: { whatItIs: 'the non-urine copy', ...source },
    glucose_urine: { whatItIs: 'the urine copy', specimen: 'urine', ...source },
  };

  /** The shipped shape today: a base entry and no urine-qualified copy written yet. */
  const NO_URINE_COPY: Record<string, AnalyteDescription> = {
    glucose: { whatItIs: 'the non-urine copy', ...source },
  };

  it('prefers the specimen-qualified entry over the base one', () => {
    expect(descriptionForSeries(TWO_SPECIMENS, 'glucose', 'urine')?.whatItIs).toBe('the urine copy');
    expect(descriptionForSeries(TWO_SPECIMENS, 'glucose', 'other')?.whatItIs).toBe('the non-urine copy');
  });

  it('never serves one specimen’s copy to a series of the other specimen', () => {
    // THE ASSERTION THIS GATE EXISTS FOR: with no urine copy written, the urine
    // series of a key whose base entry describes the other specimen must resolve
    // to NOTHING rather than borrow the base copy.
    expect(descriptionForSeries(NO_URINE_COPY, 'glucose', 'urine')).toBeNull();
    expect(descriptionForSeries(NO_URINE_COPY, 'glucose', 'other')?.whatItIs).toBe('the non-urine copy');

    // And against the SHIPPED copy: `glucose_urine` has no entry yet, so the real
    // `glucose` urine series resolves to null — the urine card shows no copy.
    expect(RAW['glucose_urine']).toBeUndefined();
    expect(seriesDescription('glucose', 'urine')).toBeNull();
    expect(seriesDescription('glucose', 'other')?.whatItIs).toBe(RAW.glucose!.whatItIs);
  });

  it('serves the base copy to a series whose specimen the entry does not contradict', () => {
    // A series the document made no specimen statement for is `other`, and the
    // base entry describes exactly that ordinary report — so it still shows.
    expect(seriesDescription('ldl_c', 'other')?.whatItIs).toBe(RAW.ldl_c!.whatItIs);
    expect(seriesDescription('ldl_c')?.whatItIs).toBe(RAW.ldl_c!.whatItIs);
  });

  it('serves a urine entry to the urine series of a urine-only analyte', () => {
    // A urinalysis entry declares its own specimen, so its series still finds it…
    expect(seriesDescription('nitrite', 'urine')?.whatItIs).toBe(RAW.nitrite!.whatItIs);
    // …and that urine copy is not served to a series of any other specimen.
    expect(seriesDescription('nitrite', 'other')).toBeNull();
  });

  it('renders no description element at all for an analyte with no entry', () => {
    // The component returns null when the resolver does (no card, no header, no
    // placeholder), so a null here is literally nothing on the page.
    expect(seriesDescription('widget_one', 'urine')).toBeNull();
    expect(seriesDescription('widget_one', 'other')).toBeNull();
    expect(seriesDescription('', 'urine')).toBeNull();
    expect(descriptionForSeries(TWO_SPECIMENS, 'widget_one', 'urine')).toBeNull();
  });
});
