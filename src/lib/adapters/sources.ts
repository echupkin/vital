// ── Source de-duplication rule (SPEC §9) ────────────────
//
// The same interval can arrive from more than one device, and Health Auto
// Export encodes that overlap in the `source` string itself: a record seen by
// two exporters is tagged with both names joined by `|` (for example
// `"Apple Watch|iPhone"`). Blindly summing every record for a day therefore
// double-counts, and picking one device blindly throws away the intervals only
// the other device recorded.
//
// THE RULE (stated once, here, and surfaced in the provenance UI):
//
//   1. Split a composite source on `|` into its contributing devices.
//   2. Classify each device into a family (watch, phone, scale, cuff, other).
//   3. For each metric and each aggregation interval (one calendar day for every
//      metric in this build), find the highest-priority family that has any
//      record in that interval, and keep only the records whose best family is
//      that one. Records from a lower-priority device are dropped, never added.
//   4. Within the kept set, two records describing the same instant are still
//      one observation: the highest-priority record wins and the other is
//      dropped (`dedupeSameInstant`).
//   5. A sleep episode is identified by its in-bed window and its recorded
//      totals, not by the export timestamp, so an episode that was exported
//      twice is one night (`SLEEP_REPEAT_RULE` below, applied in
//      `normalizeSleep`). Two records that share a start instant but differ in
//      window or totals are two episodes and both are kept.
//
// The effect is "one device per metric per interval" — no double counting — and
// the dropped-source counts are reported so the UI can say what was set aside.

export type SourceFamily = 'watch' | 'phone' | 'scale' | 'cuff' | 'other';

export interface SourceRule {
  /** Ordered device families, highest priority first. */
  priority: SourceFamily[];
  /** Plain-language statement of the rule, shown in the provenance panel. */
  explanation: string;
}

/**
 * Family priorities per metric group.
 *
 * Watch metrics (movement, heart, sleep) prefer the watch, and fall back to the
 * phone only for intervals the watch did not record. Scale metrics have no
 * watch involvement at all — the scale is the only source that measures them.
 * Blood pressure prefers the cuff that took the reading.
 */
export const SOURCE_RULES: Record<string, SourceRule> = {
  watch_first: {
    priority: ['watch', 'phone', 'cuff', 'scale', 'other'],
    explanation:
      'The Apple Watch is preferred, and the phone is used only for intervals the watch did not record.',
  },
  scale_first: {
    priority: ['scale', 'other'],
    explanation:
      'Body measurements come from the connected scale; records from another source are kept only when the scale has none for that day.',
  },
  cuff_first: {
    priority: ['cuff', 'watch', 'phone', 'other'],
    explanation: 'The blood-pressure cuff that took the reading is preferred.',
  },
};

/** Rule id applied to each registry metric. */
export const SOURCE_RULE_BY_METRIC: Record<string, keyof typeof SOURCE_RULES> = {
  weight_body_mass: 'scale_first',
  body_mass_index: 'scale_first',
  body_fat_percentage: 'scale_first',
  lean_body_mass: 'scale_first',
  waist_circumference: 'scale_first',
  blood_pressure: 'cuff_first',
};

export function sourceRuleFor(metricId: string): SourceRule {
  const id = SOURCE_RULE_BY_METRIC[metricId] ?? 'watch_first';
  return SOURCE_RULES[id];
}

/** The stated rule for one metric, quoted in the provenance UI. */
export function sourceRuleExplanationFor(metricId: string): string {
  return sourceRuleFor(metricId).explanation;
}

/** The headline sentence for the whole layer, quoted in the provenance UI. */
export const SOURCE_DEDUPE_RULE =
  'One device is used per metric per interval. Composite sources such as ' +
  '“Apple Watch|iPhone” are split into their contributing devices, the ' +
  'highest-priority device that recorded the interval is kept, and the other device’s ' +
  'records are set aside rather than added.';

/**
 * Split a HAE source string into its contributing device names.
 * `"A|B"` → `['A', 'B']`; an empty source yields `[]` (the record is still kept,
 * attributed to "unattributed source").
 */
