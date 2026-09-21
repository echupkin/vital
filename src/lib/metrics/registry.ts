// ── Metric Registry ─────────────────────────────────────
//
// Single source of truth for all known metrics.
// Every component derives labels, units, formatting, and availability from this registry.

import type { MetricDefinition, MetricCategory } from './types';

function fmt1(v: number) { return v.toFixed(1); }
function fmt0(v: number) { return v.toFixed(0); }
function fmtMin(v: number) {
  // Round once to a whole minute, otherwise a value like 419.6 renders as
  // "6h 60m" instead of "7h 0m".
  const total = Math.round(v);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
/** Count-style tick: never show a decimal for a count metric. */
function tickCount(v: number) {
  const a = Math.abs(v);
  if (a >= 1000) return `${(v / 1000).toFixed(a >= 10000 ? 0 : 1)}K`;
  return Math.round(v).toString();
}
function tick1(v: number) { return v.toFixed(1); }
function tick0(v: number) { return Math.round(v).toString(); }

const registry = new Map<string, MetricDefinition>();

function def(def: MetricDefinition): MetricDefinition {
  registry.set(def.id, def);
  return def;
}

// ── Cardiovascular ────────────────────────────────────
def({
  id: 'resting_heart_rate',
  displayName: 'Resting Heart Rate',
  aliases: ['RHR', 'resting HR', 'heart rate resting'],
  category: 'cardiovascular',
  canonicalUnit: 'bpm',
  shortUnit: 'bpm',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '90d',
  decimalPlaces: 1,
  formatter: (v) => fmt1(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'heart_rate_variability',
  displayName: 'HRV',
  aliases: ['heart rate variability', 'HRV SDNN', 'SDNN'],
  category: 'cardiovascular',
  canonicalUnit: 'ms',
  shortUnit: 'ms',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '90d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'walking_heart_rate',
  displayName: 'Walking Heart Rate',
  aliases: ['walking HR', 'average walking heart rate'],
  category: 'cardiovascular',
  canonicalUnit: 'bpm',
  shortUnit: 'bpm',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '90d',
  decimalPlaces: 1,
  formatter: (v) => fmt1(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'vo2max',
  displayName: 'VO₂ Max',
  aliases: ['vo2 max', 'cardio fitness', 'aerobic capacity'],
  category: 'cardiovascular',
  canonicalUnit: 'ml/kg/min',
  shortUnit: 'ml/kg/min',
  dataType: 'continuous',
  aggregationStrategy: 'latest',
  defaultRange: '1y',
  decimalPlaces: 1,
  formatter: (v) => fmt1(v),
  tickFormatter: tick1,
  minObservations: 1,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'blood_pressure',
  displayName: 'Blood Pressure',
  aliases: ['BP', 'blood pressure systolic', 'blood pressure diastolic'],
  category: 'cardiovascular',
  canonicalUnit: 'mmHg',
  shortUnit: 'mmHg',
  dataType: 'categorical',
  aggregationStrategy: 'latest',
  defaultRange: '1y',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 1,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'blood_oxygen_saturation',
  displayName: 'Blood Oxygen',
  aliases: ['SpO2', 'oxygen saturation', 'blood oxygen'],
  category: 'respiratory',
  canonicalUnit: '%',
  shortUnit: '%',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '90d',
  decimalPlaces: 1,
  formatter: (v) => `${fmt1(v)}%`,
  tickFormatter: tick1,
  minObservations: 1,
  demoAvailable: true,
  sourceNames: [],
});

// ── Sleep ─────────────────────────────────────────────
def({
  id: 'sleep_analysis',
  displayName: 'Sleep',
  aliases: ['sleep duration', 'time asleep', 'sleep time'],
  category: 'sleep',
  canonicalUnit: 'min',
  shortUnit: 'h',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '90d',
  decimalPlaces: 0,
  formatter: (v) => fmtMin(v),
  tickFormatter: (v) => `${(v / 60).toFixed(1)}h`,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'sleep_in_bed',
  displayName: 'Time in Bed',
  aliases: ['in bed', 'sleep in bed', 'time in bed'],
  category: 'sleep',
  canonicalUnit: 'min',
  shortUnit: 'h',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '90d',
  decimalPlaces: 0,
  formatter: (v) => fmtMin(v),
  tickFormatter: (v) => `${(v / 60).toFixed(1)}h`,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

// ── Activity ──────────────────────────────────────────
def({
  id: 'step_count',
  displayName: 'Steps',
  aliases: ['steps', 'step', 'daily steps'],
  category: 'activity',
  canonicalUnit: 'count',
  shortUnit: '',
  dataType: 'discrete',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => {
    const a = Math.abs(v);
    return a >= 1000 ? `${(v / 1000).toFixed(1)}K` : fmt0(v);
  },
  tickFormatter: tickCount,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'apple_exercise_time',
  displayName: 'Exercise Minutes',
  aliases: ['exercise', 'exercise time', 'workout minutes'],
  category: 'activity',
  canonicalUnit: 'min',
  shortUnit: 'min',
  dataType: 'continuous',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'active_energy',
  displayName: 'Active Calories',
  aliases: ['active energy', 'calories burned', 'active cal'],
  category: 'activity',
  canonicalUnit: 'kcal',
  shortUnit: 'kcal',
  dataType: 'continuous',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'distance_walking_running',
  displayName: 'Walking + Running Distance',
  aliases: ['distance', 'walking distance', 'running distance'],
  category: 'activity',
  canonicalUnit: 'km',
  shortUnit: 'km',
  dataType: 'continuous',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 1,
  formatter: (v) => fmt1(v),
  tickFormatter: tick1,
  minObservations: 3,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'apple_stand_hours',
  displayName: 'Stand Hours',
  aliases: ['stand hours', 'stand time'],
  category: 'activity',
  canonicalUnit: 'count',
  shortUnit: 'h',
  dataType: 'discrete',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

// ── Body ──────────────────────────────────────────────
def({
  id: 'weight_body_mass',
  displayName: 'Weight',
  aliases: ['body weight', 'body mass', 'scale weight'],
  category: 'body',
  canonicalUnit: 'kg',
  shortUnit: 'kg',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '1y',
  decimalPlaces: 1,
  formatter: (v) => fmt1(v),
  tickFormatter: tick1,
  minObservations: 1,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'body_fat_percentage',
  displayName: 'Body Fat',
  aliases: ['body fat', 'fat percentage'],
  category: 'body',
  canonicalUnit: '%',
  shortUnit: '%',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '1y',
  decimalPlaces: 1,
  formatter: (v) => `${fmt1(v)}%`,
  tickFormatter: tick1,
  minObservations: 1,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'lean_body_mass',
  displayName: 'Lean Body Mass',
  aliases: ['lean mass', 'muscle mass'],
  category: 'body',
  canonicalUnit: 'kg',
  shortUnit: 'kg',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '1y',
  decimalPlaces: 1,
  formatter: (v) => fmt1(v),
  tickFormatter: tick1,
  minObservations: 1,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'waist_circumference',
  displayName: 'Waist Circumference',
  aliases: ['waist'],
  category: 'body',
  canonicalUnit: 'cm',
  shortUnit: 'cm',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '1y',
  decimalPlaces: 1,
  formatter: (v) => fmt1(v),
  tickFormatter: tick1,
  minObservations: 1,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

// ── Respiratory ───────────────────────────────────────
def({
  id: 'respiratory_rate',
  displayName: 'Respiratory Rate',
  aliases: ['RR', 'breathing rate', 'resp rate'],
  category: 'respiratory',
  canonicalUnit: 'breaths/min',
  shortUnit: 'b/min',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '90d',
  decimalPlaces: 1,
  formatter: (v) => fmt1(v),
  tickFormatter: tick1,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

// ── Nutrition ─────────────────────────────────────────
def({
  id: 'dietary_energy',
  displayName: 'Calories (dietary)',
  aliases: ['calories eaten', 'dietary calories', 'food calories'],
  category: 'nutrition',
  canonicalUnit: 'kcal',
  shortUnit: 'kcal',
  dataType: 'continuous',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'dietary_protein',
  displayName: 'Protein',
  aliases: ['protein intake', 'dietary protein'],
  category: 'nutrition',
  canonicalUnit: 'g',
  shortUnit: 'g',
  dataType: 'continuous',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'dietary_carbs',
  displayName: 'Carbohydrates',
  aliases: ['carbs', 'carb intake', 'dietary carbs'],
  category: 'nutrition',
  canonicalUnit: 'g',
  shortUnit: 'g',
  dataType: 'continuous',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'dietary_fat_total',
  displayName: 'Total Fat',
  aliases: ['fat intake', 'dietary fat'],
  category: 'nutrition',
  canonicalUnit: 'g',
  shortUnit: 'g',
  dataType: 'continuous',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'dietary_caffeine',
  displayName: 'Caffeine',
  aliases: ['caffeine intake', 'coffee'],
  category: 'nutrition',
  canonicalUnit: 'mg',
  shortUnit: 'mg',
  dataType: 'continuous',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

def({
  id: 'dietary_water',
  displayName: 'Water',
  aliases: ['water intake', 'hydration'],
  category: 'nutrition',
  canonicalUnit: 'mL',
  shortUnit: 'mL',
  dataType: 'continuous',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}L` : `${fmt0(v)}`,
  tickFormatter: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}L` : fmt0(v),
  minObservations: 3,
  demoAvailable: true,
  sourceNames: [],
});

// ── Metrics present in the live Health Auto Export history ────────
//
// These are registered so that the live source can render them with the same
// registry-driven formatting as everything else. They carry no demo fixtures, so
// in demo mode they render as an explicit "not recorded in this demo dataset"
// state — never as zero and never as a fabricated series.

def({
  id: 'heart_rate',
  displayName: 'Heart Rate',
  aliases: ['heart rate', 'pulse', 'hr'],
  category: 'cardiovascular',
  canonicalUnit: 'bpm',
  shortUnit: 'bpm',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'cardio_recovery',
  displayName: 'Cardio Recovery',
  aliases: ['heart rate recovery', 'recovery heart rate'],
  category: 'cardiovascular',
  canonicalUnit: 'bpm',
  shortUnit: 'bpm',
  dataType: 'continuous',
  aggregationStrategy: 'latest',
  defaultRange: '1y',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 1,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'flights_climbed',
  displayName: 'Flights Climbed',
  aliases: ['flights', 'stairs', 'flights of stairs'],
  category: 'activity',
  canonicalUnit: 'count',
  shortUnit: '',
  dataType: 'discrete',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'basal_energy_burned',
  displayName: 'Resting Energy',
  aliases: ['basal energy', 'resting calories', 'bmr'],
  category: 'activity',
  canonicalUnit: 'kcal',
  shortUnit: 'kcal',
  dataType: 'continuous',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'time_in_daylight',
  displayName: 'Time in Daylight',
  aliases: ['daylight', 'sunlight'],
  category: 'activity',
  canonicalUnit: 'min',
  shortUnit: 'min',
  dataType: 'continuous',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'physical_effort',
  displayName: 'Physical Effort',
  aliases: ['effort', 'exertion'],
  category: 'activity',
  canonicalUnit: 'kcal/hr·kg',
  shortUnit: 'kcal/hr·kg',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '30d',
  decimalPlaces: 1,
  formatter: (v) => fmt1(v),
  tickFormatter: tick1,
  minObservations: 3,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'body_mass_index',
  displayName: 'BMI',
  aliases: ['bmi', 'body mass index'],
  category: 'body',
  canonicalUnit: 'index',
  shortUnit: '',
  dataType: 'continuous',
  aggregationStrategy: 'latest',
  defaultRange: '1y',
  decimalPlaces: 1,
  formatter: (v) => fmt1(v),
  tickFormatter: tick1,
  minObservations: 1,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'apple_sleeping_wrist_temperature',
  displayName: 'Wrist Temperature',
  aliases: ['sleeping wrist temperature', 'wrist temp'],
  category: 'recovery',
  canonicalUnit: 'degC',
  shortUnit: '°C',
  dataType: 'continuous',
  aggregationStrategy: 'avg',
  defaultRange: '30d',
  decimalPlaces: 2,
  formatter: (v) => `${v.toFixed(2)}°C`,
  tickFormatter: (v) => v.toFixed(1),
  minObservations: 3,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'breathing_disturbances',
  displayName: 'Breathing Disturbances',
  aliases: ['breathing', 'respiratory disturbances'],
  category: 'respiratory',
  canonicalUnit: 'count',
  shortUnit: '',
  dataType: 'discrete',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

def({
  id: 'dietary_sugar',
  displayName: 'Sugar',
  aliases: ['dietary sugar', 'sugar intake'],
  category: 'nutrition',
  canonicalUnit: 'g',
  shortUnit: 'g',
  dataType: 'continuous',
  aggregationStrategy: 'sum',
  defaultRange: '30d',
  decimalPlaces: 0,
  formatter: (v) => fmt0(v),
  tickFormatter: tick0,
  minObservations: 3,
  demoAvailable: false,
  unavailableReason: 'Not recorded in this demo dataset.',
  sourceNames: [],
});

// ── Accessors ─────────────────────────────────────────

export function getMetric(id: string): MetricDefinition | undefined {
  return registry.get(id);
}

export function getAllMetrics(): MetricDefinition[] {
  return Array.from(registry.values());
}

export function getMetricsByCategory(cat: MetricCategory): MetricDefinition[] {
  return Array.from(registry.values()).filter(m => m.category === cat);
}

export function getCategories(): MetricCategory[] {
  return [...new Set(Array.from(registry.values()).map(m => m.category))];
}

export function searchMetrics(query: string): MetricDefinition[] {
  const q = query.toLowerCase();
  return Array.from(registry.values()).filter(
    m =>
      m.id.includes(q) ||
      m.displayName.toLowerCase().includes(q) ||
      m.aliases.some(a => a.toLowerCase().includes(q))
  );
}

export { registry };