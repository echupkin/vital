// ── Lab analyte registry ─────────────────────────────────────────────────────
//
// The code-side registry of lab analytes, keyed by canonical `key`, with the
// reference bands the app may fall back to when an uploaded report prints no
// interval of its own.
//
// WHERE EVERY NUMBER HERE COMES FROM. This file is a transcription of
// lab-reference-intervals.md (the cited fallback table the research pass
// produced) and of nothing else. Each band carries its own `source` and
// `sourceUrl`, and the flags the document raises (assay-dependent,
// threshold-not-interval, two sources disagreeing) are carried through as the
// band's `note` so the UI can disclose them. Nothing is rounded, averaged or
// "improved": where the document gives two disagreeing intervals, BOTH are
// encoded, each with its own source. Where the document says "no agreed
// interval — leave unscored", the analyte has NO bands at all, which is what
// makes the status engine return `unscored_no_range` rather than a colour.
//
// THE PRINTED INTERVAL ALWAYS WINS. This registry is only consulted when the
// document printed no interval (see status.ts and the store's series read
// model). `refSource` on a stored result records which of the two was used.
//
// SEX BANDS ARE NEVER ASSUMED. A band with `sex: 'male'` or `'female'` is used
// only when `profile.sex` is set by the owner. With sex unset, a sex-specific
// band is not usable and the result stays unscored, with a warning. See
// resolveBand in status.ts.
//
// TYPES ONLY + DATA: this module has no imports, so it is safe in the browser
// bundle and safe to unit-test.

/** A coarse grouping used to lay results out in the UI. */
export type AnalyteCategory =
  | 'Lipids'
  | 'Metabolic'
  | 'CBC'
  | 'Liver'
  | 'Kidney/Electrolytes'
  | 'Thyroid'
  | 'Iron/Vitamins'
  | 'Inflammation'
  | 'Hormones'
  | 'Coagulation'
  | 'Cardiac/Muscle'
  | 'Urinalysis'
  | 'Other';

/** Which population a band applies to. `any` is the sex-pooled band. */
export type BandSex = 'male' | 'female' | 'any';

/** Where an interval came from, matching the document's own source types. */
export type BandSource = 'published_lab' | 'guideline' | 'textbook' | 'secondary';

/**
 * One reference band. `minAge`/`maxAge` are inclusive whole years; an omitted
 * bound means "no bound on that side". `low`/`high` omitted or null means the
 * interval is one-sided on that end (`<200`, `>40`), exactly as the document
 * states it — never filled in with a guess.
 */
export interface LabBand {
  sex: BandSex;
  minAge?: number;
  maxAge?: number;
  low?: number | null;
  high?: number | null;
  /** The interval as the document states it, e.g. "<200 mg/dL". */
  refText: string;
  source: BandSource;
  sourceUrl: string;
  /** Any flag the document raises about this interval. */
  note?: string;
}

export interface LabAnalyte {
  key: string;
  displayName: string;
  category: AnalyteCategory;
  /** The US unit the bands are expressed in. Null for derived/unitless rows. */
  unit: string | null;
  aliases: string[];
  /** Empty means "no agreed interval — leave unscored". */
  bands: LabBand[];
  /** A document-level flag about the analyte as a whole. */
  note?: string;
}

// Source URLs, verbatim from the document.
const ABIM = 'https://www.abim.org/Media/bfijryql/laboratory-reference-ranges.pdf';
const MEDLINEPLUS = 'https://medlineplus.gov/cholesterollevelswhatyouneedtoknow.html';
const CLEVELAND =
  'https://my.clevelandclinic.org/health/articles/11920-cholesterol-numbers-what-do-they-mean';
const TESTING_LIPID = 'https://www.testing.com/tests/lipid-panel/';
const LABCORP_APOB = 'https://www.labcorp.com/tests/167015/apolipoprotein-b';
const LABCORP_APOB_MONO = 'https://www.labcorp.com/assets/5901';
const LABCORP_LPA = 'https://www.labcorp.com/tests/120188/lipoprotein-a';
const TESTING_LPA = 'https://www.testing.com/tests/lipoprotein-a/';
const ADA = 'https://diabetes.org/about-diabetes/diagnosis';
const TESTING_CPEPTIDE = 'https://www.testing.com/tests/c-peptide/';
const TESTING_INSULIN = 'https://www.testing.com/tests/fasting-insulin-test/';
const TESTING_CBC = 'https://www.testing.com/tests/complete-blood-count-cbc/';
const TESTING_ALT = 'https://www.testing.com/tests/alanine-aminotransferase-alt/';
const TESTING_ALP = 'https://www.testing.com/tests/alkaline-phosphatase-alp/';
const TESTING_GGT = 'https://www.testing.com/tests/gamma-glutamyl-transferase-ggt/';
const TESTING_BILI = 'https://www.testing.com/tests/bilirubin/';
const TESTING_CMP = 'https://www.testing.com/tests/comprehensive-metabolic-panel-cmp/';
const TESTING_TP = 'https://www.testing.com/tests/total-protein-albumin-globulin-ag-ratio/';
const TESTING_BUN = 'https://www.testing.com/tests/blood-urea-nitrogen-bun/';
const TESTING_URIC = 'https://www.testing.com/tests/uric-acid/';
const TESTING_CHLORIDE = 'https://www.testing.com/tests/chloride/';
const TESTING_CALCIUM = 'https://www.testing.com/tests/calcium/';
const TESTING_MG = 'https://www.testing.com/tests/magnesium-blood-serum-test/';
const TESTING_TSH = 'https://www.testing.com/tests/thyroid-stimulating-hormone-tsh/';
const TESTING_THYROID = 'https://www.testing.com/tests/comprehensive-thyroid-panel/';
const TESTING_FT3 = 'https://www.testing.com/tests/free-t3-test/';
const TESTING_FERRITIN = 'https://www.testing.com/tests/ferritin/';
const TESTING_IRON = 'https://www.testing.com/tests/iron/';
const TESTING_TIBC =
  'https://www.testing.com/tests/transferrin-and-iron-binding-capacity-tibc-uibc/';
const TESTING_B12 = 'https://www.testing.com/tests/vitamin-b12/';
const TESTING_FOLATE = 'https://www.testing.com/tests/folate-test/';
const NIH_VITD = 'https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/';
const TESTING_VITD = 'https://www.testing.com/tests/vitamin-d-25-hydroxy-test/';
const TESTING_HSCRP =
  'https://www.testing.com/tests/high-sensitivity-c-reactive-protein-hs-crp/';
const TESTING_CRP = 'https://www.testing.com/tests/c-reactive-protein-crp/';
const TESTING_ESR = 'https://www.testing.com/tests/erythrocyte-sedimentation-rate-esr/';
const TESTING_HOMOCYSTEINE = 'https://www.testing.com/tests/homocysteine/';
const TESTING_FT = 'https://www.testing.com/tests/free-testosterone-test/';
const TESTING_SHBG = 'https://www.testing.com/tests/sex-hormone-binding-globulin-shbg/';
const TESTING_PSA = 'https://www.testing.com/tests/prostate-specific-antigen-psa/';
const TESTING_LH = 'https://www.testing.com/tests/luteinizing-hormone-lh/';
const TESTING_FSH = 'https://www.testing.com/tests/follicle-stimulating-hormone-fsh/';
const TESTING_DHEAS = 'https://www.testing.com/tests/dheas/';
const TESTING_CORTISOL = 'https://www.testing.com/tests/cortisol-am-and-pm-test/';
const TESTING_PTT = 'https://www.testing.com/tests/partial-thromboplastin-time-ptt-aptt/';
const TESTING_PTINR =
  'https://www.testing.com/tests/prothrombin-time-and-international-normalized-ratio-ptinr/';
const TESTING_TROPONIN = 'https://www.testing.com/tests/troponin/';
const TESTING_BNP = 'https://www.testing.com/tests/bnp-and-nt-probnp/';
const TESTING_CK = 'https://www.testing.com/tests/creatine-kinase-ck/';

/**
 * The registry. Keys are canonical and stable; the document's own keys are used
 * verbatim. The list is grouped by the document's own headings.
 */
