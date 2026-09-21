// # Vital — Seeded Health Fixture Generator
//
// Generates src/data/health-fixtures.json using a deterministic PRNG.
// The dataset covers 180 days ending on 2026-09-17 (America/Chicago).
// Run via: npm run seed

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Mulberry32 PRNG (seeded, deterministic) ──────────────
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260917);

// ── Helpers ──────────────────────────────────────────────
function rand(min, max) {
  return rng() * (max - min) + min;
}
function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}
function pick(arr) {
  return arr[Math.floor(rng() * arr.length)];
}
function gaussian(mean, std) {
  const u1 = rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1 + 0.00001)) * Math.cos(2 * Math.PI * u2);
  return mean + z * std;
}

// ── Constants ────────────────────────────────────────────
const REFERENCE_DATE = new Date('2026-09-17T23:59:59.999-05:00');
const DAYS = 180;

// ── Source provenance ────────────────────────────────────
//
// A `source` names the device or app that RECORDED the value, so each metric
// draws only from sources that can physically produce it. A bathroom scale
// cannot record a cycling session, a sleep app cannot record steps or resting
// heart rate, and the watch-only sensors (blood oxygen, respiratory rate) have
// no phone equivalent.
//
// Every pool is still drawn with exactly one `pick()` call per record, so the
// number of PRNG draws — and therefore every numeric fixture value — is
// unchanged: only the plausible source strings differ.
const APPLE_WATCH = "Apple Watch";
const IPHONE = 'Apple Health (iPhone)';
const SCALE = 'Withings Scale';
const AUTOSLEEP = 'AutoSleep';
const MANUAL = 'Manual Log';
const MFP = 'MyFitnessPal';
const STRAVA = 'Strava';

// Heart-rate metrics, VO2 max and steps are recorded by the watch or the phone.
const sourcesHeart = [APPLE_WATCH, IPHONE];
const sourcesSteps = [APPLE_WATCH, IPHONE];
const sourcesVO2 = [APPLE_WATCH, IPHONE];
// Sensors that exist only on the watch: no phone or scale equivalent.
const sourcesWatchOnly = [APPLE_WATCH];
// Sleep episodes come from the watch or a sleep-tracking app.
const sourcesSleep = [APPLE_WATCH, AUTOSLEEP];
// Weight comes from the scale that measures it.
const sourcesWeight = [SCALE];
const sourcesCaffeine = [MFP, MANUAL];

function formatDate(d) {
  return d.toISOString().split('T')[0];
}
function toISO(t) {
  return t instanceof Date ? t.toISOString() : t;
}

// ── Generate dataset ─────────────────────────────────────
const metrics = {};
const workouts = [];
const coverage = {};

// Windows
const WINDOW_START = new Date(REFERENCE_DATE);
WINDOW_START.setDate(WINDOW_START.getDate() - DAYS);
WINDOW_START.setHours(0, 0, 0, 0);

