// ── Navigation registry ─────────────────────────────────
//
// Every page Vital can navigate to, and where each one sits in the hierarchy.
// The sidebar, the mobile nav, the command palette and the breadcrumbs all read
// this one table, so a page added here shows up everywhere at once and the
// surfaces can no longer disagree about what exists or what is active.
//
// PURE DATA + PURE FUNCTIONS: no React state, so the trail resolution is
// unit-tested in nav.test.ts.

import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, TrendingUp, Heart, FlaskConical, Activity, Moon, Weight,
  UtensilsCrossed, Dumbbell, Lightbulb, Bot, Settings, Pill, Palette,
} from 'lucide-react';
import { getMetric } from '@/lib/metrics/registry';
import type { MetricCategory } from '@/lib/metrics/types';
import { analyteByKey } from '@/lib/lab/analytes';
import { analyteKeyOfSeriesId } from '@/lib/lab/panel';

/** A page inside a section, listed under it in the sidebar. */
export interface NavPage {
  id: string;
  label: string;
  href: string;
  /** Shown by the command palette. */
  description: string;
  /** The palette's label, when the sidebar's short one needs its section to make sense. */
  searchLabel?: string;
  /** Active on this exact path only, not on the paths below it. */
  exact?: boolean;
}

/** A top-level destination: one row of the sidebar. */
export interface NavSection extends NavPage {
  icon: LucideIcon;
  placement: 'main' | 'footer';
  /** In the mobile bottom bar rather than behind "More". */
  primary?: boolean;
  /** The bottom bar's label, where the full one does not fit. */
  mobileLabel?: string;
  isAnalyst?: boolean;
  children?: NavPage[];
}

export const NAV_SECTIONS: NavSection[] = [
  { id: 'overview', label: 'Overview', href: '/', icon: LayoutDashboard, description: 'Daily health briefing', placement: 'main', primary: true, exact: true },
  { id: 'trends', label: 'Trends', href: '/trends', icon: TrendingUp, description: 'What changed over time', placement: 'main', primary: true },
  { id: 'health', label: 'Health', href: '/health', icon: Heart, description: 'Cardiovascular summary', placement: 'main' },
  { id: 'lab', label: 'Lab', href: '/lab', icon: FlaskConical, description: 'Lab results imported from PDFs', placement: 'main' },
  { id: 'medications', label: 'Medications', href: '/medications', icon: Pill, description: 'Medications and supplements', placement: 'main' },
  {
    id: 'activity',
    label: 'Activity',
    href: '/activity',
    icon: Activity,
    description: 'Steps, exercise, calories',
    placement: 'main',
    children: [
      { id: 'overview', label: 'Overview', href: '/activity', description: 'Steps, exercise, calories', exact: true },
      { id: 'maps', label: 'Maps', searchLabel: 'Activity maps', href: '/activity/maps', description: 'Where outdoor workouts went' },
    ],
  },
  { id: 'sleep', label: 'Sleep', href: '/sleep', icon: Moon, description: 'Sleep analysis', placement: 'main' },
  { id: 'body', label: 'Body', href: '/body', icon: Weight, description: 'Weight and body metrics', placement: 'main' },
  { id: 'nutrition', label: 'Nutrition', href: '/nutrition', icon: UtensilsCrossed, description: 'Dietary intake', placement: 'main' },
  {
    id: 'workouts',
    label: 'Workouts',
    href: '/workouts',
    icon: Dumbbell,
    description: 'Current routine and progress',
    placement: 'main',
    children: [
      { id: 'overview', label: 'Overview', href: '/workouts', description: 'Current routine and progress', exact: true },
      { id: 'plan', label: 'Plan', searchLabel: 'Training plan', href: '/workouts/routine', description: 'Cadence, workouts, phases and blocks' },
      { id: 'recovery', label: 'Recovery', href: '/workouts/recovery', description: 'Recovery signals and deload timing' },
      { id: 'history', label: 'History', searchLabel: 'Workout history', href: '/workouts/all', description: 'Every recorded session' },
    ],
  },
  { id: 'insights', label: 'Insights', href: '/insights', icon: Lightbulb, description: 'Discovered patterns', placement: 'main', primary: true },
  { id: 'analyst', label: 'AI Analyst', href: '/analyst', icon: Bot, description: 'Ask about your health', placement: 'main', primary: true, mobileLabel: 'AI', isAnalyst: true },
  { id: 'themes', label: 'Themes', href: '/themes', icon: Palette, description: 'Light and dark colour themes', placement: 'footer' },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings, description: 'Preferences and configuration', placement: 'footer' },
];

// ── Detail pages ────────────────────────────────────────
//
// Dynamic routes have no sidebar row of their own, so each one names its parent
// explicitly instead of taking it from the URL. The URL is not a reliable guide:
// /workouts/routine/workouts has no page of its own, and /metric has none at
// all. Listed most specific first, the way Next ranks a static segment above a
// dynamic one, so a workout template is never read as a path called "workouts".

interface ParentRef {
  section: string;
  page?: string;
}

