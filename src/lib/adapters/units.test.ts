import { describe, expect, it } from 'vitest';
import {
  UNIT_CONVERSIONS,
  canConvertUnit,
  convertUnit,
  convertUnitBack,
} from '@/lib/adapters/units';

const ROUND_TRIP: [number, string, string][] = [
  [220.46226218, 'lb', 'kg'],
  [193.6, 'lb', 'kg'],
  [1, 'mi', 'km'],
  [16176 * 0.0077, 'mi', 'km'],
  [98.6, 'degF', 'degC'],
  [4.5, 'hr', 'min'],
  [70, 'count/min', 'bpm'],
  [25.7, 'count', 'index'],
];

describe('unit conversion (SPEC §9)', () => {
  it('converts the upstream units the API actually reports', () => {
    expect(convertUnit(220.46226218, 'lb', 'kg')).toBeCloseTo(100, 6);
    expect(convertUnit(1, 'mi', 'km')).toBeCloseTo(1.609344, 9);
    expect(convertUnit(98.6, 'degF', 'degC')).toBeCloseTo(37, 9);
    expect(convertUnit(4.5, 'hr', 'min')).toBeCloseTo(270, 9);
    expect(convertUnit(72, 'count/min', 'bpm')).toBe(72);
    expect(convertUnit(97, '%', '%')).toBe(97);
  });

  it('round-trips every defined conversion', () => {
    for (const [value, from, to] of ROUND_TRIP) {
      const converted = convertUnit(value, from, to);
      expect(convertUnitBack(converted, from, to), `${from} → ${to} → ${from}`).toBeCloseTo(value, 6);
    }
  });

  it('round-trips every table entry in both directions', () => {
    for (const rule of UNIT_CONVERSIONS) {
      const value = 12.345;
      const forward = convertUnit(value, rule.from, rule.to);
      expect(convertUnitBack(forward, rule.from, rule.to)).toBeCloseTo(value, 6);
    }
  });

  it('treats an identical unit as an identity conversion', () => {
    expect(convertUnit(1234.5, 'count', 'count')).toBe(1234.5);
    expect(canConvertUnit('kg', 'kg')).toBe(true);
  });

  it('refuses an undefined conversion instead of silently keeping the number', () => {
    expect(canConvertUnit('stone', 'kg')).toBe(false);
    expect(() => convertUnit(1, 'stone', 'kg')).toThrow(/No unit conversion/);
  });

  it('propagates a non-finite value rather than inventing one', () => {
    expect(Number.isNaN(convertUnit(NaN, 'lb', 'kg'))).toBe(true);
  });
});
