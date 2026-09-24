// ── Synthetic lab data for the analyst tests (TEST ONLY) ─────────────────────
//
// A small, entirely synthetic series read model — no real values, dates, names
// or identifiers — used to exercise the lab context block, the lab handler and
// the numeric-attribution guard without a database. Every observation is scored
// by the REAL status engine (`scoreResult`), so the fixture produces the same
// intervals and verdicts the Lab page produces, including the qualitative and
// bounded paths.
//
// Imported only by *.test.ts files; no application module imports it. It mirrors
// the convention of `test-doubles.ts`.

import { REFERENCE_KEY } from '@/lib/adapters/dataset';
import { scoreResult } from '@/lib/lab/status';
import { buildLabSnapshot, type LabSeriesInput, type LabSeriesObservationInput, type LabSourceInput } from './labSnapshot';
import { retrieve, type LabSpec } from './retrieval';
import type { LabContextSnapshot, RetrievalBundle } from './types';

function observation(input: {
  on: string;
  value?: number | null;
  valueText?: string | null;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  printedRefText?: string | null;
}): LabSeriesObservationInput {
  const scored = scoreResult({
    value: input.value ?? null,
    valueText: input.valueText ?? null,
    refLow: input.refLow ?? null,
    refHigh: input.refHigh ?? null,
    refText: input.printedRefText ?? null,
    printedFlag: null,
    band: null,
  });
  return {
    on: input.on,
    value: input.value ?? null,
    valueText: input.valueText ?? null,
    unit: input.unit ?? null,
    printedRefText: input.printedRefText ?? null,
    interval: scored.interval,
    status: scored.status,
    statusLabel: scored.label,
    tone: scored.tone,
  };
}

function series(input: {
  seriesKey: string;
  analyteKey?: string;
  displayName: string;
  specimen?: 'urine' | 'other';
  registered?: boolean;
  unit?: string | null;
  points: LabSeriesObservationInput[];
}): LabSeriesInput {
  return {
    seriesKey: input.seriesKey,
    analyteKey: input.analyteKey ?? input.seriesKey.replace(/~urine$/, ''),
    displayName: input.displayName,
    specimen: input.specimen ?? (input.seriesKey.endsWith('~urine') ? 'urine' : 'other'),
    registered: input.registered ?? true,
    unit: input.unit ?? null,
    points: input.points,
  };
}

/** A synthetic dataset: a numeric trend, a single reading, a urine collision, a qualitative pair and a bounded grade. */
export function labSourceFixture(): LabSourceInput {
  const seriesList: LabSeriesInput[] = [
    series({
      seriesKey: 'total_cholesterol',
      displayName: 'Total cholesterol',
      unit: 'mg/dL',
      points: [
        observation({ on: '2023-02-01', value: 168, unit: 'mg/dL', refHigh: 200, printedRefText: '<200 mg/dL' }),
        observation({ on: '2023-08-01', value: 242, unit: 'mg/dL', refHigh: 200, printedRefText: '<200 mg/dL' }),
      ],
    }),
    series({
      seriesKey: 'hba1c',
      displayName: 'Haemoglobin A1c',
      unit: '%',
      points: [
        observation({ on: '2023-02-01', value: 5.2, unit: '%', refLow: 4.0, refHigh: 5.6, printedRefText: '4.0-5.6 %' }),
        observation({ on: '2023-08-01', value: 5.9, unit: '%', refLow: 4.0, refHigh: 5.6, printedRefText: '4.0-5.6 %' }),
      ],
    }),
    series({
      seriesKey: 'egfr',
      displayName: 'Estimated GFR',
      unit: 'mL/min/1.73 m²',
      points: [observation({ on: '2023-08-01', value: 88, unit: 'mL/min/1.73 m²', refLow: 60, printedRefText: '>60 mL/min/1.73 m²' })],
    }),
    // The urine/blood collision, kept apart by the specimen rule (gate 29h).
    series({
      seriesKey: 'glucose',
      displayName: 'Glucose (blood)',
      unit: 'mg/dL',
      points: [observation({ on: '2023-08-01', value: 92, unit: 'mg/dL', refLow: 70, refHigh: 99, printedRefText: '70-99 mg/dL' })],
    }),
    series({
      seriesKey: 'glucose~urine',
      displayName: 'Glucose (urine)',
      specimen: 'urine',
      unit: null,
      points: [observation({ on: '2023-08-01', valueText: 'NEGATIVE', printedRefText: 'NEGATIVE' })],
    }),
    series({
      seriesKey: 'leukocyte_esterase~urine',
      analyteKey: 'leukocyte_esterase',
      displayName: 'Leukocyte esterase (urine)',
      specimen: 'urine',
      unit: null,
      points: [observation({ on: '2023-08-01', value: 1, valueText: '1+', refHigh: 5, printedRefText: '< OR = 5 /HPF' })],
    }),
  ];

  const totalObservations = seriesList.reduce((a, s) => a + s.points.length, 0);
  return { available: true, reason: null, documents: 2, totalObservations, collisions: 0, series: seriesList };
}

/** A snapshot of the synthetic data for one question. */
export function labSnapshotFor(question: string, spec: LabSpec | null = null): LabContextSnapshot {
  return buildLabSnapshot(labSourceFixture(), { question, spec });
}

/**
 * A retrieval bundle for a handler, with the synthetic lab block attached —
 * exactly what the service attaches in production (see service.ts). Metric
 * handlers get their normal bundle; the lab handler gets the block its spec
 * declares.
 */
export function labBundleFor(handlerId: string, question: string, spec: LabSpec | null = { mode: 'analyte' }): RetrievalBundle {
  const bundle = retrieve(handlerId, REFERENCE_KEY);
  const lab = labSnapshotFor(question, spec);
  return { ...bundle, lab, recordsRead: bundle.recordsRead + lab.totalObservations };
}
