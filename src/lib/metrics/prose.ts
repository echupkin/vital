// ── Metric names in generated prose ─────────────────────
//
// A registry display name is a label ('Resting Heart Rate'), not a phrase. When
// a metric is named inside a generated sentence it needs a lower-case form and
// the right counting noun, otherwise a report reads "55.8 bpm of resting Heart
// Rate from 7 readings" instead of "55.8 bpm of resting heart rate".

import { getMetric } from './registry';

interface ProseEntry {
  /** How the metric is named inside a sentence. */
  name: string;
  /** What one observation of the metric is called. */
  noun: string;
  /** Plural form when it is irregular. */
  plural?: string;
}

const PROSE: Record<string, ProseEntry> = {
  sleep_analysis: { name: 'time asleep', noun: 'night', plural: 'nights' },
  sleep_in_bed: { name: 'time in bed', noun: 'night', plural: 'nights' },
  resting_heart_rate: { name: 'resting heart rate', noun: 'reading' },
  heart_rate_variability: { name: 'HRV', noun: 'reading' },
  walking_heart_rate: { name: 'walking heart rate', noun: 'reading' },
  vo2max: { name: 'VO₂ max', noun: 'reading' },
  blood_pressure: { name: 'blood pressure', noun: 'reading' },
  blood_oxygen_saturation: { name: 'blood oxygen', noun: 'reading' },
  respiratory_rate: { name: 'respiratory rate', noun: 'reading' },
  step_count: { name: 'steps', noun: 'recorded day' },
  apple_exercise_time: { name: 'exercise minutes', noun: 'day' },
  active_energy: { name: 'active calories', noun: 'day' },
  distance_walking_running: { name: 'walking and running distance', noun: 'day' },
  apple_stand_hours: { name: 'stand hours', noun: 'day' },
  weight_body_mass: { name: 'weight', noun: 'weigh-in' },
  body_fat_percentage: { name: 'body fat', noun: 'reading' },
  lean_body_mass: { name: 'lean body mass', noun: 'reading' },
  waist_circumference: { name: 'waist circumference', noun: 'reading' },
  dietary_energy: { name: 'logged calories', noun: 'logged day' },
  dietary_protein: { name: 'logged protein', noun: 'logged day' },
  dietary_carbs: { name: 'logged carbohydrates', noun: 'logged day' },
  dietary_fat_total: { name: 'logged fat', noun: 'logged day' },
  dietary_water: { name: 'logged water', noun: 'logged day' },
  dietary_caffeine: { name: 'logged caffeine', noun: 'logged day' },
};

/** Lower-case phrase naming a metric inside a sentence. */
export function proseName(metricId: string): string {
  const entry = PROSE[metricId];
  if (entry) return entry.name;
  const display = getMetric(metricId)?.displayName ?? metricId;
  // Unknown metric: keep acronyms, lower-case the rest.
  if (display.length <= 5 && display === display.toUpperCase()) return display;
  return display.charAt(0).toLowerCase() + display.slice(1);
}

/** 'night' / 'nights' / 'reading' / 'readings' … */
export function countNoun(metricId: string, count = 2): string {
  const entry = PROSE[metricId];
  const noun = entry?.noun ?? 'reading';
  if (count === 1) return noun;
  if (entry?.plural) return entry.plural;
  return `${noun}s`;
}

/** '11 min of exercise minutes a day' → '11 min of exercise minutes a day'. */
export function showedAs(metricId: string, value: string): string {
  return `${value} of ${proseName(metricId)}`;
}