export function splitSources(source: string | null | undefined): string[] {
  if (source == null) return [];
  return String(source)
    .split('|')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/** Normalised, case- and punctuation-insensitive form of a device name. */
export function deviceNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Classify a single device name into a family. */
export function familyOf(name: string): SourceFamily {
  const key = deviceNameKey(name);
  if (!key) return 'other';
  if (/\bwatch\b/.test(key)) return 'watch';
  if (/(iphone|\bphone\b)/.test(key)) return 'phone';
  if (/renpho|scale|withings|eufy|fitbit aria/.test(key)) return 'scale';
  if (/vihealth|qardio|omron|cuff|blood pressure|bp monitor/.test(key)) return 'cuff';
  return 'other';
}

/** Family rank for a record's (possibly composite) source; lower is better. */
export function sourceRank(source: string, rule: SourceRule): number {
  const families = splitSources(source).map(familyOf);
  if (families.length === 0) {
    // An unattributed record is treated as the lowest-priority family that the
    // rule knows about, so an attributed record always wins the interval.
    return rule.priority.length;
  }
  return Math.min(...families.map(f => {
    const i = rule.priority.indexOf(f);
    return i === -1 ? rule.priority.length : i;
  }));
}

/** The display label kept for a record's source: the composite string, verbatim. */
export function sourceLabel(source: string | null | undefined): string {
  const parts = splitSources(source);
  return parts.length > 0 ? parts.join(' · ') : 'unattributed source';
}

export interface SourcedRecord {
  /** ISO instant of the observation. */
  date: string;
  source: string;
  [key: string]: unknown;
}

export interface DedupeResult<T extends SourcedRecord> {
  kept: T[];
  /** One entry per interval where records were set aside. */
  dropped: { intervalKey: string; keptSource: string; droppedSources: string[]; droppedCount: number }[];
  keptSources: string[];
}

/**
 * Keep one device per interval.
 *
 * `intervalKey` is the aggregation interval the metric uses — the calendar day
 * for every metric in this build. Records whose source ranks below the best
 * source present in that interval are set aside (not summed).
 */
export function dedupeByInterval<T extends SourcedRecord>(
  records: T[],
  rule: SourceRule,
  intervalKey: (record: T) => string
): DedupeResult<T> {
  const byInterval = new Map<string, T[]>();
  for (const r of records) {
    const key = intervalKey(r);
    const list = byInterval.get(key);
    if (list) list.push(r);
    else byInterval.set(key, [r]);
  }

  const kept: T[] = [];
  const dropped: DedupeResult<T>['dropped'] = [];

  for (const [key, group] of [...byInterval.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const best = Math.min(...group.map(r => sourceRank(r.source, rule)));
    const winners = group.filter(r => sourceRank(r.source, rule) === best);
    const losers = group.filter(r => sourceRank(r.source, rule) !== best);
    kept.push(...winners);
    if (losers.length > 0) {
      dropped.push({
        intervalKey: key,
        keptSource: [...new Set(winners.map(r => r.source))].join(' | '),
        droppedSources: [...new Set(losers.map(r => r.source))],
        droppedCount: losers.length,
      });
    }
  }

  return {
    kept,
    dropped,
    keptSources: [...new Set(kept.flatMap(r => splitSources(r.source)))].sort(),
  };
}

/**
 * Within one interval, two records describing the same observation are one
 * record. The highest-priority source wins; ties keep the first record.
 *
 * `identity` names the observation. It defaults to the record's instant, which
 * is what a simple metric uses; a sleep episode passes its in-bed window plus
 * its recorded totals instead, because the same episode can be exported twice
 * under two different `date` values.
 */
export function dedupeSameInstant<T extends SourcedRecord>(
  records: T[],
  rule: SourceRule,
  identity: (record: T) => string = record => record.date
): { kept: T[]; duplicates: number } {
  const byInstant = new Map<string, T>();
  let duplicates = 0;
  for (const r of records) {
    const key = identity(r);
    const existing = byInstant.get(key);
    if (!existing) {
      byInstant.set(key, r);
      continue;
    }
    duplicates += 1;
    if (sourceRank(r.source, rule) < sourceRank(existing.source, rule)) {
      byInstant.set(key, r);
    }
  }
  return { kept: [...byInstant.values()].sort((a, b) => a.date.localeCompare(b.date)), duplicates };
}

/**
 * The stated sleep-repeat rule, quoted where the other de-duplication rules are.
 *
 * Health Auto Export can export the same in-bed episode twice with two different
 * `date` values but an identical window and identical stage totals. The episode
 * is therefore identified by its in-bed window and its totals, and a repeat
 * collapses to one night under the same source priority as every other metric:
 * the highest-priority record wins and the other copy is set aside, never added.
 */
export const SLEEP_REPEAT_RULE =
  'A repeated sleep export is one night, not two: an episode is identified by its ' +
  'in-bed window and its recorded totals, and the highest-priority record is kept.';

