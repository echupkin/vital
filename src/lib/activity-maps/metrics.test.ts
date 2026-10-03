import { describe, expect, it } from 'vitest';
import { LINE_WIDTH, lineWidth, pathMetric, widthAt, percentile, rampColor, scaleFor, scalePosition } from './metrics';

describe('scales', () => {
  const freq = pathMetric('frequency');
  const hr = pathMetric('heart_rate');

  it('spans frequency from 1 to the busiest path on a log scale', () => {
    const scale = scaleFor(freq, [1, 3, 100])!;
    expect(scale).toEqual({ min: 1, max: 100 });
    expect(scalePosition(freq, scale, 10)).toBeCloseTo(0.5);
  });

  it('clamps heart rate to the 5th-95th percentile so one outlier cannot flatten the rest', () => {
    const values = [...Array.from({ length: 98 }, (_, i) => 100 + i * 0.5), 30, 230];
    const scale = scaleFor(hr, values)!;
    expect(scale.min).toBeGreaterThan(100);
    expect(scale.max).toBeLessThan(150);
    expect(scalePosition(hr, scale, 230)).toBe(1);
    expect(scalePosition(hr, scale, 30)).toBe(0);
  });

  it('has no scale with nothing to show', () => {
    expect(scaleFor(hr, [])).toBeNull();
  });

  it('interpolates percentiles and ramp colours', () => {
    expect(percentile([0, 10], 50)).toBe(5);
    expect(rampColor(['#000000', '#ffffff'], 0)).toBe('#000000');
    expect(rampColor(['#000000', '#ffffff'], 1)).toBe('#ffffff');
    expect(rampColor(['#000000', '#ffffff'], 0.5)).toBe('#808080');
  });
});

describe('lineWidth', () => {
  it('widens frequency lines with use, and keeps heart rate at one width so colour carries it', () => {
    const freq = pathMetric('frequency');
    const hr = pathMetric('heart_rate');
    expect(lineWidth(freq, 1, 100)).toBe(LINE_WIDTH.min);
    expect(lineWidth(freq, 100, 100)).toBe(LINE_WIDTH.max);
    expect(lineWidth(hr, 1, 100)).toBe(LINE_WIDTH.fixed);
    expect(lineWidth(hr, 100, 100)).toBe(LINE_WIDTH.fixed);
  });

  it('reads a shaded run\'s width from its place on the scale', () => {
    expect(widthAt(pathMetric('frequency'), 0)).toBe(LINE_WIDTH.min);
    expect(widthAt(pathMetric('frequency'), 0.5)).toBeCloseTo((LINE_WIDTH.min + LINE_WIDTH.max) / 2);
    expect(widthAt(pathMetric('heart_rate'), 0.9)).toBe(LINE_WIDTH.fixed);
  });
});
