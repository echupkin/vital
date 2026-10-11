import { describe, expect, it } from 'vitest';
import { addDays } from '../analytics/windows';
import { recoveryIndicators, type DayValue, type RecoveryInputs } from './recovery';
import type { RecoveryGate, RecoverySignalId } from './types';

const TODAY = '2026-09-28';

/** One reading a day for the last `days` days, ending today. */
function daily(days: number, value: (daysAgo: number) => number): DayValue[] {
  return Array.from({ length: days }, (_, i) => days - 1 - i).map(ago => ({ key: addDays(TODAY, -ago), value: value(ago) }));
}

function indicators(series: Record<string, DayValue[]>, gates: RecoveryGate[] = [], extra: Partial<RecoveryInputs> = {}) {
  const list = recoveryIndicators({ series: id => series[id] ?? [], trainingDays: [], today: TODAY, system: 'metric', ...extra }, gates);
  return (signal: RecoverySignalId) => list.find(i => i.signal === signal)!;
}

describe('recovery indicators', () => {
  it('keep the readings of the baseline and recent windows, oldest first', () => {
    // 40 days: the 5 oldest fall outside the 35-day window.
    const hr = indicators({ resting_heart_rate: daily(40, ago => (ago < 7 ? 60 : 52)) })('resting_hr');
    expect(hr.points).toHaveLength(35);
    expect(hr.points[0].key).toBe(addDays(TODAY, -34));
    expect(hr.points[34]).toEqual({ key: TODAY, value: 60 });
    expect(hr.recentFrom).toBe(addDays(TODAY, -6));
    expect(hr.current).toBe(60);
    expect(hr.baseline).toBe(52);
  });

  it('show sleep in hours and weigh-ins in the reader’s unit', () => {
    const get = indicators(
      { sleep_analysis: daily(10, () => 450), weight_body_mass: daily(28, ago => 80 - ago * 0.01) },
      [],
      { system: 'imperial' }
    );
    expect(get('sleep_hours').points[0].value).toBe(7.5);
    const weight = get('body_weight_rate');
    expect(weight.points).toHaveLength(28);
    expect(weight.points[27].value).toBeCloseTo(176.37, 1);
    // The trend is the whole window: there is no separate baseline.
    expect(weight.recentFrom).toBe(weight.points[0].key);
    // 0.07 kg a week, as the Body pages read it, in lb.
    expect(weight.current).toBeCloseTo(0.15, 2);
    expect(weight.text).toBe('+0.15 lb/week over the last 28 days (28 weigh-ins).');
  });

  it('count training sessions per week over five weeks', () => {
    const trainingDays = [TODAY, addDays(TODAY, -2), addDays(TODAY, -8), addDays(TODAY, -30)];
    const load = indicators({}, [], { trainingDays })('training_load');
    expect(load.points.map(p => p.value)).toEqual([1, 0, 0, 1, 2]);
    expect(load.points[4].key).toBe(load.recentFrom);
  });

  it('say the plan’s rule in words, in display units', () => {
    const gates: RecoveryGate[] = [
      { signal: 'resting_hr', rule: 'rising', threshold: 5, severity: 'watch' },
      { signal: 'hrv', rule: 'falling', threshold: 10, severity: 'warn' },
      { signal: 'sleep_hours', rule: 'below', threshold: 6.5, severity: 'warn' },
      { signal: 'body_weight_rate', rule: 'below', threshold: -1, severity: 'watch' },
      { signal: 'training_load', rule: 'above', threshold: 50, severity: 'watch' },
    ];
    const get = indicators({}, gates, { system: 'imperial' });
    expect(get('resting_hr').rule).toBe('Watch if the 7-day average rises 5 bpm or more above the 28 days before.');
    expect(get('hrv').rule).toBe('Hold progression if the 7-day average drops 10 ms or more below the 28 days before.');
    expect(get('sleep_hours').rule).toBe('Hold progression if average sleep over the last 7 nights is below 6.5 h.');
    expect(get('body_weight_rate').rule).toBe('Flag if the 28-day weight trend is below -2.2 lb/week.');
    expect(get('training_load').rule).toBe('Watch if sessions in the last 7 days are more than 50% above the weekly average of the 4 weeks before.');
    expect(indicators({})('resting_hr').rule).toBeNull();
  });

  it('give advice only while a gate is tripped', () => {
    const gate: RecoveryGate = { signal: 'sleep_hours', rule: 'below', threshold: 7, severity: 'watch' };
    const short = indicators({ sleep_analysis: daily(7, () => 360) }, [gate])('sleep_hours');
    expect(short.status).toBe('watch');
    expect(short.advice).toMatch(/sleep/i);
    const enough = indicators({ sleep_analysis: daily(7, () => 480) }, [gate])('sleep_hours');
    expect(enough.status).toBe('ok');
    expect(enough.advice).toBeNull();
    expect(indicators({ sleep_analysis: daily(7, () => 360) })('sleep_hours').advice).toBeNull();
  });
});
