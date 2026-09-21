// ── Shared utilities ───────────────────────────────────

/** Format a date relative to a reference date (e.g. "today", "yesterday", "Mon 12") */
export function formatRelativeDate(dateStr: string, reference: Date = new Date('2026-09-17T12:00:00-05:00')): string {
  const d = new Date(dateStr);
  const ref = new Date(reference);
  const diffDays = Math.round((ref.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[d.getDay()];
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format an ISO datetime to readable time */
export function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Format a date for display */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Format a date short */
export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Get initials from a name */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Clamp a value between min and max */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Format a percentage change */
export function formatDelta(delta: number, deltaPercent: number | null): string {
  const sign = delta > 0 ? '+' : '';
  const pct = deltaPercent != null ? ` (${sign}${deltaPercent.toFixed(1)}%)` : '';
  return `${sign}${delta.toFixed(1)}${pct}`;
}

/** CSS variable getter (for chart colors) */
export function getCssVar(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Check if a date has any data today */
export function isToday(dateStr: string, reference: Date = new Date('2026-09-17T12:00:00-05:00')): boolean {
  const d = new Date(dateStr);
  return d.toISOString().split('T')[0] === reference.toISOString().split('T')[0];
}