function produceDateList() {
  const dates = [];
  for (let i = 0; i <= DAYS; i++) {
    const d = new Date(WINDOW_START);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

const allDates = produceDateList();
const today = allDates[allDates.length - 1];

// How much of the final (in-progress) day has elapsed is a property of the
// dataset, not of the wall clock: reading `new Date()` here would make every
// generated value depend on when `npm run seed` happens to run, and the PRNG
// stream would shift from this metric onwards. The dataset's reference instant
// is the last minute of its final day, so the partial day carries the modelled
// maximum number of elapsed hours.
const PARTIAL_DAY_HOURS = 14;

// ── Resting Heart Rate (daily) ──────────────────────────
(function () {
  const key = 'resting_heart_rate';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    // Skip some days ~5%
    if (rng() < 0.05) continue;
    const d = allDates[i];
    const daysFromStart = (d - WINDOW_START) / 86400000;
    // Trend: stable ~55-60, with a 10-day uptick around day 80-90
    let base = 57 + gaussian(0, 2);
    if (daysFromStart > 75 && daysFromStart < 90) {
      base += 6 + gaussian(0, 1.5);
    } else if (daysFromStart > 85) {
      base += gaussian(0, 1.5);
    }
    // Partial current day
    if (formatDate(d) === formatDate(today) && rng() < 0.5) continue;
    records.push({
      date: d.toISOString(),
      qty: Math.round(base * 10) / 10,
      units: 'bpm',
      source: pick(sourcesHeart),
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: 'daily',
    sourceNames: [...new Set(records.map(r => r.source))],
  };
})();

// ── HRV (daily, ms) ─────────────────────────────────────
(function () {
  const key = 'heart_rate_variability';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() < 0.08) continue;
    const d = allDates[i];
    const daysFromStart = (d - WINDOW_START) / 86400000;
    let base = 55 + gaussian(0, 8);
    if (daysFromStart > 75 && daysFromStart < 90) {
      base -= 15 + gaussian(0, 5);
    } else if (daysFromStart > 85) {
      base += gaussian(0, 4);
    }
    if (formatDate(d) === formatDate(today) && rng() < 0.5) continue;
    records.push({
      date: d.toISOString(),
      qty: Math.max(15, Math.round(base)),
      units: 'ms',
      source: pick(sourcesHeart),
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: 'daily',
    sourceNames: [...new Set(records.map(r => r.source))],
  };
})();

// ── Sleep (per night, assigned to waking date) ──────────
(function () {
  const key = 'sleep_analysis';
  const records = [];
  for (let i = 1; i < allDates.length; i++) {
    if (rng() < 0.05) continue;
    const wakeDate = allDates[i];
    const bedTime = new Date(wakeDate);
    bedTime.setDate(bedTime.getDate() - 1);
    bedTime.setHours(22 + randInt(0, 2), randInt(0, 59), 0, 0);
    const daysFromStart = (wakeDate - WINDOW_START) / 86400000;
    let durationHours = 7 + gaussian(0, 0.6);
    if (daysFromStart > 75 && daysFromStart < 90) {
      durationHours -= 0.8 + gaussian(0, 0.3);
    }
    durationHours = Math.max(4, Math.min(10, durationHours));
    const durationMinutes = Math.round(durationHours * 60);
    const asleepMinutes = Math.round(durationMinutes * (0.8 + gaussian(0, 0.05)));
    const deepPct = 0.18 + gaussian(0, 0.04);
    const remPct = 0.22 + gaussian(0, 0.04);
    const corePct = 1 - deepPct - remPct;
    const wakeTime = new Date(bedTime);
    wakeTime.setMinutes(wakeTime.getMinutes() + durationMinutes);
    records.push({
      date: formatDate(wakeDate),
      bedtime: bedTime.toISOString(),
      wakeTime: wakeTime.toISOString(),
      durationMinutes,
      inBedMinutes: durationMinutes + randInt(5, 25),
      asleepMinutes,
      stages: {
        deep: Math.round(durationMinutes * Math.max(0.1, deepPct)),
        rem: Math.round(durationMinutes * Math.max(0.15, remPct)),
        core: Math.round(durationMinutes * Math.max(0.3, corePct)),
      },
      source: pick(sourcesSleep),
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: records[0].date,
    lastObservation: records[records.length - 1].date,
    observedDays: records.length,
    expectedDays: allDates.length - 1,
    samplingFrequency: 'nightly',
    sourceNames: [...new Set(records.map(r => r.source))],
  };
})();

// ── Steps (hourly + daily total) ─────────────────────────
(function () {
  const key = 'step_count';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    const d = allDates[i];
    const isToday = formatDate(d) === formatDate(today);
    // Hourly steps
    const hourlyEntries = [];
    let total = 0;
    const hours = isToday ? PARTIAL_DAY_HOURS : 24;
    for (let h = 0; h < hours; h++) {
      const hrBase = (h >= 9 && h <= 18) ? 600 : (h >= 7 && h <= 22 ? 300 : 30);
      const stepsHr = Math.max(0, Math.round(gaussian(hrBase, hrBase * 0.4)));
      total += stepsHr;
      hourlyEntries.push({ hour: h, steps: stepsHr });
    }
    const dayAvg = 7500 + gaussian(0, 2000);
    if (!isToday) {
      records.push({
        date: d.toISOString(),
        qty: Math.max(0, Math.round(dayAvg)),
        units: 'count',
        source: pick(sourcesSteps),
        hourly: hourlyEntries,
      });
    } else {
      // Partial current day
      records.push({
        date: d.toISOString(),
        qty: total,
        units: 'count',
        source: pick(sourcesSteps),
        hourly: hourlyEntries,
      });
    }
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: 'hourly',
    sourceNames: [...new Set(records.map(r => r.source))],
  };
})();

// ── Exercise minutes (daily) ────────────────────────────
(function () {
  const key = 'apple_exercise_time';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() < 0.12) continue;
    const d = allDates[i];
    const mins = Math.max(0, Math.round(gaussian(35, 15)));
    records.push({
      date: d.toISOString(),
      qty: mins,
      units: 'min',
      source: pick(sourcesWatchOnly),
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: 'daily',
    sourceNames: [...new Set(records.map(r => r.source))],
  };
})();

// ── Active energy (daily kcal) ──────────────────────────
(function () {
  const key = 'active_energy';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() < 0.05) continue;
    const d = allDates[i];
    const cal = Math.max(0, Math.round(gaussian(420, 120)));
    records.push({
      date: d.toISOString(),
      qty: cal,
      units: 'kcal',
      source: pick(sourcesWatchOnly),
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: 'daily',
    sourceNames: [...new Set(records.map(r => r.source))],
  };
})();

// ── Respiratory rate (daily, breaths/min) ───────────────
(function () {
  const key = 'respiratory_rate';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() < 0.1) continue;
    const d = allDates[i];
    const rate = Math.round(gaussian(14.5, 1.2) * 10) / 10;
    records.push({
      date: d.toISOString(),
      qty: Math.max(8, rate),
      units: 'breaths/min',
      source: pick(sourcesWatchOnly),
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: 'daily',
    sourceNames: [...new Set(records.map(r => r.source))],
  };
})();

// ── Weight (sparse, 2-3/week) ───────────────────────────
(function () {
  const key = 'weight_body_mass';
  const records = [];
  let currentWeight = 76.5;
  for (let i = 0; i < allDates.length; i++) {
    // ~2-3 per week (~35% chance each day)
    if (rng() > 0.35) continue;
    const d = allDates[i];
    currentWeight += gaussian(0, 0.15);
    records.push({
      date: d.toISOString(),
      qty: Math.round(currentWeight * 10) / 10,
      units: 'kg',
      source: pick(sourcesWeight),
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: '2-3/week',
    sourceNames: [...new Set(records.map(r => r.source))],
  };
})();

// ── VO₂ max (sparse, ~1/month) ─────────────────────────
(function () {
  const key = 'vo2max';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() > 0.035) continue;
    const d = allDates[i];
    const vo2 = Math.round(gaussian(42, 3) * 10) / 10;
    records.push({
      date: d.toISOString(),
      qty: Math.max(25, vo2),
      units: 'ml/kg/min',
      source: pick(sourcesVO2),
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: '~1/month',
    sourceNames: [...new Set(records.map(r => r.source))],
  };
})();

// ── Dietary caffeine (daily, mg) ───────────────────────
(function () {
  const key = 'dietary_caffeine';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() < 0.15) continue;
    const d = allDates[i];
    const caff = Math.max(0, Math.round(gaussian(180, 80)));
    records.push({
      date: d.toISOString(),
      qty: caff,
      units: 'mg',
      source: pick(sourcesCaffeine),
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: 'daily',
    sourceNames: [...new Set(records.map(r => r.source))],
  };
})();

// ── Dietary energy (daily kcal) ─────────────────────────
(function () {
  const key = 'dietary_energy';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() < 0.2) continue;
    const d = allDates[i];
    const cal = Math.max(800, Math.round(gaussian(2100, 350)));
    records.push({
      date: d.toISOString(),
      qty: cal,
      units: 'kcal',
      source: 'MyFitnessPal',
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: 'daily',
    sourceNames: ['MyFitnessPal'],
  };
})();

// ── Dietary protein (daily, g) ──────────────────────────
(function () {
  const key = 'dietary_protein';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() < 0.2) continue;
    const d = allDates[i];
    const prot = Math.max(20, Math.round(gaussian(95, 25)));
    records.push({
      date: d.toISOString(),
      qty: prot,
      units: 'g',
      source: 'MyFitnessPal',
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: 'daily',
    sourceNames: ['MyFitnessPal'],
  };
})();

// ── Dietary carbs (daily, g) ────────────────────────────
(function () {
  const key = 'dietary_carbs';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() < 0.2) continue;
    const d = allDates[i];
    const carbs = Math.max(50, Math.round(gaussian(220, 60)));
    records.push({
      date: d.toISOString(),
      qty: carbs,
      units: 'g',
      source: 'MyFitnessPal',
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: 'daily',
    sourceNames: ['MyFitnessPal'],
  };
})();

// ── Dietary fat (daily, g) ──────────────────────────────
(function () {
  const key = 'dietary_fat_total';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() < 0.2) continue;
    const d = allDates[i];
    const fat = Math.max(20, Math.round(gaussian(75, 22)));
    records.push({
      date: d.toISOString(),
      qty: fat,
      units: 'g',
      source: 'MyFitnessPal',
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: 'daily',
    sourceNames: ['MyFitnessPal'],
  };
})();

// ── Dietary water (daily, ml) ───────────────────────────
(function () {
  const key = 'dietary_water';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() < 0.15) continue;
    const d = allDates[i];
    const water = Math.round(gaussian(1800, 400));
    records.push({
      date: d.toISOString(),
      qty: Math.max(200, water),
      units: 'mL',
      source: 'Manual Log',
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: 'daily',
    sourceNames: ['Manual Log'],
  };
})();

// ── Blood oxygen saturation (sparse) ────────────────────
(function () {
  const key = 'blood_oxygen_saturation';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() > 0.08) continue;
    const d = allDates[i];
    const spo2 = Math.round(gaussian(97.5, 0.8) * 10) / 10;
    records.push({
      date: d.toISOString(),
      qty: Math.max(92, Math.min(100, spo2)),
      units: '%',
      source: pick(sourcesWatchOnly),
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: '~1/week',
    sourceNames: [...new Set(records.map(r => r.source))],
  };
})();

// ── Blood pressure (very sparse) ────────────────────────
(function () {
  const key = 'blood_pressure';
  const records = [];
  for (let i = 0; i < allDates.length; i++) {
    if (rng() > 0.015) continue;
    const d = allDates[i];
    const systolic = Math.round(gaussian(118, 8));
    const diastolic = Math.round(gaussian(74, 6));
    records.push({
      date: d.toISOString(),
      systolic: Math.max(90, Math.min(160, systolic)),
      diastolic: Math.max(55, Math.min(100, diastolic)),
      units: 'mmHg',
      // A watch has no blood-pressure cuff: these are cuff readings logged by hand.
      source: MANUAL,
    });
  }
  metrics[key] = records;
  coverage[key] = {
    firstObservation: toISO(records[0].date),
    lastObservation: toISO(records[records.length - 1].date),
    observedDays: records.length,
    expectedDays: allDates.length,
    samplingFrequency: '~1/month',
    sourceNames: [MANUAL],
  };
})();

// ── Workouts ────────────────────────────────────────────
(function () {
  const workoutTypes = [
    { type: 'Running', hasDistance: true, avgDuration: 35, avgCal: 320 },
    { type: 'Cycling', hasDistance: true, avgDuration: 50, avgCal: 380 },
    { type: 'Strength', hasDistance: false, avgDuration: 45, avgCal: 210 },
    { type: 'Walking', hasDistance: true, avgDuration: 30, avgCal: 140 },
    { type: 'Yoga', hasDistance: false, avgDuration: 45, avgCal: 150 },
    { type: 'Swimming', hasDistance: true, avgDuration: 35, avgCal: 280 },
  ];
  // A session's source must be able to record that activity: the watch records
  // all six types, the phone records the ones its Fitness app offers without a
  // watch, and the connected app covers running and cycling. Swimming is
  // watch-only — a phone is not worn in the pool.
  const workoutSources = {
    Running: [APPLE_WATCH, IPHONE, STRAVA],
    Cycling: [APPLE_WATCH, IPHONE, STRAVA],
    Strength: [APPLE_WATCH, IPHONE],
    Walking: [APPLE_WATCH, IPHONE],
    Yoga: [APPLE_WATCH, IPHONE],
    Swimming: [APPLE_WATCH],
  };
  const numWorkouts = randInt(45, 55);
  for (let w = 0; w < numWorkouts; w++) {
    const template = pick(workoutTypes);
    const dayOffset = randInt(0, DAYS - 1);
    const d = new Date(WINDOW_START);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(6 + randInt(0, 14), randInt(0, 59), 0, 0);
    const duration = Math.round(gaussian(template.avgDuration, 8));
    const startTime = d.toISOString();
    const endTime = new Date(d.getTime() + duration * 60000).toISOString();
    const calories = Math.round(gaussian(template.avgCal, 40));
    const hr = { avg: Math.round(gaussian(135, 15)), max: Math.round(gaussian(165, 12)) };
    const workout = {
      id: `workout-${w + 1}`,
      workout_type: template.type,
      start_time: startTime,
      end_time: endTime,
      duration_minutes: Math.max(10, duration),
      calories_burned: Math.max(50, calories),
      source: pick(workoutSources[template.type]),
    };
    if (template.hasDistance) {
      const pace = template.type === 'Walking' ? 12 + gaussian(0, 2) : 5.5 + gaussian(0, 0.8);
      workout.distance_km = Math.round((duration / 60) * (60 / pace) * 10) / 10;
    }
    if (rng() < 0.7) {
      workout.avg_heart_rate = hr.avg;
      workout.max_heart_rate = hr.max;
    }
    workouts.push(workout);
  }
  workouts.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
})();

// ── Build final output ─────────────────────────────────
const output = {
  referenceDate: REFERENCE_DATE.toISOString(),
  windowStart: WINDOW_START.toISOString(),
  windowEnd: REFERENCE_DATE.toISOString(),
  days: DAYS,
  timezone: 'America/Chicago',
  metrics,
  workouts,
  coverage,
};

// ── Write ──────────────────────────────────────────────
const dataDir = join(__dirname, '..', 'src', 'data');
mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, 'health-fixtures.json'), JSON.stringify(output, null, 2));
console.log(`Seeded health-fixtures.json — ${DAYS} days ending ${formatDate(REFERENCE_DATE)}`);
console.log(`Metrics: ${Object.keys(metrics).length}`);
console.log(`Workouts: ${workouts.length}`);
Object.entries(coverage).forEach(([k, c]) => {
  console.log(`  ${k}: ${c.observedDays}/${c.expectedDays} days (${c.samplingFrequency})`);
});
