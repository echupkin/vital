// ── Formatting for the maps' figures (pure) ─────────────

import type { UnitSystem } from '@/lib/prefs/types';
import { formatDayKeyShort } from '@/lib/analytics/windows';

const M_PER_MI = 1609.344;
const M_PER_FT = 0.3048;

/** A distance in the reader's units: metres/feet below a kilometre/mile-ish, else one decimal. */
export function formatDistance(meters: number, units: UnitSystem): string {
  if (!Number.isFinite(meters) || meters <= 0) return units === 'imperial' ? '0 mi' : '0 km';
  if (units === 'imperial') {
    const mi = meters / M_PER_MI;
    if (mi < 0.1) return `${Math.round(meters / M_PER_FT / 10) * 10} ft`;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi).toLocaleString()} mi`;
  }
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString()} km`;
}

/** "2.4 × 1.8 km" for a box, in the reader's units. */
export function formatBoxSize(widthM: number, heightM: number, units: UnitSystem): string {
  const unit = units === 'imperial' ? M_PER_MI : 1000;
  const label = units === 'imperial' ? 'mi' : 'km';
  const f = (m: number) => {
    const v = m / unit;
    return v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString();
  };
  return `${f(widthM)} × ${f(heightM)} ${label}`;
}

/** Whole hours and minutes, "3h 05m" or "42m". */
export function formatSeconds(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** A day, as "Today" when it is the reference day (the app's today), else "Sep 4". */
export function formatDay(key: string, todayKey: string | null): string {
  return key === todayKey ? 'Today' : formatDayKeyShort(key);
}

/** A span of days, "Sep 4 – Today"; a single day is shown once. */
export function formatDaySpan(fromKey: string, toKey: string, todayKey: string | null): string {
  return fromKey === toKey ? formatDay(fromKey, todayKey) : `${formatDay(fromKey, todayKey)} – ${formatDay(toKey, todayKey)}`;
}
