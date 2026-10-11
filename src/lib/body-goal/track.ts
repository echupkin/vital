// ── Body goal: is the trend on the right track? ─────────
//
// The goal card does not measure how far away the goal is — at the start of a
// cut that only says "a long way". It says whether the weight trend is
// moving the right way at a sensible pace: toward the target inside the
// recommended range, faster than it (which costs muscle or adds fat), slower,
// not yet moving, or away. At the goal it says whether weight is holding in the
// maintenance range. Every status describes the data; none is a verdict on the
// reader, and nothing is ever "behind".

import type { GoalPhase } from './phase';
import type { TrendFit } from './pace';
import { WEIGHT_TREND_WINDOW } from '../analytics/weight-trend';

export type TrackStatus = 'on-track' | 'fast' | 'slow' | 'still' | 'away' | 'holding' | 'drifting' | 'unknown';

export interface GoalTrack {
  status: TrackStatus;
  /** good: keep going; caution: worth adjusting; neutral: a fact, no judgement. */
  tone: 'good' | 'caution' | 'neutral';
  label: string;
  detail: string;
}

export function goalTrack(phase: GoalPhase | null, fit: TrendFit, ratePct: number | null): GoalTrack {
  if (phase === null || fit === 'unknown' || ratePct === null) {
    return { status: 'unknown', tone: 'neutral', label: 'Waiting for a trend', detail: 'A few more weigh-ins give a weight trend to read.' };
  }
  if (phase === 'maintain') {
    return fit === 'drifting'
      ? {
          status: 'drifting',
          tone: 'caution',
          label: ratePct < 0 ? 'Drifting down' : 'Drifting up',
          detail: `At the goal, but over the ${WEIGHT_TREND_WINDOW} weight moved ${ratePct < 0 ? 'down' : 'up'} more than maintenance usually does. Nudging intake ${ratePct < 0 ? 'up' : 'down'} a little holds it.`,
        }
      : { status: 'holding', tone: 'good', label: 'Holding in range', detail: `At the goal and holding steady over the ${WEIGHT_TREND_WINDOW}.` };
  }
  const cutting = phase === 'cut';
  switch (fit) {
    case 'within':
      return { status: 'on-track', tone: 'good', label: 'On track', detail: `${cutting ? 'Losing' : 'Gaining'} at a pace inside the recommended range.` };
    case 'faster':
      return {
        status: 'fast',
        tone: 'caution',
        label: 'Faster than recommended',
        detail: cutting
          ? 'Moving toward the goal quickly; at this pace more of the loss tends to be muscle. Eating a little more slows it.'
          : 'Moving toward the goal quickly; at this pace more of the gain tends to be fat. Eating a little less slows it.',
      };
    case 'slower':
      return { status: 'slow', tone: 'neutral', label: 'Slower than recommended', detail: 'Moving toward the goal, more gently than the recommended range.' };
    case 'opposite':
      return { status: 'away', tone: 'neutral', label: 'Moving away from the target', detail: `Over the ${WEIGHT_TREND_WINDOW} weight ${cutting ? 'went up' : 'went down'}, away from the goal.` };
    default:
      return { status: 'still', tone: 'neutral', label: 'Not moving yet', detail: `Weight has held steady over the ${WEIGHT_TREND_WINDOW}.` };
  }
}