export const ANALYTES: LabAnalyte[] = [
  // ── Lipids ────────────────────────────────────────────────────────────────
  {
    key: 'total_cholesterol',
    displayName: 'Total cholesterol',
    category: 'Lipids',
    unit: 'mg/dL',
    aliases: ['TC', 'CHOL', 'CHOLESTEROL, TOTAL', 'cholesterol_total', 'cholesterol'],
    bands: [
      {
        sex: 'any',
        minAge: 20,
        low: null,
        high: 200,
        refText: '<200 mg/dL',
        source: 'secondary',
        sourceUrl: `${MEDLINEPLUS} ; ${CLEVELAND}`,
        note:
          'Threshold/goal, not a population reference interval. No lower limit is used (lower is treated as better). Borderline high 200-239; high >=240.',
      },
      {
        sex: 'any',
        maxAge: 19,
        low: null,
        high: 170,
        refText: '<170 mg/dL',
        source: 'secondary',
        sourceUrl: MEDLINEPLUS,
        note: 'Age <=19 y threshold.',
      },
    ],
    note: 'Screening threshold, not a measured reference interval.',
  },
  {
    key: 'ldl_c',
    displayName: 'LDL cholesterol',
    category: 'Lipids',
    unit: 'mg/dL',
    aliases: ['LDL-C', 'LDL', 'bad cholesterol', 'ldl'],
    bands: [
      {
        sex: 'any',
        minAge: 20,
        low: null,
        high: 100,
        refText: '<100 mg/dL (optimal)',
        source: 'secondary',
        sourceUrl: `${MEDLINEPLUS} ; ${CLEVELAND}`,
        note:
          'FLAG: risk-based goal, NOT a reference interval — the target falls with higher ASCVD risk (e.g. <70 mg/dL in diabetes, per testing.com). Often calculated (Friedewald), so not directly measured.',
      },
      {
        sex: 'any',
        maxAge: 19,
        low: null,
        high: 110,
        refText: '<110 mg/dL',
        source: 'secondary',
        sourceUrl: TESTING_LIPID,
      },
    ],
  },
  {
    key: 'hdl_c',
    displayName: 'HDL cholesterol',
    category: 'Lipids',
    unit: 'mg/dL',
    aliases: ['HDL-C', 'HDL', 'good cholesterol', 'hdl'],
    bands: [
      {
        sex: 'male',
        minAge: 20,
        low: 40,
        high: 80,
        refText: '40-80 mg/dL (low <40)',
        source: 'secondary',
        sourceUrl: `${MEDLINEPLUS} ; ${CLEVELAND}`,
        note: 'Sex-specific low cut point only; no upper limit is called abnormal.',
      },
      {
        sex: 'female',
        minAge: 20,
        low: 50,
        high: 80,
        refText: '50-80 mg/dL (low <50)',
        source: 'secondary',
        sourceUrl: `${MEDLINEPLUS} ; ${CLEVELAND}`,
        note: 'Sex-specific low cut point only; no upper limit is called abnormal.',
      },
      {
        sex: 'any',
        maxAge: 19,
        low: 45,
        high: null,
        refText: '>45 mg/dL',
        source: 'secondary',
        sourceUrl: MEDLINEPLUS,
      },
    ],
  },
  {
    key: 'triglycerides',
    displayName: 'Triglycerides',
    category: 'Lipids',
    unit: 'mg/dL',
    aliases: ['TG', 'TRIG', 'TRIGS', 'triglycerides'],
    bands: [
      {
        sex: 'any',
        minAge: 20,
        low: null,
        high: 150,
        refText: '<150 mg/dL',
        source: 'secondary',
        sourceUrl: `${MEDLINEPLUS} ; ${TESTING_LIPID}`,
        note:
          'Fasting state changes the value (non-fasting risk-enhancing cut point >150 mg/dL; persistent hypertriglyceridemia >=175 mg/dL per ACC/AHA via LabCorp). Marked hypertriglyceridemia makes calculated LDL-C unreliable.',
      },
    ],
  },
  {
    key: 'non_hdl_cholesterol',
    displayName: 'Non-HDL cholesterol',
    category: 'Lipids',
    unit: 'mg/dL',
    aliases: ['non-HDL-C', 'non-HDL', 'NHDL'],
    bands: [
      {
        sex: 'any',
        minAge: 20,
        low: null,
        high: 130,
        refText: '<130 mg/dL (goal)',
        source: 'secondary',
        sourceUrl: MEDLINEPLUS,
        note:
          'FLAG: derived value = total cholesterol - HDL-C; not directly measured, so no lab interval of its own. ACC/AHA risk-enhancing band 190-219 mg/dL (LabCorp monograph).',
      },
      {
        sex: 'any',
        maxAge: 19,
        low: null,
        high: 120,
        refText: '<120 mg/dL',
        source: 'secondary',
        sourceUrl: MEDLINEPLUS,
      },
    ],
  },
  {
    key: 'apob',
    displayName: 'Apolipoprotein B',
    category: 'Lipids',
    unit: 'mg/dL',
    aliases: ['ApoB', 'Apo B', 'APOB'],
    bands: [
      {
        sex: 'any',
        low: null,
        high: 90,
        refText: '<90 mg/dL (desirable)',
        source: 'published_lab',
        sourceUrl: `${LABCORP_APOB} ; ${LABCORP_APOB_MONO}`,
        note:
          'FLAG: assay-dependent — cut points differ between labs and are risk strata, not a healthy-population reference interval; ACC/AHA uses >=130 mg/dL as a risk-enhancing factor. Borderline high 90-99; high 100-130; very high >130.',
      },
    ],
  },
  {
    key: 'lpa',
    displayName: 'Lipoprotein(a)',
    category: 'Lipids',
    unit: 'mg/dL',
    aliases: ['Lp(a)', 'LPA', 'Lp-a'],
    bands: [
      {
        sex: 'any',
        low: null,
        high: 30,
        refText: '<30 mg/dL (desirable)',
        source: 'published_lab',
        sourceUrl: `${LABCORP_LPA} ; ${TESTING_LPA}`,
        note:
          'FLAG: assay-dependent — mg/dL and nmol/L are NOT reliably interconvertible (particle size varies), so keep the unit printed on the report. Borderline 30-50; high >50 mg/dL. In nmol/L: <75 low, 75-<125 intermediate, >=125 high.',
      },
    ],
  },

  // ── Metabolic / glycaemic ─────────────────────────────────────────────────
  {
    // The generic glucose entry. The extractor writes the key `glucose` for a
    // bare "GLUCOSE", and a bare GLUCOSE does not say whether the sample was
    // fasting — so this is its own analyte rather than an alias of
    // `glucose_fasting`, whose 70-99 band would assert a fasting state the
    // document never printed. (Key derivation is the parser's; see
    // extract/parse.ts. This entry exists so the key that is already stored
    // resolves to a name, a category and a unit.)
    key: 'glucose',
    displayName: 'Glucose',
    category: 'Metabolic',
    unit: 'mg/dL',
    aliases: ['Glucose', 'Blood glucose', 'glucose'],
    bands: [],
    note:
      'No agreed interval — leave unscored. A report printing a bare "GLUCOSE" does not state whether the sample was fasting or random, so the fasting band (70-99 mg/dL) is deliberately NOT applied: doing so would assert a fasting state the document never printed. When the report prints its own interval, that interval is used.',
  },
  {
    key: 'glucose_fasting',
    displayName: 'Glucose, fasting',
    category: 'Metabolic',
    unit: 'mg/dL',
    // The bare "Glucose"/"glucose" names belong to the generic `glucose` entry
    // above; only the names that state the fasting state stay here.
    aliases: ['Glucose, Fasting', 'FPG', 'GLU', 'FBS'],
    bands: [
      {
        sex: 'any',
        low: 70,
        high: 99,
        refText: '70-99 mg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: the 70-99 reference interval and the ADA diagnostic cut-points (normal <100, prediabetes 100-125, diabetes >=126) are different constructs; both shown. Also on the CMP page (70-99).',
      },
    ],
  },
  {
    key: 'hba1c',
    displayName: 'Haemoglobin A1c',
    category: 'Metabolic',
    unit: '%',
    aliases: [
      'HbA1c',
      'A1C',
      'Glycated haemoglobin',
      'Hgb A1c',
      'Glycohemoglobin (GHb),Total',
      'Glycohemoglobin',
      'hba1c',
      'hemoglobin_a1c',
    ],
    bands: [
      {
        sex: 'any',
        low: 4.0,
        high: 5.6,
        refText: '4.0-5.6 %',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: 4.0-5.6 is the ABIM compilation interval; the ADA categories (normal <5.7, prediabetes 5.7-6.4, diabetes >=6.5) are diagnostic thresholds, not a reference interval. Not valid in some haemoglobinopathies/pregnancy.',
      },
    ],
  },
  {
    key: 'estimated_average_glucose',
    displayName: 'Estimated average glucose',
    category: 'Metabolic',
    unit: 'mg/dL',
    aliases: ['Estimated Average Glucose', 'eAG', 'estimatedaverageglucose'],
    bands: [],
    note: 'The cited document gives no interval for this derived value; it is left unscored.',
  },
  {
    key: 'insulin',
    displayName: 'Insulin, fasting',
    category: 'Metabolic',
    unit: 'µU/mL',
    aliases: ['Insulin', 'Fasting Insulin', 'Immunoreactive insulin'],
    bands: [
      {
        sex: 'any',
        low: null,
        high: 20,
        refText: '<20 µU/mL (fasting)',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: highly assay- and lab-dependent; the Quest figure (<=18.4 uU/mL classified optimal for cardiovascular risk) is a risk category from a 2022 reference-interval study, not a reference interval.',
      },
    ],
  },
  {
    key: 'c_peptide',
    displayName: 'C-peptide',
    category: 'Metabolic',
    unit: 'ng/mL',
    aliases: ['C-Peptide', 'Connecting peptide'],
    bands: [
      {
        sex: 'any',
        low: 0.8,
        high: 3.85,
        refText: '0.80-3.85 ng/mL (fasting)',
        source: 'secondary',
        sourceUrl: TESTING_CPEPTIDE,
        note: 'Ranges vary by assay/lab; higher in chronic kidney disease.',
      },
    ],
  },
  {
    key: 'homa_ir',
    displayName: 'HOMA-IR',
    category: 'Metabolic',
    unit: '(index, unitless)',
    aliases: ['HOMA-IR', 'Homeostatic Model Assessment of Insulin Resistance'],
    bands: [],
    note:
      'No agreed interval — leave unscored. Calculated from fasting insulin x fasting glucose / 22.5; a value above ~2.0-2.5 is a commonly used cut-off but varies by lab and population. Not a standalone lab result.',
  },

  // ── CBC ───────────────────────────────────────────────────────────────────
  {
    key: 'wbc',
    displayName: 'White blood cell count',
    category: 'CBC',
    unit: 'thousand/µL (10^3/µL)',
    aliases: ['WBC', 'Leukocytes', 'White Blood Cell Count'],
    bands: [
      {
        sex: 'any',
        low: 4.5,
        high: 11.0,
        refText: '4.5-11.0 thousand/µL',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Ranges vary by lab.',
      },
    ],
  },
  {
    key: 'rbc',
    displayName: 'Red blood cell count',
    category: 'CBC',
    unit: 'million/µL (10^6/µL)',
    aliases: ['RBC', 'Erythrocyte count'],
    bands: [
      {
        sex: 'male',
        low: 4.6,
        high: 6.2,
        refText: 'M 4.6-6.2 million/µL',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
      },
      {
        sex: 'female',
        low: 4.2,
        high: 5.4,
        refText: 'F 4.2-5.4 million/µL',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'ABIM (textbook) lists a single sex-pooled 4.2-5.9 million/µL.',
      },
    ],
  },
  {
    key: 'hemoglobin',
    displayName: 'Haemoglobin',
    category: 'CBC',
    unit: 'g/dL',
    aliases: ['Hgb', 'Hb', 'Haemoglobin', 'hgb'],
    bands: [
      {
        sex: 'male',
        low: 14,
        high: 18,
        refText: 'M 14-18 g/dL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'female',
        low: 12,
        high: 16,
        refText: 'F 12-16 g/dL',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'Testing.com gives M 13-18 / F 12-16 — note the differing male lower limit between sources. FLAG: sex-specific; do not use one number.',
      },
    ],
  },
  {
    key: 'hematocrit',
    displayName: 'Haematocrit',
    category: 'CBC',
    unit: '%',
    aliases: ['Hct', 'PCV', 'Packed Cell Volume', 'hematocrit'],
    bands: [
      {
        sex: 'male',
        low: 42,
        high: 50,
        refText: 'M 42-50 %',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'female',
        low: 37,
        high: 47,
        refText: 'F 37-47 %',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'Testing.com gives M 40-55 / F 36-48. FLAG: sex-specific.',
      },
    ],
  },
  {
    key: 'mcv',
    displayName: 'Mean corpuscular volume',
    category: 'CBC',
    unit: 'fL',
    aliases: ['MCV'],
    bands: [
      {
        sex: 'any',
        low: 80,
        high: 100,
        refText: '80-100 fL',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Not in the ABIM compilation.',
      },
    ],
  },
  {
    key: 'mch',
    displayName: 'Mean corpuscular haemoglobin',
    category: 'CBC',
    unit: 'pg',
    aliases: ['MCH'],
    bands: [
      {
        sex: 'any',
        low: 27,
        high: 32,
        refText: '27-32 pg',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Not in the ABIM compilation.',
      },
    ],
  },
  {
    key: 'mchc',
    displayName: 'Mean corpuscular haemoglobin concentration',
    category: 'CBC',
    unit: 'g/dL',
    aliases: ['MCHC'],
    bands: [
      {
        sex: 'any',
        low: 32,
        high: 36,
        refText: '32-36 g/dL',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Not in the ABIM compilation.',
      },
    ],
  },
  {
    key: 'rdw',
    displayName: 'Red cell distribution width',
    category: 'CBC',
    unit: '%',
    aliases: ['RDW', 'RDW-CV'],
    bands: [
      {
        sex: 'any',
        low: 9.0,
        high: 14.5,
        refText: '9.0-14.5 %',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: two sources disagree (ABIM 9.0-14.5 vs Testing.com 11.5-14.5); depends on RDW-CV vs RDW-SD and analyser.',
      },
      {
        sex: 'any',
        low: 11.5,
        high: 14.5,
        refText: '11.5-14.5 %',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'The second, disagreeing source for this analyte.',
      },
    ],
  },
  {
    key: 'platelets',
    displayName: 'Platelet count',
    category: 'CBC',
    unit: 'thousand/µL (10^3/µL)',
    aliases: ['Platelets', 'PLT', 'Thrombocytes', 'Platelet Count'],
    bands: [
      {
        sex: 'any',
        low: 150,
        high: 450,
        refText: '150-450 thousand/µL',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'FLAG: upper limit 400 vs 450 between sources.',
      },
      {
        sex: 'any',
        low: 150,
        high: 400,
        refText: '150-400 thousand/µL',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'The second, disagreeing source for this analyte.',
      },
    ],
  },
  {
    key: 'mpv',
    displayName: 'Mean platelet volume',
    category: 'CBC',
    unit: 'fL',
    aliases: ['MPV'],
    bands: [
      {
        sex: 'any',
        low: 7.5,
        high: 11.5,
        refText: '7.5-11.5 fL',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Not in the ABIM compilation.',
      },
    ],
  },
  {
    key: 'neutrophils',
    displayName: 'Neutrophils (%)',
    category: 'CBC',
    unit: '% of WBC',
    aliases: ['Neutrophils', 'Neut %', 'PMN'],
    bands: [
      {
        sex: 'any',
        low: 50,
        high: 70,
        refText: '50-70 % of WBC',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note:
          'Percent and absolute count are different columns on a report; label which is plotted. Absolute ANC 2,000-8,250/µL (ABIM).',
      },
    ],
  },
  {
    // THE PERCENTAGE, UNDER THE STORED SPELLING A DIFFERENT REPORT PRINTS.
    //
    // A report that prints its differential under the symbols `NE%`/`NE#`
    // (`LY%`, `MO%`, `EO%`, `BA%`) makes the extractor write the key
    // `neutrophils_pct` for the percentage column, while a report that prints a
    // bare `NEUTROPHILS` writes `neutrophils`. Those are two stored spellings of
    // ONE measurement, and `neutrophils` no longer claims the `_pct` name as an
    // alias: the two are kept as SEPARATE series so neither can be charted,
    // scored or described as the other, and each carries a name that says which
    // it is. The percentage symbol is the report's own mark for this column.
    key: 'neutrophils_pct',
    displayName: 'Neutrophils, automated (%)',
    category: 'CBC',
    unit: '% of WBC',
    aliases: ['NE%', 'neutrophils_pct'],
    bands: [
      {
        sex: 'any',
        low: 50,
        high: 70,
        refText: '50-70 % of WBC',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note:
          'Percent and absolute count are different columns on a report; label which is plotted. Absolute ANC 2,000-8,250/µL (ABIM).',
      },
    ],
  },
  {
    key: 'lymphocytes',
    displayName: 'Lymphocytes (%)',
    category: 'CBC',
    unit: '% of WBC',
    aliases: ['Lymphocytes', 'Lymph %'],
    bands: [
      {
        sex: 'any',
        low: 20,
        high: 40,
        refText: '20-40 % of WBC',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Absolute 1,200-4,950/µL (ABIM).',
      },
    ],
  },
  {
    // See `neutrophils_pct`: the `_pct` spelling is its own series, named apart.
    key: 'lymphocytes_pct',
    displayName: 'Lymphocytes, automated (%)',
    category: 'CBC',
    unit: '% of WBC',
    aliases: ['LY%', 'lymphocytes_pct'],
    bands: [
      {
        sex: 'any',
        low: 20,
        high: 40,
        refText: '20-40 % of WBC',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Absolute 1,200-4,950/µL (ABIM).',
      },
    ],
  },
  {
    key: 'monocytes',
    displayName: 'Monocytes (%)',
    category: 'CBC',
    unit: '% of WBC',
    aliases: ['Monocytes', 'Mono %'],
    bands: [
      {
        sex: 'any',
        low: 2,
        high: 8,
        refText: '2-8 % of WBC',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Absolute 0-660/µL (ABIM).',
      },
    ],
  },
  {
    // See `neutrophils_pct`: the `_pct` spelling is its own series, named apart.
    key: 'monocytes_pct',
    displayName: 'Monocytes, automated (%)',
    category: 'CBC',
    unit: '% of WBC',
    aliases: ['MO%', 'monocytes_pct'],
    bands: [
      {
        sex: 'any',
        low: 2,
        high: 8,
        refText: '2-8 % of WBC',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Absolute 0-660/µL (ABIM).',
      },
    ],
  },
  {
    key: 'eosinophils',
    displayName: 'Eosinophils (%)',
    category: 'CBC',
    unit: '% of WBC',
    aliases: ['Eosinophils', 'Eos %'],
    bands: [
      {
        sex: 'any',
        low: 1,
        high: 4,
        refText: '1-4 % of WBC',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Absolute 0-330/µL (ABIM).',
      },
    ],
  },
  {
    // See `neutrophils_pct`: the `_pct` spelling is its own series, named apart.
    key: 'eosinophils_pct',
    displayName: 'Eosinophils, automated (%)',
    category: 'CBC',
    unit: '% of WBC',
    aliases: ['EO%', 'eosinophils_pct'],
    bands: [
      {
        sex: 'any',
        low: 1,
        high: 4,
        refText: '1-4 % of WBC',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Absolute 0-330/µL (ABIM).',
      },
    ],
  },
  {
    key: 'basophils',
    displayName: 'Basophils (%)',
    category: 'CBC',
    unit: '% of WBC',
    aliases: ['Basophils', 'Baso %'],
    bands: [
      {
        sex: 'any',
        low: 0.5,
        high: 1,
        refText: '0.5-1 % of WBC',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Absolute 0-110/µL (ABIM).',
      },
    ],
  },
  {
    // See `neutrophils_pct`: the `_pct` spelling is its own series, named apart.
    key: 'basophils_pct',
    displayName: 'Basophils, automated (%)',
    category: 'CBC',
    unit: '% of WBC',
    aliases: ['BA%', 'basophils_pct'],
    bands: [
      {
        sex: 'any',
        low: 0.5,
        high: 1,
        refText: '0.5-1 % of WBC',
        source: 'secondary',
        sourceUrl: TESTING_CBC,
        note: 'Absolute 0-110/µL (ABIM).',
      },
    ],
  },
  {
    key: 'neutrophils_abs',
    displayName: 'Neutrophils, absolute',
    category: 'CBC',
    unit: '/µL',
    aliases: ['NE#', 'neutrophils_abs', 'ANC'],
    bands: [
      {
        sex: 'any',
        low: 2000,
        high: 8250,
        refText: '2,000-8,250/µL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
    ],
  },
  {
    key: 'lymphocytes_abs',
    displayName: 'Lymphocytes, absolute',
    category: 'CBC',
    unit: '/µL',
    aliases: ['LY#', 'lymphocytes_abs', 'ALC'],
    bands: [
      {
        sex: 'any',
        low: 1200,
        high: 4950,
        refText: '1,200-4,950/µL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
    ],
  },
  {
    key: 'monocytes_abs',
    displayName: 'Monocytes, absolute',
    category: 'CBC',
    unit: '/µL',
    aliases: ['MO#', 'monocytes_abs'],
    bands: [
      {
        sex: 'any',
        low: 0,
        high: 660,
        refText: '0-660/µL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
    ],
  },
  {
    key: 'eosinophils_abs',
    displayName: 'Eosinophils, absolute',
    category: 'CBC',
    unit: '/µL',
    aliases: ['EO#', 'eosinophils_abs'],
    bands: [
      {
        sex: 'any',
        low: 0,
        high: 330,
        refText: '0-330/µL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
    ],
  },
  {
    key: 'basophils_abs',
    displayName: 'Basophils, absolute',
    category: 'CBC',
    unit: '/µL',
    aliases: ['BA#', 'basophils_abs'],
    bands: [
      {
        sex: 'any',
        low: 0,
        high: 110,
        refText: '0-110/µL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
    ],
  },
  {
    key: 'differential_percent',
    displayName: 'Differential percent (NE% LY% MO% EO% BA%)',
    category: 'CBC',
    unit: '% of WBC',
    aliases: ['NE% LY% MO% EO% BA%'],
    bands: [],
    note:
      'A report may print the five differential percentages under one header row. The document gives no interval for the row itself: each cell is banded by its own analyte (neutrophils, lymphocytes, monocytes, eosinophils, basophils).',
  },
  {
    key: 'differential_absolute',
    displayName: 'Differential absolute (NE# LY# MO# EO# BA#)',
    category: 'CBC',
    unit: '/µL',
    aliases: ['NE# LY# MO# EO# BA#'],
    bands: [],
    note:
      'A report may print the five absolute differential counts under one header row. The document gives no interval for the row itself: each cell is banded by its own analyte.',
  },

  // ── Liver ─────────────────────────────────────────────────────────────────
  {
    key: 'alt',
    displayName: 'Alanine aminotransferase',
    category: 'Liver',
    unit: 'U/L',
    aliases: [
      'ALT',
      'SGPT',
      'GPT',
      'Alanine Transaminase',
      'SGPT (ALT)',
      'sgptalt',
      'alt',
    ],
    bands: [
      {
        sex: 'any',
        low: 10,
        high: 40,
        refText: 'ABIM 10-40 U/L',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        minAge: 20,
        low: 9,
        high: 46,
        refText: 'M 9-46 U/L (>=20 y)',
        source: 'secondary',
        sourceUrl: TESTING_ALT,
        note: 'FLAG: sex- and lab-dependent; some labs use a single ~7-56 U/L range (CMP).',
      },
      {
        sex: 'female',
        minAge: 20,
        low: 6,
        high: 29,
        refText: 'F 6-29 U/L (>=20 y)',
        source: 'secondary',
        sourceUrl: TESTING_ALT,
        note: 'Female upper limits are lower in modern studies.',
      },
    ],
  },
  {
    key: 'ast',
    displayName: 'Aspartate aminotransferase',
    category: 'Liver',
    unit: 'U/L',
    aliases: ['AST', 'SGOT', 'GOT', 'Aspartate Transaminase', 'SGOT (AST)', 'sgotast', 'ast'],
    bands: [
      {
        sex: 'any',
        low: 10,
        high: 40,
        refText: '10-40 U/L',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: Testing.com states there is "no universal reference range for AST" (assays/methods differ).',
      },
    ],
  },
  {
    key: 'alp',
    displayName: 'Alkaline phosphatase',
    category: 'Liver',
    unit: 'U/L',
    aliases: ['ALP', 'Alk Phos', 'ALKP', 'alkalinephosphatase', 'alkaline_phosphatase'],
    bands: [
      {
        sex: 'any',
        low: 30,
        high: 120,
        refText: 'ABIM 30-120 U/L',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'FLAG: two ranges quoted; rises in bone disease and pregnancy.',
      },
      {
        sex: 'any',
        low: 44,
        high: 147,
        refText: '44-147 U/L (common)',
        source: 'secondary',
        sourceUrl: TESTING_ALP,
        note: 'The second, disagreeing source for this analyte.',
      },
    ],
  },
  {
    key: 'ggt',
    displayName: 'Gamma-glutamyl transferase',
    category: 'Liver',
    unit: 'U/L',
    aliases: ['GGT', 'Gamma-GT', 'GGTP'],
    bands: [
      {
        sex: 'male',
        low: 9,
        high: 50,
        refText: 'ABIM M 9-50 U/L',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'female',
        low: 8,
        high: 40,
        refText: 'ABIM F 8-40 U/L',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'FLAG: strong age/sex dependence; rises with alcohol and many drugs.',
      },
      {
        sex: 'male',
        minAge: 20,
        maxAge: 29,
        low: 3,
        high: 70,
        refText: 'Quest M 20-29 y 3-70 U/L',
        source: 'secondary',
        sourceUrl: TESTING_GGT,
      },
      {
        sex: 'male',
        minAge: 40,
        maxAge: 54,
        low: 3,
        high: 95,
        refText: 'Quest M 40-54 y 3-95 U/L',
        source: 'secondary',
        sourceUrl: TESTING_GGT,
      },
      {
        sex: 'female',
        minAge: 20,
        maxAge: 29,
        low: 3,
        high: 40,
        refText: 'Quest F 20-29 y 3-40 U/L',
        source: 'secondary',
        sourceUrl: TESTING_GGT,
      },
      {
        sex: 'female',
        minAge: 40,
        maxAge: 49,
        low: 3,
        high: 55,
        refText: 'Quest F 40-49 y 3-55 U/L',
        source: 'secondary',
        sourceUrl: TESTING_GGT,
      },
      {
        sex: 'female',
        minAge: 50,
        maxAge: 59,
        low: 3,
        high: 70,
        refText: 'Quest F 50-59 y 3-70 U/L',
        source: 'secondary',
        sourceUrl: TESTING_GGT,
      },
    ],
  },
  {
    key: 'total_bilirubin',
    displayName: 'Total bilirubin',
    category: 'Liver',
    unit: 'mg/dL',
    aliases: ['Total Bilirubin', 'T. Bili', 'TBIL', 'bilirubin_total', 'Bilirubin, Total'],
    bands: [
      {
        sex: 'any',
        low: 0.3,
        high: 1.0,
        refText: '0.3-1.0 mg/dL (ABIM via Testing.com)',
        source: 'secondary',
        sourceUrl: TESTING_BILI,
      },
      {
        sex: 'any',
        low: 0.1,
        high: 1.2,
        refText: '0.1-1.2 mg/dL (CMP page)',
        source: 'secondary',
        sourceUrl: TESTING_CMP,
        note: 'The second, disagreeing source for this analyte.',
      },
    ],
  },
  {
    key: 'direct_bilirubin',
    displayName: 'Direct (conjugated) bilirubin',
    category: 'Liver',
    unit: 'mg/dL',
    aliases: ['Direct Bilirubin', 'D. Bili', 'Conjugated bilirubin', 'bilirubin_direct'],
    bands: [
      {
        sex: 'any',
        low: 0.1,
        high: 0.3,
        refText: '0.1-0.3 mg/dL',
        source: 'secondary',
        sourceUrl: TESTING_BILI,
        note: 'Indirect bilirubin quoted as 0.2-0.7 mg/dL if the report splits it.',
      },
    ],
  },
  {
    key: 'albumin',
    displayName: 'Albumin',
    category: 'Liver',
    unit: 'g/dL',
    aliases: ['Albumin', 'ALB'],
    bands: [
      {
        sex: 'any',
        low: 3.5,
        high: 5.5,
        refText: 'ABIM 3.5-5.5 g/dL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'any',
        low: 3.4,
        high: 5.4,
        refText: 'CMP 3.4-5.4 g/dL',
        source: 'secondary',
        sourceUrl: TESTING_CMP,
        note: 'Falls with inflammation, liver/kidney disease; interpret total calcium with albumin.',
      },
    ],
  },
  {
    key: 'total_protein',
    displayName: 'Total protein',
    category: 'Liver',
    unit: 'g/dL',
    aliases: ['Total Protein', 'TP', 'Proteins, Total', 'protein_total'],
    bands: [
      {
        sex: 'any',
        low: 5.5,
        high: 9.0,
        refText: '5.5-9.0 g/dL (ABIM via Testing.com)',
        source: 'secondary',
        sourceUrl: TESTING_TP,
      },
      {
        sex: 'any',
        low: 6.0,
        high: 8.3,
        refText: '6.0-8.3 g/dL (CMP page)',
        source: 'secondary',
        sourceUrl: TESTING_CMP,
        note: 'Globulins quoted 2.0-3.5 g/dL; A/G ratio derived.',
      },
    ],
  },
  {
    key: 'globulin',
    displayName: 'Globulin, total',
    category: 'Liver',
    unit: 'g/dL',
    aliases: ['Globulin', 'Globulin, Total', 'globulintotal'],
    bands: [
      {
        sex: 'any',
        low: 2.0,
        high: 3.5,
        refText: '2.0-3.5 g/dL',
        source: 'secondary',
        sourceUrl: TESTING_TP,
        note: 'Derived value quoted on the total protein page; not a measured analyte.',
      },
    ],
  },
  {
    key: 'albumin_globulin_ratio',
    displayName: 'A/G ratio',
    category: 'Liver',
    unit: 'ratio',
    aliases: ['A/G Ratio', 'Albumin/Globulin Ratio', 'agratio', 'Albumin Globulin Ratio'],
    bands: [],
    note: 'Derived value; the cited document gives no interval — left unscored.',
  },

  // ── Kidney / electrolytes ─────────────────────────────────────────────────
  {
    key: 'creatinine',
    displayName: 'Creatinine, serum',
    category: 'Kidney/Electrolytes',
    unit: 'mg/dL',
    aliases: ['Creatinine', 'Creat', 'Cr', 'Serum Creatinine', 'creatinineserum'],
    bands: [
      {
        sex: 'male',
        low: 0.7,
        high: 1.3,
        refText: 'ABIM M 0.70-1.30 mg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'female',
        low: 0.5,
        high: 1.1,
        refText: 'ABIM F 0.50-1.10 mg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        low: 0.74,
        high: 1.35,
        refText: 'CMP M 0.74-1.35 mg/dL',
        source: 'secondary',
        sourceUrl: TESTING_CMP,
      },
      {
        sex: 'female',
        low: 0.59,
        high: 1.04,
        refText: 'CMP F 0.59-1.04 mg/dL',
        source: 'secondary',
        sourceUrl: TESTING_CMP,
        note:
          'FLAG: sex-specific; depends on muscle mass. Do not compare a urine creatinine (mg/dL, wide range) to this.',
      },
    ],
  },
  {
    key: 'egfr',
    displayName: 'Estimated GFR',
    category: 'Kidney/Electrolytes',
    unit: 'mL/min/1.73 m²',
    aliases: ['eGFR', 'GFR estimate', 'CKD-EPI'],
    bands: [],
    note:
      'No agreed interval — leave unscored. eGFR is age/sex-dependent and reported by equation; the CMP page shows ">=60", which is a CKD-staging threshold, not a reference interval.',
  },
  {
    key: 'bun',
    displayName: 'Blood urea nitrogen',
    category: 'Kidney/Electrolytes',
    unit: 'mg/dL',
    aliases: ['BUN', 'Urea Nitrogen', 'Urea', 'urea_nitrogen_bun'],
    bands: [
      {
        sex: 'any',
        low: 8,
        high: 20,
        refText: 'ABIM 8-20 mg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'any',
        low: 7,
        high: 20,
        refText: 'CMP 7-20 mg/dL',
        source: 'secondary',
        sourceUrl: TESTING_CMP,
        note: 'The second source differs on the lower limit.',
      },
    ],
  },
  {
    key: 'bun_creatinine_ratio',
    displayName: 'BUN:creatinine ratio',
    category: 'Kidney/Electrolytes',
    unit: 'ratio',
    aliases: ['BUN/Cr', 'BUN:Creatinine Ratio', 'Calculated BUN/Creat', 'BUN Creatinine Ratio', 'calculated_bun_creat'],
    bands: [
      {
        sex: 'any',
        low: 10,
        high: 20,
        refText: '10-20 ratio',
        source: 'secondary',
        sourceUrl: TESTING_BUN,
        note: 'Derived value, not a measured analyte.',
      },
    ],
  },
  {
    key: 'uric_acid',
    displayName: 'Uric acid, serum',
    category: 'Kidney/Electrolytes',
    unit: 'mg/dL',
    aliases: ['Uric Acid', 'Urate'],
    bands: [
      {
        sex: 'any',
        low: 3.0,
        high: 7.0,
        refText: 'ABIM 3.0-7.0 mg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        low: 4.0,
        high: 8.0,
        refText: 'M 4.0-8.0 mg/dL',
        source: 'secondary',
        sourceUrl: TESTING_URIC,
        note: "Women's levels rise toward men's after menopause.",
      },
      {
        sex: 'female',
        low: 2.5,
        high: 7.0,
        refText: 'F 2.5-7.0 mg/dL',
        source: 'secondary',
        sourceUrl: TESTING_URIC,
      },
    ],
  },
  {
    key: 'sodium',
    displayName: 'Sodium',
    category: 'Kidney/Electrolytes',
    unit: 'mEq/L (mmol/L)',
    aliases: ['Sodium', 'Na', 'Na+'],
    bands: [
      {
        sex: 'any',
        low: 136,
        high: 145,
        refText: '136-145 mEq/L',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'any',
        minAge: 90,
        low: 132,
        high: 146,
        refText: '132-146 mEq/L (>90 y)',
        source: 'secondary',
        sourceUrl: TESTING_CMP,
        note: 'Testing.com attributes the same 136-145 to the Tietz textbook, with this >90 y band.',
      },
    ],
  },
  {
    key: 'potassium',
    displayName: 'Potassium',
    category: 'Kidney/Electrolytes',
    unit: 'mEq/L (mmol/L)',
    aliases: ['Potassium', 'K', 'K+'],
    bands: [
      {
        sex: 'any',
        low: 3.5,
        high: 5.0,
        refText: 'ABIM 3.5-5.0 mEq/L',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'any',
        low: 3.5,
        high: 5.1,
        refText: 'CMP 3.5-5.1 mEq/L',
        source: 'secondary',
        sourceUrl: TESTING_CMP,
        note: 'The second source differs on the upper limit.',
      },
    ],
  },
  {
    key: 'chloride',
    displayName: 'Chloride',
    category: 'Kidney/Electrolytes',
    unit: 'mEq/L (mmol/L)',
    aliases: ['Chloride', 'Cl', 'Cl-'],
    bands: [
      {
        sex: 'any',
        low: 98,
        high: 106,
        refText: 'ABIM 98-106 mEq/L',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'Upper limit 106 vs 107 between sources (Testing.com and the CMP page agree at 98-106 / 98-107).',
      },
      {
        sex: 'any',
        low: 98,
        high: 107,
        refText: 'CMP 98-107 mEq/L',
        source: 'secondary',
        sourceUrl: TESTING_CHLORIDE,
      },
    ],
  },
  {
    key: 'co2_bicarbonate',
    displayName: 'Carbon dioxide / bicarbonate',
    category: 'Kidney/Electrolytes',
    unit: 'mEq/L (mmol/L)',
    aliases: ['CO2', 'Bicarbonate', 'HCO3', 'Total CO2', 'ECO2', 'co2', 'carbon_dioxide'],
    bands: [
      {
        sex: 'any',
        low: 23,
        high: 28,
        refText: 'ABIM bicarbonate 23-28 mEq/L',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'any',
        low: 22,
        high: 29,
        refText: 'CMP "Carbon Dioxide" 22-29 mEq/L',
        source: 'secondary',
        sourceUrl: TESTING_CMP,
        note:
          'FLAG: the CMP "CO2" and a calculated bicarbonate are not identical; label which the report prints.',
      },
    ],
  },
  {
    key: 'calcium',
    displayName: 'Calcium, total',
    category: 'Kidney/Electrolytes',
    unit: 'mg/dL',
    aliases: ['Calcium', 'Ca', 'Total Calcium', 'calcium'],
    bands: [
      {
        sex: 'any',
        low: 8.5,
        high: 10.2,
        refText: 'CMP 8.5-10.2 mg/dL',
        source: 'secondary',
        sourceUrl: TESTING_CMP,
        note: 'Interpret with albumin (corrected calcium); total calcium falls with low albumin.',
      },
      {
        sex: 'any',
        low: 8.8,
        high: 10.4,
        refText: 'Testing.com (NIH ODS) 8.8-10.4 mg/dL',
        source: 'secondary',
        sourceUrl: TESTING_CALCIUM,
        note: 'The second, disagreeing source; small sex split around the upper limit.',
      },
    ],
  },
  {
    key: 'magnesium',
    displayName: 'Magnesium, serum',
    category: 'Kidney/Electrolytes',
    unit: 'mg/dL',
    aliases: ['Magnesium', 'Mg'],
    bands: [
      {
        sex: 'any',
        low: 1.5,
        high: 2.5,
        refText: '1.5-2.5 mg/dL',
        source: 'secondary',
        sourceUrl: TESTING_MG,
        note:
          'FLAG: ranges "aren\'t fully standardized across labs". Widely-quoted alternative is ~1.7-2.2 mg/dL. The RBC magnesium (4.0-6.4 mg/dL) is a different test.',
      },
    ],
  },
  {
    key: 'phosphorus',
    displayName: 'Phosphorus / phosphate, serum',
    category: 'Kidney/Electrolytes',
    unit: 'mg/dL',
    aliases: ['Phosphorus', 'Phosphate', 'PO4', 'Inorganic Phosphate', 'phos'],
    bands: [
      {
        sex: 'any',
        low: 3.0,
        high: 4.5,
        refText: 'ABIM 3.0-4.5 mg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'Some labs use ~2.5-4.5 mg/dL; the Testing.com page gave no adult number. FLAG: source-dependent.',
      },
    ],
  },
  {
    key: 'anion_gap',
    displayName: 'Anion gap',
    category: 'Kidney/Electrolytes',
    unit: 'mEq/L',
    aliases: ['Anion Gap', 'AG', 'Na-Cl-HCO3'],
    bands: [
      {
        sex: 'any',
        low: 7,
        high: 13,
        refText: 'ABIM 7-13 mEq/L',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: varies with the equation used and whether K+ is included; many labs quote 8-16. Not on the CMP panel by default.',
      },
    ],
  },

  // ── Thyroid ───────────────────────────────────────────────────────────────
  {
    key: 'tsh',
    displayName: 'Thyroid-stimulating hormone',
    category: 'Thyroid',
    unit: 'mIU/L (µIU/mL)',
    aliases: ['TSH', 'Thyrotropin'],
    bands: [
      {
        sex: 'any',
        minAge: 20,
        low: 0.4,
        high: 4.5,
        refText: '0.40-4.50 mIU/L (adults >=20 y)',
        source: 'secondary',
        sourceUrl: TESTING_TSH,
        note:
          'FLAG: TSH intervals are debated (upper limit ~4.0-4.5) and shift with age and pregnancy. Pregnancy bands: 1st tri 0.26-2.66, 2nd 0.55-2.73, 3rd 0.43-2.91 mIU/L. Do not use the adult band in pregnancy.',
      },
      {
        sex: 'any',
        low: 0.5,
        high: 4.0,
        refText: 'ABIM 0.5-4.0 mIU/L',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'The second, disagreeing source for this analyte.',
      },
    ],
  },
  {
    key: 'free_t4',
    displayName: 'Free thyroxine',
    category: 'Thyroid',
    unit: 'ng/dL',
    aliases: ['Free T4', 'FT4', 'Free Thyroxine'],
    bands: [
      {
        sex: 'any',
        low: 0.8,
        high: 1.8,
        refText: '0.8-1.8 ng/dL',
        source: 'textbook',
        sourceUrl: `${ABIM} ; ${TESTING_THYROID}`,
        note: 'Assay-dependent; some labs report pmol/L (1 ng/dL ≈ 12.9 pmol/L).',
      },
    ],
  },
  {
    key: 'free_t3',
    displayName: 'Free triiodothyronine',
    category: 'Thyroid',
    unit: 'pg/mL',
    aliases: ['Free T3', 'FT3'],
    bands: [
      {
        sex: 'any',
        low: 2.3,
        high: 4.2,
        refText: '2.3-4.2 pg/mL',
        source: 'textbook',
        sourceUrl: `${ABIM} ; ${TESTING_FT3}`,
      },
    ],
  },
  {
    key: 'total_t4',
    displayName: 'Total thyroxine',
    category: 'Thyroid',
    unit: 'µg/dL',
    aliases: ['Total T4', 'T4', 'Thyroxine', 't4_thyroxine_total'],
    bands: [
      {
        sex: 'any',
        low: 5,
        high: 12,
        refText: '5-12 µg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'Affected by thyroid-binding globulin (pregnancy, liver disease).',
      },
    ],
  },
  {
    key: 'total_t3',
    displayName: 'Total triiodothyronine',
    category: 'Thyroid',
    unit: 'ng/dL',
    aliases: ['Total T3', 'T3'],
    bands: [
      {
        sex: 'any',
        low: 80,
        high: 180,
        refText: 'ABIM 80-180 ng/dL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'any',
        low: 76,
        high: 181,
        refText: '76-181 ng/dL',
        source: 'secondary',
        sourceUrl: TESTING_THYROID,
        note: 'Minor endpoint differences between sources. Testing.com also lists a derived T7 (1.4-3.8) and TPO antibodies <9 IU/mL.',
      },
    ],
  },

  // ── Iron / vitamins / minerals ────────────────────────────────────────────
  {
    key: 'ferritin',
    displayName: 'Ferritin',
    category: 'Iron/Vitamins',
    unit: 'ng/mL',
    aliases: ['Ferritin', 'Serum Ferritin'],
    bands: [
      {
        sex: 'female',
        low: 24,
        high: 307,
        refText: 'ABIM F 24-307 ng/mL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        low: 24,
        high: 336,
        refText: 'ABIM M 24-336 ng/mL',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: strongly assay- and population-dependent and debated (especially the lower cut-off). Two sources disagree on the upper limit; treat as approximate.',
      },
      {
        sex: 'female',
        minAge: 19,
        maxAge: 40,
        low: 16,
        high: 154,
        refText: 'F 16-154 ng/mL (19-40 y)',
        source: 'secondary',
        sourceUrl: TESTING_FERRITIN,
      },
      {
        sex: 'female',
        minAge: 41,
        maxAge: 60,
        low: 16,
        high: 232,
        refText: 'F 16-232 ng/mL (41-60 y)',
        source: 'secondary',
        sourceUrl: TESTING_FERRITIN,
      },
      {
        sex: 'female',
        minAge: 61,
        low: 16,
        high: 288,
        refText: 'F 16-288 ng/mL (>60 y)',
        source: 'secondary',
        sourceUrl: TESTING_FERRITIN,
      },
      {
        sex: 'male',
        minAge: 19,
        maxAge: 59,
        low: 38,
        high: 380,
        refText: 'M 38-380 ng/mL (19-59 y)',
        source: 'secondary',
        sourceUrl: TESTING_FERRITIN,
      },
      {
        sex: 'male',
        minAge: 60,
        low: 24,
        high: 380,
        refText: 'M 24-380 ng/mL (>=60 y)',
        source: 'secondary',
        sourceUrl: TESTING_FERRITIN,
      },
    ],
  },
  {
    key: 'iron',
    displayName: 'Iron, serum',
    category: 'Iron/Vitamins',
    unit: 'µg/dL',
    aliases: ['Iron', 'Serum Iron', 'Fe', 'iron_total'],
    bands: [
      {
        sex: 'any',
        low: 50,
        high: 150,
        refText: 'ABIM 50-150 µg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        minAge: 20,
        maxAge: 29,
        low: 50,
        high: 195,
        refText: 'Quest M 50-195 µg/dL (20-29 y)',
        source: 'secondary',
        sourceUrl: TESTING_IRON,
      },
      {
        sex: 'male',
        minAge: 30,
        low: 50,
        high: 180,
        refText: 'Quest M 50-180 µg/dL (>=30 y)',
        source: 'secondary',
        sourceUrl: TESTING_IRON,
      },
      {
        sex: 'female',
        minAge: 20,
        maxAge: 49,
        low: 40,
        high: 190,
        refText: 'Quest F 40-190 µg/dL (20-49 y)',
        source: 'secondary',
        sourceUrl: TESTING_IRON,
      },
      {
        sex: 'female',
        minAge: 50,
        low: 45,
        high: 160,
        refText: 'Quest F 45-160 µg/dL (>=50 y)',
        source: 'secondary',
        sourceUrl: TESTING_IRON,
        note: 'Wide diurnal variation; a single value is of limited use.',
      },
    ],
  },
  {
    key: 'tibc',
    displayName: 'Total iron-binding capacity',
    category: 'Iron/Vitamins',
    unit: 'µg/dL',
    aliases: ['TIBC', 'Iron-Binding Capacity', 'Transferrin'],
    bands: [
      {
        sex: 'any',
        low: 250,
        high: 310,
        refText: 'ABIM 250-310 µg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        low: 250,
        high: 425,
        refText: 'Quest M 250-425 µg/dL',
        source: 'secondary',
        sourceUrl: TESTING_TIBC,
      },
      {
        sex: 'female',
        low: 250,
        high: 450,
        refText: 'Quest F 250-450 µg/dL',
        source: 'secondary',
        sourceUrl: TESTING_TIBC,
        note: 'ABIM and Quest ranges differ substantially; label the source.',
      },
    ],
  },
  {
    key: 'transferrin_saturation',
    displayName: 'Transferrin saturation',
    category: 'Iron/Vitamins',
    unit: '%',
    aliases: ['Transferrin Saturation', 'TSAT', '% Sat', 'Iron Saturation', 'saturation'],
    bands: [
      {
        sex: 'any',
        low: 20,
        high: 50,
        refText: 'ABIM 20-50 %',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        low: 20,
        high: 48,
        refText: 'Quest M 20-48 %',
        source: 'secondary',
        sourceUrl: TESTING_TIBC,
      },
      {
        sex: 'female',
        low: 16,
        high: 45,
        refText: 'Quest F 16-45 %',
        source: 'secondary',
        sourceUrl: TESTING_TIBC,
        note: 'Derived from iron / TIBC.',
      },
    ],
  },
  {
    key: 'vitamin_b12',
    displayName: 'Vitamin B12',
    category: 'Iron/Vitamins',
    unit: 'pg/mL',
    aliases: ['Vitamin B12', 'B12', 'Cobalamin'],
    bands: [
      {
        sex: 'any',
        low: 200,
        high: 1100,
        refText: '200-1100 pg/mL (approximate)',
        source: 'secondary',
        sourceUrl: TESTING_B12,
        note:
          'FLAG: the lower limit is debated (~200 vs ~300 pg/mL) because neurological deficiency can occur with values in the 200-300 pg/mL "borderline" band.',
      },
    ],
  },
  {
    key: 'folate',
    displayName: 'Folate, serum',
    category: 'Iron/Vitamins',
    unit: 'ng/mL',
    aliases: ['Folate', 'Folic Acid', 'Serum Folate'],
    bands: [
      {
        sex: 'any',
        low: 1.8,
        high: 9.0,
        refText: 'ABIM 1.8-9.0 ng/mL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'any',
        minAge: 18,
        low: 5.4,
        high: null,
        refText: '>5.4 ng/mL normal (>=18 y)',
        source: 'secondary',
        sourceUrl: TESTING_FOLATE,
        note:
          'FLAG: the ABIM and Quest intervals disagree (ABIM lower limit 1.8 vs Quest defining low as <3.4; borderline 3.4-5.4). Red-cell folate is a different test.',
      },
    ],
  },
  {
    key: 'vitamin_d_25oh',
    displayName: '25-hydroxy vitamin D',
    category: 'Iron/Vitamins',
    unit: 'ng/mL',
    aliases: ['25-OH Vitamin D', '25(OH)D', 'Vitamin D, 25-Hydroxy', 'vitamin_d_25_oh_total_ia'],
    bands: [
      {
        sex: 'any',
        low: 20,
        high: null,
        refText: '>=20 ng/mL (sufficient)',
        source: 'guideline',
        sourceUrl: NIH_VITD,
        note:
          'NIH ODS: sufficient >=20 ng/mL (50 nmol/L); deficiency risk <12 ng/mL (30 nmol/L). FLAG: "normal" vitamin D is genuinely controversial — this federal sufficient threshold differs from the >=30 ng/mL often used clinically. Unit conversion stated by NIH ODS: 1 nmol/L = 0.4 ng/mL.',
      },
      {
        sex: 'any',
        low: 30,
        high: 100,
        refText: '30-100 ng/mL sufficient',
        source: 'secondary',
        sourceUrl: TESTING_VITD,
        note: 'The second, disagreeing source (deficient <20, insufficient 20-29).',
      },
    ],
  },

  // ── Inflammation / other ──────────────────────────────────────────────────
  {
    key: 'hs_crp',
    displayName: 'High-sensitivity C-reactive protein',
    category: 'Inflammation',
    unit: 'mg/L',
    aliases: ['hs-CRP', 'hsCRP', 'High Sensitivity CRP'],
    bands: [],
    note:
      'No agreed interval — leave unscored. What is published is a set of cardiovascular RISK categories (AHA/CDC): <1.0 low, 1.0-3.0 moderate/average, >3.0 high, >10 likely acute illness. Assay-dependent.',
  },
  {
    key: 'crp',
    displayName: 'C-reactive protein',
    category: 'Inflammation',
    unit: 'mg/L (or mg/dL)',
    aliases: ['CRP', 'C-Reactive Protein'],
    bands: [
      {
        sex: 'any',
        low: null,
        high: 8,
        refText: '<=8 mg/L (ABIM <=0.8 mg/dL)',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'Unit trap: 0.8 mg/dL = 8 mg/L. Confirm which unit the report prints. Testing.com states normal <8.0 mg/L (some labs use 10). Rises with any acute infection/inflammation.',
      },
    ],
  },
  {
    key: 'esr',
    displayName: 'Erythrocyte sedimentation rate',
    category: 'Inflammation',
    unit: 'mm/hr',
    aliases: ['ESR', 'Sed Rate', 'Westergren'],
    bands: [
      {
        sex: 'male',
        maxAge: 49,
        low: 0,
        high: 15,
        refText: 'M <50 y 0-15 mm/hr',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        minAge: 50,
        low: 0,
        high: 20,
        refText: 'M >=50 y 0-20 mm/hr',
        source: 'secondary',
        sourceUrl: TESTING_ESR,
      },
      {
        sex: 'female',
        maxAge: 49,
        low: 0,
        high: 20,
        refText: 'F <50 y 0-20 mm/hr',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'female',
        minAge: 50,
        low: 0,
        high: 30,
        refText: 'F >=50 y 0-30 mm/hr',
        source: 'secondary',
        sourceUrl: TESTING_ESR,
        note: 'FLAG: no single universal interval; increases with age and in pregnancy.',
      },
    ],
  },
  {
    key: 'homocysteine',
    displayName: 'Homocysteine, total',
    category: 'Inflammation',
    unit: 'µmol/L',
    aliases: ['Homocysteine', 'tHcy'],
    bands: [
      {
        sex: 'any',
        low: 5,
        high: 15,
        refText: 'ABIM 5-15 µmol/L',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: no single agreed interval; sample handling matters. Testing.com: "normal below about 11-15, varies by age and sex"; categories moderate 15-30, intermediate 30-100, severe >100 µmol/L.',
      },
    ],
  },

  // ── Hormones ──────────────────────────────────────────────────────────────
  {
    key: 'total_testosterone',
    displayName: 'Testosterone, total',
    category: 'Hormones',
    unit: 'ng/dL',
    aliases: ['Testosterone, Total', 'Total T'],
    bands: [
      {
        sex: 'male',
        low: 291,
        high: 1100,
        refText: 'ABIM M 291-1100 ng/dL',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'FLAG: sex-specific and assay-dependent (immunoassay vs LC-MS/MS); draw in the morning.',
      },
      {
        sex: 'female',
        low: 18,
        high: 54,
        refText: 'ABIM F 18-54 ng/dL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
    ],
  },
  {
    key: 'free_testosterone',
    displayName: 'Testosterone, free',
    category: 'Hormones',
    unit: 'pg/mL',
    aliases: ['Free Testosterone', 'Free T', '% Free Testosterone'],
    bands: [
      {
        sex: 'male',
        minAge: 18,
        maxAge: 69,
        low: 46.0,
        high: 224.0,
        refText: 'Quest M 18-69 y 46.0-224.0 pg/mL',
        source: 'secondary',
        sourceUrl: TESTING_FT,
      },
      {
        sex: 'male',
        minAge: 70,
        maxAge: 89,
        low: 6.0,
        high: 73.0,
        refText: 'Quest M 70-89 y 6.0-73.0 pg/mL',
        source: 'secondary',
        sourceUrl: TESTING_FT,
      },
      {
        sex: 'female',
        minAge: 18,
        maxAge: 69,
        low: 0.2,
        high: 5.0,
        refText: 'Quest F 18-69 y 0.2-5.0 pg/mL',
        source: 'secondary',
        sourceUrl: TESTING_FT,
      },
      {
        sex: 'female',
        minAge: 70,
        maxAge: 89,
        low: 0.3,
        high: 5.0,
        refText: 'Quest F 70-89 y 0.3-5.0 pg/mL',
        source: 'secondary',
        sourceUrl: TESTING_FT,
        note:
          'FLAG: strongly method-dependent. ABIM gives free testosterone M 70-300 pg/mL, and Testing.com\'s other page gives adult men ~9-30 pg/mL — the three ranges differ by method. Do not colour without the report\'s own interval.',
      },
    ],
  },
  {
    key: 'estradiol',
    displayName: 'Estradiol (E2)',
    category: 'Hormones',
    unit: 'pg/mL',
    aliases: ['Estradiol', 'E2', 'Oestradiol'],
    bands: [
      {
        sex: 'female',
        low: 10,
        high: 180,
        refText: 'F follicular 10-180 pg/mL',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: cycle-phase dependent in premenopausal women. ABIM: follicular 10-180, mid-cycle peak 100-300, luteal 40-200, postmenopausal <10. Testing.com gives comparable phase bands and postmenopausal 0-30 pg/mL. Use the phase band or leave unscored.',
      },
      {
        sex: 'male',
        low: 20,
        high: 50,
        refText: 'M 20-50 pg/mL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
    ],
  },
  {
    key: 'shbg',
    displayName: 'Sex hormone-binding globulin',
    category: 'Hormones',
    unit: 'nmol/L',
    aliases: ['SHBG', 'Sex Hormone Binding Globulin'],
    bands: [
      {
        sex: 'male',
        minAge: 18,
        maxAge: 55,
        low: 10,
        high: 50,
        refText: 'M 18-55 y 10-50 nmol/L',
        source: 'secondary',
        sourceUrl: TESTING_SHBG,
      },
      {
        sex: 'male',
        minAge: 56,
        low: 22,
        high: 77,
        refText: 'M >55 y 22-77 nmol/L',
        source: 'secondary',
        sourceUrl: TESTING_SHBG,
      },
      {
        sex: 'female',
        minAge: 18,
        maxAge: 55,
        low: 17,
        high: 124,
        refText: 'F (not pregnant) 18-55 y 17-124 nmol/L',
        source: 'secondary',
        sourceUrl: TESTING_SHBG,
      },
      {
        sex: 'female',
        minAge: 56,
        low: 14,
        high: 73,
        refText: 'F >55 y 14-73 nmol/L',
        source: 'secondary',
        sourceUrl: TESTING_SHBG,
        note: 'FLAG: assay-dependent; rises with age and hyperthyroidism/oestrogen, falls with obesity/insulin resistance.',
      },
    ],
  },
  {
    key: 'psa',
    displayName: 'Prostate-specific antigen',
    category: 'Hormones',
    unit: 'ng/mL',
    aliases: ['PSA', 'Total PSA'],
    bands: [],
    note:
      'No agreed interval — leave unscored. ABIM states "no specific normal or abnormal level". <4.0 ng/mL is commonly considered normal and 4.0-10.0 a borderline zone, but this is a screening convention, not a reference interval, and is age-dependent.',
  },
  {
    key: 'lh',
    displayName: 'Luteinizing hormone',
    category: 'Hormones',
    unit: 'mIU/mL (IU/L)',
    aliases: ['LH', 'Lutropin'],
    bands: [
      {
        sex: 'female',
        low: 1.9,
        high: 12.5,
        refText: 'F follicular 1.9-12.5 mIU/mL',
        source: 'secondary',
        sourceUrl: TESTING_LH,
        note:
          'FLAG: cycle-phase/puberty dependent. Testing.com: ovulation peak 8.7-76.3, luteal 0.5-16.9.',
      },
      {
        sex: 'male',
        minAge: 18,
        maxAge: 59,
        low: 1.5,
        high: 9.3,
        refText: 'M 18-59 y 1.5-9.3 mIU/mL',
        source: 'secondary',
        sourceUrl: TESTING_LH,
      },
      {
        sex: 'male',
        minAge: 60,
        low: 1.6,
        high: 15.2,
        refText: 'M >=60 y 1.6-15.2 mIU/mL',
        source: 'secondary',
        sourceUrl: TESTING_LH,
      },
    ],
  },
  {
    key: 'fsh',
    displayName: 'Follicle-stimulating hormone',
    category: 'Hormones',
    unit: 'mIU/mL (IU/L)',
    aliases: ['FSH'],
    bands: [
      {
        sex: 'female',
        low: 2,
        high: 9,
        refText: 'ABIM F follicular/luteal 2-9 mIU/mL',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: sources disagree (esp. male upper limit 7 vs 12.8); cycle-phase dependent. ABIM: mid-cycle 4-22, postmenopausal >30. Testing.com: F follicular 2.5-10.2, mid-cycle 3.1-17.7, luteal 1.5-9.1, postmenopausal 23.0-116.3.',
      },
      {
        sex: 'male',
        low: 1,
        high: 7,
        refText: 'ABIM M (adult) 1-7 mIU/mL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        low: 1.4,
        high: 12.8,
        refText: 'M 1.4-12.8 mIU/mL',
        source: 'secondary',
        sourceUrl: TESTING_FSH,
        note: 'The second, disagreeing source for this analyte.',
      },
    ],
  },
  {
    key: 'dhea_s',
    displayName: 'DHEA sulfate',
    category: 'Hormones',
    unit: 'µg/dL (mcg/dL)',
    aliases: ['DHEA-S', 'DHEAS', 'Dehydroepiandrosterone sulfate'],
    bands: [
      {
        sex: 'female',
        low: 44,
        high: 332,
        refText: 'ABIM F 44-332 µg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        low: 89,
        high: 457,
        refText: 'ABIM M 89-457 µg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'FLAG: falls markedly with age; use the age band.',
      },
      {
        sex: 'female',
        minAge: 20,
        maxAge: 29,
        low: 65,
        high: 380,
        refText: 'F 20-29 y 65-380 µg/dL',
        source: 'secondary',
        sourceUrl: TESTING_DHEAS,
      },
      {
        sex: 'male',
        minAge: 20,
        maxAge: 29,
        low: 280,
        high: 640,
        refText: 'M 20-29 y 280-640 µg/dL',
        source: 'secondary',
        sourceUrl: TESTING_DHEAS,
      },
      {
        sex: 'female',
        minAge: 40,
        maxAge: 49,
        low: 32,
        high: 240,
        refText: 'F 40-49 y 32-240 µg/dL',
        source: 'secondary',
        sourceUrl: TESTING_DHEAS,
      },
      {
        sex: 'male',
        minAge: 40,
        maxAge: 49,
        low: 95,
        high: 530,
        refText: 'M 40-49 y 95-530 µg/dL',
        source: 'secondary',
        sourceUrl: TESTING_DHEAS,
      },
      {
        sex: 'female',
        minAge: 50,
        maxAge: 59,
        low: 26,
        high: 200,
        refText: 'F 50-59 y 26-200 µg/dL',
        source: 'secondary',
        sourceUrl: TESTING_DHEAS,
      },
      {
        sex: 'male',
        minAge: 50,
        maxAge: 59,
        low: 70,
        high: 310,
        refText: 'M 50-59 y 70-310 µg/dL',
        source: 'secondary',
        sourceUrl: TESTING_DHEAS,
      },
      {
        sex: 'female',
        minAge: 60,
        low: 13,
        high: 130,
        refText: 'F 60+ y 13-130 µg/dL',
        source: 'secondary',
        sourceUrl: TESTING_DHEAS,
      },
      {
        sex: 'male',
        minAge: 60,
        low: 42,
        high: 290,
        refText: 'M 60+ y 42-290 µg/dL',
        source: 'secondary',
        sourceUrl: TESTING_DHEAS,
      },
    ],
  },
  {
    key: 'cortisol_am',
    displayName: 'Cortisol, morning (AM)',
    category: 'Hormones',
    unit: 'µg/dL',
    aliases: ['Cortisol', 'AM Cortisol', '8 AM Cortisol', 'cortisol_total'],
    bands: [
      {
        sex: 'any',
        low: 5,
        high: 25,
        refText: 'ABIM 8 AM 5-25 µg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: interpretation depends on collection time; not meaningful without it. ABIM 4 PM <10; Testing.com AM (7-9 a.m.) 4.0-22.0, PM (3-5 p.m.) 3.0-17.0.',
      },
    ],
  },
  {
    key: 'igf_1',
    displayName: 'Insulin-like growth factor 1',
    category: 'Hormones',
    unit: 'ng/mL',
    aliases: ['IGF-1', 'Somatomedin-C'],
    bands: [
      {
        sex: 'any',
        minAge: 16,
        maxAge: 24,
        low: 182,
        high: 780,
        refText: 'ABIM 16-24 y 182-780 ng/mL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'any',
        minAge: 25,
        maxAge: 39,
        low: 114,
        high: 492,
        refText: 'ABIM 25-39 y 114-492 ng/mL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'any',
        minAge: 40,
        maxAge: 54,
        low: 90,
        high: 360,
        refText: 'ABIM 40-54 y 90-360 ng/mL',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'any',
        minAge: 55,
        low: 71,
        high: 290,
        refText: 'ABIM >=55 y 71-290 ng/mL',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: age- and sex-dependent; Testing.com (Quest) gives narrower adult bands (e.g. 20-24.9 y 83-456; 70-79.9 y 34-245 ng/mL). Use the age band or leave unscored.',
      },
    ],
  },

  // ── Coagulation ───────────────────────────────────────────────────────────
  {
    key: 'inr',
    displayName: 'International normalised ratio',
    category: 'Coagulation',
    unit: 'ratio (unitless)',
    aliases: ['INR', 'Prothrombin INR'],
    bands: [
      {
        sex: 'any',
        low: 0.9,
        high: 1.1,
        refText: '0.9-1.1 ratio (not on anticoagulants)',
        source: 'secondary',
        sourceUrl: TESTING_PTT,
        note:
          'FLAG: 2.0-3.0 is the THERAPEUTIC TARGET on warfarin therapy (2.5-3.5 for some mechanical valves), not a reference interval. Do not colour a treated patient\'s INR against 0.9-1.1. Reagent-dependent.',
      },
    ],
  },
  {
    key: 'pt',
    displayName: 'Prothrombin time',
    category: 'Coagulation',
    unit: 'seconds',
    aliases: ['PT', 'Protime', 'Prothrombin Time'],
    bands: [
      {
        sex: 'any',
        low: 11,
        high: 13,
        refText: 'ABIM 11-13 seconds',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'FLAG: strongly reagent/method-dependent; sources disagree (11-13 vs 9.0-11.5).',
      },
      {
        sex: 'any',
        low: 9.0,
        high: 11.5,
        refText: '9.0-11.5 seconds',
        source: 'secondary',
        sourceUrl: TESTING_PTINR,
        note: 'The second, disagreeing source (Cleveland Clinic via Testing.com).',
      },
    ],
  },
  {
    key: 'aptt',
    displayName: 'Activated partial thromboplastin time',
    category: 'Coagulation',
    unit: 'seconds',
    aliases: ['aPTT', 'PTT', 'APTT'],
    bands: [
      {
        sex: 'any',
        low: 25,
        high: 35,
        refText: 'ABIM 25-35 seconds',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'FLAG: lab/reagent-dependent. On heparin the target is 1.5-2.5 x the control value, not a fixed number.',
      },
      {
        sex: 'any',
        low: 23,
        high: 32,
        refText: 'PTT 23-32 seconds',
        source: 'secondary',
        sourceUrl: TESTING_PTT,
        note: 'The second, disagreeing source for this analyte.',
      },
    ],
  },
  {
    key: 'fibrinogen',
    displayName: 'Fibrinogen',
    category: 'Coagulation',
    unit: 'mg/dL',
    aliases: ['Fibrinogen', 'Factor I'],
    bands: [
      {
        sex: 'any',
        low: 200,
        high: 400,
        refText: '200-400 mg/dL',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'Testing.com quotes the same 200-400 mg/dL from ABIM.',
      },
    ],
  },
  {
    key: 'd_dimer',
    displayName: 'D-dimer',
    category: 'Coagulation',
    unit: 'µg/mL (or ng/mL FEU)',
    aliases: ['D-dimer', 'Fibrin degradation product (D-D)'],
    bands: [
      {
        sex: 'any',
        low: null,
        high: 0.5,
        refText: '<0.5 µg/mL',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: unit ambiguity — results are reported as µg/mL FEU, ng/mL FEU, or ng/mL DDU, which are not interchangeable; the cut-off is adjusted for age in some algorithms. Check the report\'s unit and interval.',
      },
    ],
  },

  // ── Cardiac / muscle ──────────────────────────────────────────────────────
  {
    key: 'troponin_hs',
    displayName: 'Troponin, high-sensitivity',
    category: 'Cardiac/Muscle',
    unit: 'ng/L (pg/mL)',
    aliases: ['hs-Troponin', 'hs-cTn', 'hs-TnT', 'hs-TnI'],
    bands: [
      {
        sex: 'female',
        low: null,
        high: 10,
        refText: 'ABIM hs-TnT F <=10 ng/L',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        low: null,
        high: 15,
        refText: 'ABIM hs-TnT M <=15 ng/L',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'FLAG: highly assay-specific (TnT vs TnI, manufacturer); the "normal" value is the assay\'s 99th percentile and differs between them. Never apply one vendor\'s cut-off to another\'s assay. ABIM hs-TnI: F <=15, M <=20. Sex-specific.',
      },
      {
        sex: 'female',
        low: null,
        high: 14,
        refText: 'LabCorp hs-TnT F 0-14 ng/L',
        source: 'secondary',
        sourceUrl: TESTING_TROPONIN,
      },
      {
        sex: 'male',
        low: null,
        high: 22,
        refText: 'LabCorp hs-TnT M 0-22 ng/L',
        source: 'secondary',
        sourceUrl: TESTING_TROPONIN,
        note: 'The second, disagreeing source (a different assay).',
      },
    ],
  },
  {
    key: 'bnp',
    displayName: 'B-type natriuretic peptide',
    category: 'Cardiac/Muscle',
    unit: 'pg/mL',
    aliases: ['BNP', 'B-type Natriuretic Peptide'],
    bands: [],
    note:
      'No agreed interval — leave unscored. Published numbers are heart-failure rule-out thresholds, not a reference interval: <100 pg/mL (HF unlikely), 100-400 (grey zone), >400 (HF likely). Rises with age; assay/lab-dependent.',
  },
  {
    key: 'nt_probnp',
    displayName: 'N-terminal pro-BNP',
    category: 'Cardiac/Muscle',
    unit: 'pg/mL',
    aliases: ['NT-proBNP', 'N-terminal proBNP'],
    bands: [
      {
        sex: 'any',
        minAge: 18,
        maxAge: 49,
        low: null,
        high: 300,
        refText: '18-49 y HF unlikely <=300 pg/mL',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'Rule-in >=450 pg/mL this age. These are diagnostic thresholds, not a healthy reference interval.',
      },
      {
        sex: 'any',
        minAge: 50,
        maxAge: 75,
        low: null,
        high: 300,
        refText: '50-75 y HF unlikely <=300 pg/mL',
        source: 'textbook',
        sourceUrl: ABIM,
        note: 'Rule-in >=900 pg/mL this age.',
      },
      {
        sex: 'any',
        minAge: 76,
        low: null,
        high: 300,
        refText: '>75 y HF unlikely <=300 pg/mL',
        source: 'textbook',
        sourceUrl: ABIM,
        note:
          'Rule-in >=1800 pg/mL this age. FLAG: these are diagnostic rule-in/rule-out thresholds for heart failure, not a healthy reference interval, and are age-dependent (and affected by kidney function).',
      },
    ],
  },
  {
    key: 'ck',
    displayName: 'Creatine kinase',
    category: 'Cardiac/Muscle',
    unit: 'U/L',
    aliases: ['CK', 'CPK', 'Creatine Kinase', 'creatininekinase'],
    bands: [
      {
        sex: 'female',
        low: 30,
        high: 135,
        refText: 'ABIM F 30-135 U/L',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        low: 55,
        high: 170,
        refText: 'ABIM M 55-170 U/L',
        source: 'textbook',
        sourceUrl: ABIM,
      },
      {
        sex: 'male',
        minAge: 19,
        maxAge: 49,
        low: 26,
        high: 366,
        refText: 'M 19-49 y 26-366 U/L',
        source: 'secondary',
        sourceUrl: TESTING_CK,
      },
      {
        sex: 'female',
        minAge: 19,
        maxAge: 49,
        low: 20,
        high: 239,
        refText: 'F 19-49 y 20-239 U/L',
        source: 'secondary',
        sourceUrl: TESTING_CK,
      },
      {
        sex: 'male',
        minAge: 70,
        maxAge: 79,
        low: 19,
        high: 278,
        refText: 'M 70-79 y 19-278 U/L',
        source: 'secondary',
        sourceUrl: TESTING_CK,
      },
      {
        sex: 'female',
        minAge: 70,
        maxAge: 79,
        low: 18,
        high: 225,
        refText: 'F 70-79 y 18-225 U/L',
        source: 'secondary',
        sourceUrl: TESTING_CK,
        note: 'FLAG: sex- and age-dependent, and rises after exercise; sources differ widely (peak in young men).',
      },
    ],
  },

  // ── Other (derived / legacy names the reports print) ──────────────────────
  {
    key: 'cholesterol_hdl_ratio',
    displayName: 'Cholesterol/HDL ratio',
    category: 'Lipids',
    unit: 'ratio',
    aliases: ['CHD', 'Cholesterol/HDL Ratio', 'cholesterol/hdlratio', 'chol_hdlc_ratio'],
    bands: [],
    note: 'Derived ratio; the cited document gives no interval — left unscored.',
  },
  {
    key: 'ldl_hdl_ratio',
    displayName: 'LDL/HDL ratio',
    category: 'Lipids',
    unit: 'ratio',
    // "LDL/HDL RATIO" is what the owner's report prints; the extractor's own key
    // for it is the slug `ldl_hdl_ratio`, which is this entry's canonical key.
    aliases: ['LDL/HDL Ratio', 'LDL:HDL Ratio', 'ldl/hdlratio'],
    bands: [],
    note: 'Derived ratio; the cited document gives no interval — left unscored.',
  },

  // ── Urinalysis ────────────────────────────────────────────────────────────
  //
  // The urine-only analytes a dipstick, a visual check and a sediment count
  // print. EVERY ONE IS A QUALITATIVE RESULT: a pad reports a colour or a grade
  // and a microscope reports `NONE SEEN`, so none of them has a numeric interval
  // this registry could band — each has NO bands, and its row is scored against
  // the expected value the report itself printed (see ../status.ts and the closed
  // vocabulary in ../qualitative.ts). `unit` is null for the same reason: the
  // per-field units the reports print (`/HPF`, `/LPF`) belong to the row.
  //
  // WHY A CATEGORY OF THEIR OWN. `protein`, `bilirubin`, `ketones` and `glucose`
  // here are URINE readings; the serum analytes of the same names are separate
  // entries. The series read model keeps a urinalysis series apart from the blood
  // series of the same key (see ../panel.ts), and this category is where those
  // urine rows are laid out.
  {
    key: 'appearance',
    displayName: 'Appearance',
    category: 'Urinalysis',
    unit: null,
    aliases: [],
    bands: [],
    note: 'A visual check of the sample, reported as a word (CLEAR, SLIGHTLY CLOUDY). No interval exists to score it against.',
  },
  {
    key: 'color',
    displayName: 'Color',
    category: 'Urinalysis',
    unit: null,
    aliases: ['Colour'],
    bands: [],
    note: 'A visual check of the sample colour, reported as a word (YELLOW, AMBER). No interval exists to score it against.',
  },
  {
    key: 'ph',
    displayName: 'pH',
    category: 'Urinalysis',
    unit: null,
    aliases: ['Urine pH'],
    bands: [],
    note: 'The acidity of the urine, read from a dipstick pad. The cited document gives no interval for it — left unscored, and the report’s own printed interval is used when it prints one.',
  },
  {
    key: 'specific_gravity',
    displayName: 'Specific gravity',
    category: 'Urinalysis',
    unit: null,
    aliases: ['S.G.', 'Urine specific gravity'],
    bands: [],
    note: 'How concentrated the urine is. Concentration depends on when the sample was taken and how much was drunk, so the cited document gives no interval — left unscored, and the report’s own printed interval is used when it prints one.',
  },
  {
    key: 'ketones',
    displayName: 'Ketones',
    category: 'Urinalysis',
    unit: null,
    aliases: ['Ketones, urine', 'Urine ketones'],
    bands: [],
    note: 'A urine dipstick pad for ketones, reported as NEGATIVE or as a grade (TRACE, 1+). No interval exists to score it against.',
  },
  {
    key: 'nitrite',
    displayName: 'Nitrite',
    category: 'Urinalysis',
    unit: null,
    aliases: ['Nitrites'],
    bands: [],
    note: 'A urine dipstick pad for nitrites, reported as NEGATIVE or POSITIVE. No interval exists to score it against.',
  },
  {
    key: 'occult_blood',
    displayName: 'Occult blood',
    category: 'Urinalysis',
    unit: null,
    aliases: ['Blood, urine', 'Urine blood', 'Blood (urine)'],
    bands: [],
    note: 'A urine dipstick pad for blood too small to see, reported as NEGATIVE or as a grade. No interval exists to score it against.',
  },
  {
    key: 'leukocyte_esterase',
    displayName: 'Leukocyte esterase',
    category: 'Urinalysis',
    unit: null,
    aliases: ['LE', 'Leukocytes, urine'],
    bands: [],
    note: 'A urine dipstick pad for white blood cells, reported as NEGATIVE or as a grade. No interval exists to score it against.',
  },
  {
    key: 'protein',
    displayName: 'Protein',
    category: 'Urinalysis',
    unit: null,
    // The SERUM protein is `total_protein`; this entry is the urine pad only, and
    // the extractor's own key for that row is the slug `protein`, which is this
    // entry's canonical key — no stored key is renamed to reach it.
    aliases: ['Protein, urine', 'Urine protein'],
    bands: [],
    note: 'A urine dipstick pad for protein, reported as NEGATIVE or as a grade. No interval exists to score it against.',
  },
  {
    key: 'bacteria',
    displayName: 'Bacteria',
    category: 'Urinalysis',
    unit: null,
    aliases: ['Bacteria, urine'],
    bands: [],
    note: 'A microscopic check of the urine sediment, reported as NONE SEEN or as a count per field. No interval exists to score it against.',
  },
  {
    key: 'squamous_epithelial_cells',
    displayName: 'Squamous epithelial cells',
    category: 'Urinalysis',
    unit: null,
    aliases: ['Epithelial cells, squamous', 'Squamous cells'],
    bands: [],
    note: 'A microscopic count of the flat cells that line the urinary tract, per high-power field. No interval exists to score it against.',
  },
  {
    key: 'hyaline_cast',
    displayName: 'Hyaline casts',
    category: 'Urinalysis',
    unit: null,
    aliases: ['Hyaline casts', 'Casts, hyaline'],
    bands: [],
    note: 'A microscopic count of hyaline casts, per low-power field. No interval exists to score it against.',
  },
  {
    key: 'bilirubin',
    displayName: 'Bilirubin',
    category: 'Urinalysis',
    unit: null,
    // The SERUM rows are `total_bilirubin` / `direct_bilirubin` /
    // `bilirubin_indirect`; this entry is the urine pad, whose stored key is the
    // slug `bilirubin`.
    aliases: ['Bilirubin, urine', 'Urine bilirubin'],
    bands: [],
    note: 'A urine dipstick pad for bilirubin, reported as NEGATIVE or POSITIVE. No interval exists to score it against.',
  },

  // ── Analytes the reports print that the cited table does not band ─────────
  //
  // Each of these has patient-facing copy (see ../descriptions) but no interval
  // to fall back on, so `bands` is empty and the row is scored — where it is
  // scored at all — against the interval the report printed for it.
  {
    key: 'adiponectin',
    displayName: 'Adiponectin',
    category: 'Hormones',
    unit: null,
    aliases: [],
    bands: [],
    note: 'The cited document gives no interval for adiponectin — left unscored, and the report’s own printed interval is used when it prints one.',
  },
  {
    key: 'bilirubin_indirect',
    displayName: 'Bilirubin, indirect',
    category: 'Liver',
    unit: 'mg/dL',
    aliases: ['Indirect Bilirubin', 'Unconjugated bilirubin'],
    bands: [],
    note: 'Indirect bilirubin is derived from the total and the direct measurement, so the cited document quotes no interval of its own — left unscored, and the report’s own printed interval is used when it prints one.',
  },
  {
    key: 'fructosamine',
    displayName: 'Fructosamine',
    category: 'Metabolic',
    unit: null,
    aliases: [],
    bands: [],
    note: 'The cited document gives no interval for fructosamine — left unscored, and the report’s own printed interval is used when it prints one.',
  },
  {
    key: 'leptin',
    displayName: 'Leptin',
    category: 'Hormones',
    unit: null,
    aliases: [],
    bands: [],
    note: 'The cited document gives no interval for leptin — left unscored, and the report’s own printed interval is used when it prints one.',
  },
  {
    key: 't3_uptake',
    displayName: 'T3 uptake',
    category: 'Thyroid',
    unit: null,
    aliases: ['T3 Uptake', 'T3 Resin Uptake'],
    bands: [],
    note: 'An indirect measure of the thyroid hormone carrier protein, and method-dependent; the cited document gives no interval — left unscored, and the report’s own printed interval is used when it prints one.',
  },
  {
    key: 'testosterone_bioavailable',
    displayName: 'Testosterone, bioavailable',
    category: 'Hormones',
    unit: null,
    aliases: ['Bioavailable Testosterone'],
    bands: [],
    note: 'The cited document gives no interval for bioavailable testosterone — left unscored, and the report’s own printed interval is used when it prints one.',
  },

  // ── Derived rows a report prints as their own line ────────────────────────
  //
  // A report prints these as a row of their own, computed from other rows on the
  // same page (the differential percentages and the WBC, the A1c, the T4 and its
  // uptake). They are NOT described in the patient-facing copy (see
  // `UNDESCRIBED_BY_DESIGN` below) and carry no fallback interval: the report's
  // own printed interval is the only one they are scored against.
  {
    key: 'absolute_neutrophils',
    displayName: 'Absolute neutrophils',
    category: 'CBC',
    unit: 'cells/uL',
    aliases: [],
    bands: [],
    note: 'A computed row: the report derives the absolute count from the percentage and the white cell count. No interval is quoted for it here — the report’s own printed interval is used.',
  },
  {
    key: 'absolute_lymphocytes',
    displayName: 'Absolute lymphocytes',
    category: 'CBC',
    unit: 'cells/uL',
    aliases: [],
    bands: [],
    note: 'A computed row: the report derives the absolute count from the percentage and the white cell count. No interval is quoted for it here — the report’s own printed interval is used.',
  },
  {
    key: 'absolute_monocytes',
    displayName: 'Absolute monocytes',
    category: 'CBC',
    unit: 'cells/uL',
    aliases: [],
    bands: [],
    note: 'A computed row: the report derives the absolute count from the percentage and the white cell count. No interval is quoted for it here — the report’s own printed interval is used.',
  },
  {
    key: 'absolute_eosinophils',
    displayName: 'Absolute eosinophils',
    category: 'CBC',
    unit: 'cells/uL',
    aliases: [],
    bands: [],
    note: 'A computed row: the report derives the absolute count from the percentage and the white cell count. No interval is quoted for it here — the report’s own printed interval is used.',
  },
  {
    key: 'absolute_basophils',
    displayName: 'Absolute basophils',
    category: 'CBC',
    unit: 'cells/uL',
    aliases: [],
    bands: [],
    note: 'A computed row: the report derives the absolute count from the percentage and the white cell count. No interval is quoted for it here — the report’s own printed interval is used.',
  },
  {
    key: 'eag_mg_dl',
    displayName: 'Estimated average glucose (mg/dL)',
    category: 'Metabolic',
    unit: 'mg/dL',
    aliases: ['eAG (mg/dL)', 'Estimated Average Glucose (mg/dL)'],
    bands: [],
    note: 'A computed row derived from the A1c; the cited document gives no interval of its own. The A1c is the row that carries an interval.',
  },
  {
    key: 'eag_mmol_l',
    displayName: 'Estimated average glucose (mmol/L)',
    category: 'Metabolic',
    unit: 'mmol/L',
    aliases: ['eAG (mmol/L)', 'Estimated Average Glucose (mmol/L)'],
    bands: [],
    note: 'A computed row derived from the A1c, in SI units; the cited document gives no interval of its own. The A1c is the row that carries an interval.',
  },
  {
    key: 'free_t4_index_t7',
    displayName: 'Free T4 index (T7)',
    category: 'Thyroid',
    unit: null,
    aliases: ['Free T4 Index', 'FTI', 'T7'],
    bands: [],
    note: 'A computed index derived from the total T4 and the T3 uptake. No interval is quoted for it here — the report’s own printed interval is used.',
  },
];

/**
 * Registry entries that deliberately carry NO patient-facing description.
 *
 * Every one is a DERIVED row (a report computes it from another row on the same
 * page: an absolute differential count, the estimated average glucose, the free
 * T4 index, HOMA-IR) or a DUPLICATE spelling whose real analyte is described
 * under its own entry. Declared here so a test can hold the line: a registry
 * entry without copy is a decision that was made, never an oversight. The
 * research pass's own source table is `analyte-descriptions SOURCES.md`.
 */
export const UNDESCRIBED_BY_DESIGN: string[] = [
  'absolute_basophils',
  'absolute_eosinophils',
  'absolute_lymphocytes',
  'absolute_monocytes',
  'absolute_neutrophils',
  'differential_absolute',
  'differential_percent',
  'eag_mg_dl',
  'eag_mmol_l',
  'estimated_average_glucose',
  'free_t4_index_t7',
  'homa_ir',
];

// ── Resolution ──────────────────────────────────────────────────────────────

/** The alias-map key: lowercase, with everything but letters, digits, % and # removed. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9%#]/g, '');
}

const BY_KEY = new Map<string, LabAnalyte>(ANALYTES.map(analyte => [analyte.key, analyte]));

const BY_ALIAS = new Map<string, LabAnalyte>();
for (const analyte of ANALYTES) {
  const names = [analyte.key, analyte.displayName, ...analyte.aliases];
  for (const name of names) {
    const lookup = normalizeName(name);
    if (!lookup) continue;
    // First registration wins: a canonical key or display name is never
    // overridden by a later analyte's alias.
    if (!BY_ALIAS.has(lookup)) BY_ALIAS.set(lookup, analyte);
  }
}

/** The documented slug fallback for a name the alias map does not know. */
export function slugFor(printedName: string): string {
  const slug = printedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'unknown';
}

export interface AnalyteResolution {
  /** The registered analyte, or null when the name is unrecognised. */
  analyte: LabAnalyte | null;
  /** The stable key: the analyte's own, or the documented slug fallback. */
  key: string;
  /** True when the key came from the slug fallback rather than the registry. */
  fallback: boolean;
}

/**
 * Resolve a printed name (or a stored key) to a registry entry.
 *
 * Order: the alias map (case/whitespace/punctuation normalised) first, then the
 * documented slug fallback. An unrecognised name still gets a stable key and is
 * never dropped.
 */
export function resolveAnalyte(printedName: string): AnalyteResolution {
  const lookup = normalizeName(printedName ?? '');
  const analyte = lookup ? BY_ALIAS.get(lookup) ?? null : null;
  if (analyte) return { analyte, key: analyte.key, fallback: false };
  return { analyte: null, key: slugFor(printedName ?? ''), fallback: true };
}

/**
 * The registered analyte for a canonical key, for a stored key the extractor
 * wrote, or for any registered alias — or null when the name is unknown.
 *
 * WHY THE ALIAS MAP IS CONSULTED HERE. The registry's canonical key is not
 * always the key the extractor writes: `extract/parse.ts` owns the key
 * derivation (and must not change, because those keys are already stored on the
 * owner's real rows), and it writes keys such as `protein_total` where the
 * registry's canonical key is `total_protein`. Both spellings name the SAME
 * analyte, and the entry's own `aliases` carry the extractor's spelling, so a
 * stored key resolves to the entry that already describes it — otherwise a
 * stored row renders with a generic name, no category, no unit and no
 * description.
 *
 * A canonical key always wins: `BY_KEY` is consulted first, so a later entry's
 * alias can never shadow another entry's own key.
 */
export function analyteByKey(key: string): LabAnalyte | null {
  const direct = BY_KEY.get(key);
  if (direct) return direct;
  const lookup = normalizeName(key ?? '');
  return lookup ? (BY_ALIAS.get(lookup) ?? null) : null;
}

/** A display name for a key or printed name: the registry's, else the name as printed. */
export function displayNameFor(key: string, printedName?: string | null): string {
  const known = BY_KEY.get(key);
  if (known) return known.displayName;
  return printedName && printedName.trim().length > 0 ? printedName : key;
}