// ── Canonical unit conversion (upstream → canonical) ────
//
// Health Auto Export reports in whatever unit the source device used (lb, mi,
// degF, hours). Vital stores one canonical unit per registry metric, so every
// upstream record is converted exactly once, here, on the way in. Display-time
// conversion (kg → lb for the imperial preference) is a separate concern and
// lives in `metrics/format.ts`; this module never touches the user preference.
//
// Every rule is reversible, and `units.test.ts` asserts the round trip so a
// wrong factor cannot silently ship.

export interface UnitConversion {
  from: string;
  to: string;
  /** `value * factor`, then `+ offset` when present. */
  factor: number;
  offset?: number;
}

/** Multiplicative and affine conversions used by the live adapter. */
export const UNIT_CONVERSIONS: UnitConversion[] = [
  { from: 'lb', to: 'kg', factor: 0.45359237 },
  { from: 'lbs', to: 'kg', factor: 0.45359237 },
  { from: 'mi', to: 'km', factor: 1.609344 },
  { from: 'in', to: 'cm', factor: 2.54 },
  { from: 'ft', to: 'cm', factor: 30.48 },
  { from: 'hr', to: 'min', factor: 60 },
  { from: 'hours', to: 'min', factor: 60 },
  // Affine: (F − 32) × 5/9
  { from: 'degF', to: 'degC', factor: 5 / 9, offset: -32 * (5 / 9) },
  // Unit labels that differ but denote the same quantity.
  { from: 'count/min', to: 'bpm', factor: 1 },
  { from: 'count/min', to: 'breaths/min', factor: 1 },
  // Apple/HAE report the stand, step and BMI counts in "count"; the registry
  // names those quantities differently.
  { from: 'count', to: 'count', factor: 1 },
  { from: 'count', to: 'index', factor: 1 },
];

function normaliseUnit(unit: string): string {
  return String(unit ?? '').trim();
}

function findRule(from: string, to: string): UnitConversion | undefined {
  const f = normaliseUnit(from);
  const t = normaliseUnit(to);
  return UNIT_CONVERSIONS.find(r => r.from === f && r.to === t);
}

export function canConvertUnit(from: string, to: string): boolean {
  const f = normaliseUnit(from);
  const t = normaliseUnit(to);
  if (f === t) return true;
  return Boolean(findRule(f, t));
}

/**
 * Convert a value from `from` to `to`.
 *
 * Throws on an unknown pair rather than returning the unconverted number: a
 * silent identity would show pounds as kilograms, which is exactly the kind of
 * dishonest number this project must not produce.
 */
export function convertUnit(value: number, from: string, to: string): number {
  const f = normaliseUnit(from);
  const t = normaliseUnit(to);
  if (!isFinite(value)) return NaN;
  if (f === t) return value;
  const rule = findRule(f, t);
  if (!rule) {
    throw new Error(`No unit conversion is defined from "${from}" to "${to}".`);
  }
  return value * rule.factor + (rule.offset ?? 0);
}

/** Convert back to the upstream unit. Used only by tests and round-trip checks. */
export function convertUnitBack(value: number, from: string, to: string): number {
  const f = normaliseUnit(from);
  const t = normaliseUnit(to);
  if (f === t) return value;
  const rule = findRule(f, t);
  if (!rule) {
    throw new Error(`No unit conversion is defined from "${from}" to "${to}".`);
  }
  return (value - (rule.offset ?? 0)) / rule.factor;
}

/** True when the registry's canonical unit is the one the API already reports. */
export function isCanonical(from: string, to: string): boolean {
  return normaliseUnit(from) === normaliseUnit(to);
}
