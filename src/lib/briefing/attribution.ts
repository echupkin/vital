// ── Attribution wording (SPEC §5B) ───────────────────────
//
// Kept apart from the briefing's server module on purpose: the hero renders
// these two strings, and a component must not import the module that reads
// provider configuration and holds the credentials path just to learn what to
// print. This file imports nothing.
//
// The rule the app must never break: computed text is never labelled as model
// output, and model output is never labelled as computed. So the wording is
// fixed here, and the payload always carries the line that applies.

/** Shown when the briefing was computed from the dataset, with no model involved. */
export const COMPUTED_ATTRIBUTION = 'Computed from your data — analyst model offline';

/** Shown when a model actually wrote the text. */
export function modelAttribution(model: string | null): string {
  return `Written by ${model && model.trim().length > 0 ? model : 'a language model'}`;
}

/** The educational boundary the briefing is written inside. */
export const BRIEFING_BOUNDARY_NOTE =
  'Interpretation of your own recorded data, not medical advice: it does not diagnose, treat or rule anything out.';