interface DetailRoute {
  /** Path segments; a leading ':' marks the dynamic one. */
  segments: string[];
  parent: (param: string) => ParentRef;
  /** The crumb's label until the page supplies a better one. */
  label: (param: string) => string;
}

/** Which section's page a metric belongs on. */
const METRIC_SECTION: Record<MetricCategory, string> = {
  cardiovascular: 'health',
  respiratory: 'health',
  recovery: 'health',
  vitals: 'health',
  sleep: 'sleep',
  activity: 'activity',
  body: 'body',
  nutrition: 'nutrition',
};

export const DETAIL_ROUTES: DetailRoute[] = [
  {
    segments: ['workouts', 'routine', 'workouts', ':templateId'],
    parent: () => ({ section: 'workouts', page: 'plan' }),
    label: () => 'Workout',
  },
  {
    segments: ['workouts', 'routine', ':pathId'],
    parent: () => ({ section: 'workouts', page: 'plan' }),
    label: () => 'Progression path',
  },
  {
    segments: ['lab', ':analyteKey'],
    parent: () => ({ section: 'lab' }),
    label: key => analyteByKey(analyteKeyOfSeriesId(key))?.displayName ?? key,
  },
  {
    segments: ['metric', ':metricId'],
    parent: id => {
      const metric = getMetric(id);
      return { section: metric ? METRIC_SECTION[metric.category] ?? 'overview' : 'overview' };
    },
    label: id => getMetric(id)?.displayName ?? id,
  },
];

// ── Trail resolution ────────────────────────────────────

export interface Crumb {
  label: string;
  href: string;
}

export interface Trail {
  /** The sidebar row to light up, or null for a path no section owns. */
  section: NavSection | null;
  /** The section's page to light up, when the section has pages. */
  page: NavPage | null;
  /** Section first, current page last. One crumb means a top-level page. */
  crumbs: Crumb[];
}

function segmentsOf(path: string): string[] {
  return path.split(/[?#]/)[0].split('/').filter(Boolean);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Whether `href` covers `path`: the same path or a parent of it, never a sibling that shares a prefix. */
function covers(href: string, path: string[], exact?: boolean): boolean {
  const own = segmentsOf(href);
  if (exact || own.length === 0) return own.length === path.length && own.every((s, i) => s === path[i]);
  return own.length <= path.length && own.every((s, i) => s === path[i]);
}

function trailTo(section: NavSection, page: NavPage | null): Crumb[] {
  const crumbs: Crumb[] = [{ label: section.label, href: section.href }];
  // A section's own landing page is the section: "Workouts › Overview" would
  // name one place twice.
  if (page && page.href !== section.href) crumbs.push({ label: page.label, href: page.href });
  return crumbs;
}

export function sectionById(id: string): NavSection | undefined {
  return NAV_SECTIONS.find(s => s.id === id);
}

export function resolveTrail(pathname: string): Trail {
  const path = segmentsOf(pathname);

  for (const route of DETAIL_ROUTES) {
    if (route.segments.length !== path.length) continue;
    if (!route.segments.every((s, i) => s.startsWith(':') || s === path[i])) continue;
    const index = route.segments.findIndex(s => s.startsWith(':'));
    const param = safeDecode(path[index]);
    const ref = route.parent(param);
    const section = sectionById(ref.section);
    if (!section) continue;
    const page = (ref.page && section.children?.find(c => c.id === ref.page)) || null;
    const href = '/' + path.join('/');
    return { section, page, crumbs: [...trailTo(section, page), { label: route.label(param), href }] };
  }

  // The deepest registered page that covers the path wins, so /workouts/all
  // lights History rather than Workouts' own landing page.
  // A page ties with its section's own href (Workouts' Overview), and wins it.
  const candidates = NAV_SECTIONS.filter(section => covers(section.href, path, section.exact)).flatMap(section => [
    { section, page: null as NavPage | null },
    ...(section.children ?? []).map(page => ({ section, page })),
  ]);
  let best: { section: NavSection; page: NavPage | null; depth: number } | null = null;
  for (const { section, page } of candidates) {
    const target = page ?? section;
    if (!covers(target.href, path, target.exact)) continue;
    const depth = segmentsOf(target.href).length;
    if (!best || depth > best.depth || (depth === best.depth && page && !best.page)) best = { section, page, depth };
  }
  if (!best) return { section: null, page: null, crumbs: [] };
  return { section: best.section, page: best.page, crumbs: trailTo(best.section, best.page) };
}

/** Every destination as a flat list, for search: sections, then their pages. */
export function flattenNav(): { id: string; label: string; description: string; href: string }[] {
  return NAV_SECTIONS.flatMap(section => [
    { id: section.id, label: section.label, description: section.description, href: section.href },
    ...(section.children ?? [])
      .filter(page => page.href !== section.href)
      .map(page => ({
        id: `${section.id}-${page.id}`,
        label: page.searchLabel ?? page.label,
        description: page.description,
        href: page.href,
      })),
  ]);
}
