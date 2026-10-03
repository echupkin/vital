import { describe, expect, it } from 'vitest';
import { formatDay, formatDaySpan } from './format';

describe('formatDay', () => {
  it('names the reference day "Today"', () => {
    expect(formatDay('2026-10-03', '2026-10-03')).toBe('Today');
    expect(formatDay('2026-09-04', '2026-10-03')).toBe('Sep 4');
    expect(formatDay('2026-10-03', null)).toBe('Oct 3');
  });
});

describe('formatDaySpan', () => {
  it('ends a span on "Today" and shows a single day once', () => {
    expect(formatDaySpan('2026-09-04', '2026-10-03', '2026-10-03')).toBe('Sep 4 – Today');
    expect(formatDaySpan('2026-05-27', '2026-10-02', '2026-10-03')).toBe('May 27 – Oct 2');
    expect(formatDaySpan('2026-10-03', '2026-10-03', '2026-10-03')).toBe('Today');
  });
});
