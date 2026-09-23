// ── Status tone: the palette, in one place (pure) ───────────────────────────
//
// A tone is the COLOUR half of a status; the word is the other half and always
// accompanies it, so no meaning is ever carried by colour alone. The classes are
// the same ones the lab review panel already uses (`LabUpload.tsx`), kept
// identical here so a verdict looks the same on the Settings surface and on the
// Lab page.
//
// Contrast: each pair below is chosen to hold AA contrast for text in BOTH
// themes (a light tint with a dark ink value, and a dark tint with a light ink
// value in `.dark`).

import type { StatusTone } from './status';

export const TONE_CLASS: Record<StatusTone, string> = {
  good: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  caution: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  attention: 'bg-red-50 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  neutral: 'bg-surface-muted text-text-secondary',
};

/**
 * The same tones as chart ink. These are the app's own category tokens, so a
 * chart follows the theme instead of freezing one palette.
 */
export const TONE_COLOR: Record<StatusTone, string> = {
  good: 'var(--color-category-activity)',
  caution: 'var(--color-category-attention)',
  attention: 'var(--color-category-cardiovascular)',
  neutral: 'var(--color-text-secondary)',
};

/** The icon a tone uses. `good` checks, `neutral` informs, the rest warn. */
export const TONE_ICON: Record<StatusTone, 'check' | 'info' | 'warn'> = {
  good: 'check',
  caution: 'warn',
  attention: 'warn',
  neutral: 'info',
};
