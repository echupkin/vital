// ── Core metric types ──────────────────────────────────

export type MetricId = string;

export type MetricCategory =
  | 'cardiovascular'
  | 'activity'
  | 'sleep'
  | 'body'
  | 'nutrition'
  | 'respiratory'
  | 'recovery'
  | 'vitals';

export type DataType = 'continuous' | 'discrete' | 'categorical';

export type AggregationStrategy = 'avg' | 'sum' | 'min' | 'max' | 'latest' | 'count';

export interface MetricDefinition {
  id: MetricId;
  displayName: string;
  aliases: string[];
  category: MetricCategory;
  canonicalUnit: string;
  shortUnit: string;
  dataType: DataType;
  aggregationStrategy: AggregationStrategy;
  defaultRange: '7d' | '30d' | '90d' | '1y' | 'all';
  decimalPlaces: number;
  /** Format a raw (canonical-unit) numeric value to a display string */
  formatter: (value: number) => string;
  /** Format an axis tick — never shows more precision than the metric needs */
  tickFormatter?: (value: number) => string;
  /** Minimum observations needed for meaningful display */
  minObservations: number;
  /** Whether demo data is available for this metric */
  demoAvailable: boolean;
  /** Shown when the metric is registered but absent from the dataset */
  unavailableReason?: string;
  /** Source names from fixture data */
  sourceNames: string[];
}

// ── Observation ─────────────────────────────────────────

export interface MetricObservation {
  date: string;           // ISO date string
  qty: number;
  units: string;
  source: string;
  hourly?: { hour: number; steps: number }[];
  /**
   * True when the day's sample is known to be incomplete — the dataset's
   * reference day for an accumulating metric, or a partial intraday export.
   * A partial day is excluded from comparisons instead of being presented as a
   * complete one.
   */
  partial?: boolean;
}

export interface SleepStages {
  /** Minutes in deep sleep. */
  deep: number;
  /** Minutes in REM sleep. */
  rem: number;
  /** Minutes in core (light) sleep. */
  core: number;
  /**
   * Minutes awake inside the in-bed window, as recorded by the source device.
   * Distinct from the time taken to fall asleep, which is not recorded.
   */
  awake: number;
}

export interface SleepObservation {
  date: string;
  bedtime: string;
  wakeTime: string;
  durationMinutes: number;
  inBedMinutes: number;
  asleepMinutes: number;
  stages: SleepStages;
  source: string;
}

export interface BloodPressureObservation {
  date: string;
  systolic: number;
  diastolic: number;
  units: string;
  source: string;
}

export interface WorkoutRecord {
  id: string;
  workout_type: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  calories_burned: number;
  source: string;
  distance_km?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
}

// ── Coverage ────────────────────────────────────────────

export interface MetricCoverage {
  firstObservation: string;
  lastObservation: string;
  observedDays: number;
  expectedDays: number;
  samplingFrequency: string;
  sourceNames: string[];
}

// ── Fixture file shape ─────────────────────────────────

export interface HealthFixtures {
  referenceDate: string;
  windowStart: string;
  windowEnd: string;
  days: number;
  timezone: string;
  metrics: Record<string, MetricObservation[] | SleepObservation[] | BloodPressureObservation[]>;
  workouts: WorkoutRecord[];
  coverage: Record<string, MetricCoverage>;
}