// ── The educational notice must be the app's notice, verbatim ───────────────
//
// The Lab pages render the notice from `notice.ts` (a browser-safe literal)
// because the analyst service that owns the canonical string is server-side and
// must not be pulled into a client bundle to read a constant. This test is the
// guard: if either copy changes, the suite fails instead of the two drifting
// apart and the app stating two different disclaimers.

import { describe, it, expect } from 'vitest';
import { EDUCATIONAL_NOTICE } from '@/lib/analyst/service';
import { LAB_EDUCATIONAL_NOTICE, LAB_INTERVAL_NOTICE, LAB_SOURCE_NOTICE } from './notice';

describe('the lab educational notice', () => {
  it('is the same sentence the rest of the app uses', () => {
    expect(LAB_EDUCATIONAL_NOTICE).toBe(EDUCATIONAL_NOTICE);
  });

  it('says it is not medical advice, a diagnosis or a substitute for a clinician', () => {
    expect(LAB_EDUCATIONAL_NOTICE).toContain('Not medical advice');
    expect(LAB_EDUCATIONAL_NOTICE).toContain('not a diagnosis');
    expect(LAB_EDUCATIONAL_NOTICE).toContain('not a substitute for a clinician');
  });

  it('states that a reference interval is a population range, not a personal target', () => {
    expect(LAB_INTERVAL_NOTICE).toContain('population range');
    expect(LAB_INTERVAL_NOTICE).toContain('not a diagnosis');
  });

  it('states that the values were imported from a PDF rather than measured here', () => {
    expect(LAB_SOURCE_NOTICE).toContain('imported from a PDF');
    expect(LAB_SOURCE_NOTICE).toContain('does not measure these values');
  });
});