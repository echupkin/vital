'use client';

// ── /settings (SPEC §7) ─────────────────────────────────
//
// Units, timezone, theme, data coverage, the registry, connection configuration
// and status, a plain-language baseline explanation, AI privacy and notification
// preferences.
//
// Display preferences (theme, units, notifications) are stored server-side, in the
// Vital Postgres database when one is configured, so they follow the reader between
// browsers and devices; this browser keeps only a namespaced cache for the
// pre-paint theme. No API key, token or health record is ever stored in the browser.

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Bell, Clock, Database, Info, Palette, Ruler, Save, Shield, Trash2, TriangleAlert, UserRound,
} from 'lucide-react';
import { getAllMetrics, getMetric } from '@/lib/metrics';
import { convertValue, displayUnit, formatMetricWithUnit, hasConversion } from '@/lib/metrics/format';
import { coverageFact, coverageSentence } from '@/lib/analytics/coverage';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import { REFERENCE_KEY, unavailableReasonFor } from '@/lib/adapters/dataset';
import {
  applyTheme, clearPreferences, describeStoredPreferences, getPreferencesState, loadPreferences,
  savePreferencesResult, subscribePreferences, syncPreferences,
  STORAGE_KEY_NAME, type ThemeMode, type UnitSystem, type VitalPreferences,
} from '@/lib/prefs';
import {
  Badge, Button, Card, DataStateNote, ErrorState, Select, Skeleton, Tabs,
} from '@/components/ui/primitives';
import type { PipelineStatusReport, StageStatus } from '@/lib/pipeline/types';
import { STAGE_STATUS_LABEL } from '@/lib/pipeline/types';
import { FreshnessIndicator } from '@/components/shell/FreshnessIndicator';
import { useProfile } from '@/components/profile/ProfileProvider';
import { LabUpload } from '@/components/settings/LabUpload';
import {
  PROFILE_NAME_MAX,
  PROFILE_NOTES_MAX,
  type VitalProfile,
} from '@/lib/profile/types';

const TABS = [
  { id: 'account', label: 'Account' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'data', label: 'Data & coverage' },
  { id: 'connections', label: 'Connections' },
  { id: 'privacy', label: 'AI privacy' },
];

const TIMEZONES = [
  'America/Chicago',
  'America/New_York',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Australia/Sydney',
];

/**
 * A deep link such as `/settings?tab=data` opens that tab, which is what the Lab
 * page's empty state and the sex-specific-interval notice link to. `useSearchParams`
 * needs a Suspense boundary, so the view sits inside one.
 */
export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-4xl mx-auto space-y-6">
          <h1 className="text-2xl md:text-3xl font-semibold text-text-primary">Settings</h1>
          <div role="status" aria-live="polite" className="space-y-3">
            <span className="sr-only">Loading settings</span>
            <Skeleton height={120} />
            <Skeleton height={200} />
          </div>
        </div>
      }
    >
      <SettingsView />
    </Suspense>
  );
}

function SettingsView() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [prefs, setPrefs] = useState<VitalPreferences | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [tab, setTab] = useState(
    requestedTab && TABS.some(candidate => candidate.id === requestedTab) ? requestedTab : 'account'
  );

  // Read the cached value for the first paint, then let the engine's server read
  // replace it. These settings belong to the account, not to this browser.
  useEffect(() => {
    setPrefs(loadPreferences());
    const unsubscribe = subscribePreferences(() => {
      setPrefs(getPreferencesState().preferences);
    });
    void syncPreferences();
    return unsubscribe;
  }, []);

  const flash = useCallback((tone: 'ok' | 'warn' | 'error', text: string) => {
    setNotice({ tone, text });
    window.setTimeout(() => setNotice(null), 6000);
  }, []);

  const send = useCallback(
    async (next: VitalPreferences) => {
      setPrefs(next);
      const outcome = await savePreferencesResult(next);
      if (outcome.ok) {
        flash('ok', 'Saved to your account — this applies on every browser and device you sign in from.');
        return;
      }
      if (outcome.reason === 'conflict') {
        flash('warn', outcome.message || 'These settings changed somewhere else. Nothing was saved.');
        return;
      }
      flash('error', outcome.message || 'These settings could not be saved.');
    },
    [flash]
  );

  const update = useCallback(
    <K extends keyof VitalPreferences>(key: K, value: VitalPreferences[K]) => {
      const current = loadPreferences();
      const next = { ...current, [key]: value };
      if (key === 'theme') applyTheme(value as ThemeMode);
      void send(next);
    },
    [send]
  );

  const updateNotification = useCallback(
    (key: keyof VitalPreferences['notifications'], value: boolean) => {
      const current = loadPreferences();
      const next = { ...current, notifications: { ...current.notifications, [key]: value } };
      void send(next);
    },
    [send]
  );

  if (!prefs) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl md:text-3xl font-semibold text-text-primary">Settings</h1>
        <div role="status" aria-live="polite" className="space-y-3">
          <span className="sr-only">Loading your saved preferences</span>
          <Skeleton height={120} />
          <Skeleton height={200} />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold text-text-primary">Settings</h1>
          <p className="text-sm text-text-secondary mt-1">
            Preferences, coverage and honest connection states for this build.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* The Data pipeline panel lives here now: provenance is a Settings
              surface, not page chrome. This opens the same panel the fast
              freshness control in the header used to. */}
          <FreshnessIndicator />
          {notice && (
            <span
              role="status"
              className={
                'inline-flex items-center gap-1 text-xs ' +
                (notice.tone === 'ok'
                  ? 'text-text-secondary'
                  : notice.tone === 'warn'
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-red-700 dark:text-red-400')
              }
            >
              <Save size={12} aria-hidden="true" /> {notice.text}
            </span>
          )}
        </div>
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'account' && <AccountTab />}

      {tab === 'preferences' && (
        <div className="space-y-5">
          {/* ── Units ──────────────────────────────── */}
          <Card className="p-6">
            <SectionHead icon={<Ruler size={18} className="text-text-secondary" />} title="Units" />
            <div className="flex flex-wrap gap-2 mb-4">
              {(['metric', 'imperial'] as const).map(unit => (
                <ChoiceButton
                  key={unit}
                  active={prefs.units === unit}
                  onClick={() => update('units', unit)}
                  label={unit === 'metric' ? 'Metric (kg, km, °C)' : 'Imperial (lb, mi, °F)'}
                />
              ))}
            </div>
            <div className="rounded-control border border-border p-4">
              <p className="text-xs text-text-secondary mb-2">
                Conversions are applied by the same registry formatting helper used everywhere else, so a switched unit
                changes the display consistently:
              </p>
              <ul className="list-none p-0 m-0 text-xs space-y-1 tnum">
                {UNIT_EXAMPLES.map(ex => (
                  <li key={ex.metricId} className="flex items-center justify-between gap-3">
                    <span className="text-text-secondary">{ex.label}</span>
                    <span className="text-text-primary">
                      {formatExample(ex, prefs.units)}
                    </span>
                  </li>
                ))}
              </ul>
              <DataStateNote>
                Units with no defined conversion (beats per minute, milliseconds, grams) are shown unchanged in both
                systems. A conversion is never applied to a metric that has none.
              </DataStateNote>
            </div>
          </Card>

          {/* ── Theme ──────────────────────────────── */}
          <Card className="p-6">
            <SectionHead icon={<Palette size={18} className="text-text-secondary" />} title="Theme" />
            <div className="flex flex-wrap gap-2">
              {(['light', 'dark', 'system'] as const).map(theme => (
                <ChoiceButton
                  key={theme}
                  active={prefs.theme === theme}
                  onClick={() => update('theme', theme)}
                  label={theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System'}
                />
              ))}
            </div>
            <DataStateNote>
              The theme is applied before first paint from a stored value, so there is no flash of the wrong theme.
            </DataStateNote>
          </Card>

          {/* ── Notifications ──────────────────────── */}
          <Card className="p-6">
            <SectionHead icon={<Bell size={18} className="text-text-secondary" />} title="Notification preferences" />
            <ul className="list-none p-0 m-0 space-y-3">
              {NOTIFICATION_ROWS.map(row => (
                <li key={row.key} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary">{row.label}</p>
                    <p className="text-xs text-text-secondary">{row.description}</p>
                  </div>
                  <label className="flex items-center gap-2 shrink-0 min-h-[44px]">
                    <span className="sr-only">{row.label}</span>
                    <input
                      type="checkbox"
                      checked={prefs.notifications[row.key]}
                      onChange={e => updateNotification(row.key, e.target.checked)}
                      className="h-4 w-4"
                    />
                  </label>
                </li>
              ))}
            </ul>
            <DataStateNote>
              These flags change what this dashboard highlights; they do not schedule or deliver anything. No
              notification service, email sender or push subscription is configured in this build, so nothing can be
              sent to you from here.
            </DataStateNote>
          </Card>

          {/* ── Where the settings live ──────────────── */}
          <Card className="p-6">
            <SectionHead icon={<Database size={18} className="text-text-secondary" />} title="Where these settings are stored" />
            <p className="text-xs text-text-secondary mb-3">
              Theme, units and notification switches are stored <span className="text-text-primary">on the server</span> —
              in the Vital Postgres database when one is configured — so they follow you to any other browser or device
              instead of being trapped in one browser. Saving happens against the server: if the settings were changed
              somewhere else first, the change is refused and you are told rather than one device overwriting another.
            </p>
            <p className="text-xs text-text-secondary mb-3">
              This browser keeps one small <span className="text-text-primary">cache</span> of the last values it read at{' '}
              <code>{STORAGE_KEY_NAME}</code>. Its only job is to apply the right theme before the first paint (so the page
              does not flash the wrong one) and to keep the page working if the server is briefly unreachable. It is never
              the source of truth: the server&rsquo;s record always wins, and nothing is sent anywhere else. No API key,
              token or health record is stored in the browser, and the timezone is not here either — it belongs to the
              server-owned profile on the Account tab, so the browser and the server cannot disagree about the day.
            </p>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Cached preference values">
              <table className="w-full text-sm text-left">
                <caption className="sr-only">The cache entry this browser keeps, and its value</caption>
                <thead>
                  <tr className="border-b border-border text-xs text-text-secondary">
                    <th scope="col" className="py-2 pr-4 font-medium">Key</th>
                    <th scope="col" className="py-2 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {describeStoredPreferences(prefs).map(row => (
                    <tr key={row.key} className="border-b border-border/50">
                      <td className="py-2 pr-4 text-text-secondary"><code>{row.key}</code></td>
                      <td className="py-2 tnum text-text-primary">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <Button
                variant="secondary"
                onClick={() => {
                  clearPreferences();
                  const fresh = loadPreferences();
                  applyTheme(fresh.theme);
                  setPrefs(fresh);
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span className="ml-1.5">Clear stored preferences</span>
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'data' && <DataTab />}

      {tab === 'connections' && <ConnectionsTab />}

      {tab === 'privacy' && <PrivacyTab />}
    </div>
  );
}

// ── Account tab ─────────────────────────────────────────

/**
 * The profile: what the server knows about the person that the health report
 * cannot contain. It is a file the server owns, not a browser preference — the
 * greeting, the avatar and the briefing all read this one record.
 *
 * Validation happens on the server; a rejected draft is shown as the server's
 * own message and nothing on disk changes.
 */
function AccountTab() {
  const router = useRouter();
  const { profile, saving, save } = useProfile();
  const [draft, setDraft] = useState<VitalProfile>(profile);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Adopt the server's copy whenever it changes (a refresh, or a first read).
  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(profile), [draft, profile]);

  const submit = async () => {
    setError(null);
    try {
      await save(draft);
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 2000);
      // The layout is a server component: refreshing re-renders it, so the
      // avatar and any other server-rendered surface pick up the new name.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The profile could not be saved.');
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <SectionHead icon={<UserRound size={18} className="text-text-secondary" />} title="Account and profile" />
        <p className="text-xs text-text-secondary mb-5">
          This is not a device preference and it is not a login. It is a short record the server owns, used by the
          greeting, the avatar and the daily briefing. Nothing here is a credential, and no field is required.
        </p>

        <div className="space-y-5">
          {/* ── Name ─────────────────────────────── */}
          <Field
            label="Name"
            hint={`Shown in the greeting and used as the avatar initials. Up to ${PROFILE_NAME_MAX} characters. With no name, the greeting simply omits it and the avatar shows a neutral icon.`}
          >
            <input
              type="text"
              value={draft.name ?? ''}
              maxLength={PROFILE_NAME_MAX}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              placeholder="No name set"
              aria-label="Name"
              className="w-full bg-surface border border-border rounded-control px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent min-h-[44px]"
            />
          </Field>

          {/* ── Date of birth + Sex ──────────────── */}
          <div className="grid sm:grid-cols-2 gap-5">
            <Field
              label="Date of birth"
              hint="Optional. Only the resulting age is used, as context for the briefing; the date itself is not sent anywhere."
            >
              <input
                type="date"
                value={draft.dateOfBirth ?? ''}
                onChange={e => setDraft({ ...draft, dateOfBirth: e.target.value })}
                aria-label="Date of birth"
                className="bg-surface border border-border rounded-control px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent min-h-[44px] tnum"
              />
            </Field>

            <Field
              label="Sex"
              hint="Used only to pick sex-specific reference intervals for lab results, and never inferred from an uploaded document."
            >
              <Select
                value={draft.sex ?? ''}
                onChange={v => setDraft({ ...draft, sex: v === 'male' || v === 'female' ? v : null })}
                options={SEX_OPTIONS}
                aria-label="Sex"
              />
            </Field>
          </div>

          {/* ── Notes ────────────────────────────── */}
          <Field
            label="Notes"
            hint={`Optional, up to ${PROFILE_NOTES_MAX} characters. For anything the health report cannot contain — a training goal, a medication that affects heart rate. The briefing is told this is data, never an instruction.`}
          >
            <textarea
              value={draft.notes ?? ''}
              maxLength={PROFILE_NOTES_MAX}
              rows={3}
              onChange={e => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Nothing recorded"
              aria-label="Notes"
              className="w-full bg-surface border border-border rounded-control px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent"
            />
          </Field>

          {/* ── Timezone ─────────────────────────── */}
          <Field
            label="Timezone"
            hint="The single source of truth for the app's calendar days: it labels windows in this browser AND cuts the server's day boundaries and briefing day. The dataset itself is stored in its own zone and is never rewritten."
          >
            <Select
              value={draft.timezone}
              onChange={v => setDraft({ ...draft, timezone: v })}
              options={[
                ...TIMEZONES.map(tz => ({ value: tz, label: tz })),
                ...(TIMEZONES.includes(draft.timezone)
                  ? []
                  : [{ value: draft.timezone, label: `${draft.timezone} (current)` }]),
              ]}
              aria-label="Timezone"
            />
          </Field>

          {/* ── Briefing hour ────────────────────── */}
          <Field
            label="Daily briefing hour"
            hint="A new briefing is written once per day, lazily, on the first visit at or after this hour. Before it, the previous day's briefing stays on screen, labelled with the day it covers. There is no scheduler and no background job."
          >
            <Select
              value={String(draft.briefingHour)}
              onChange={v => setDraft({ ...draft, briefingHour: Number(v) })}
              options={BRIEFING_HOUR_OPTIONS}
              aria-label="Daily briefing hour"
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => void submit()} disabled={!dirty || saving}>
            <Save size={14} aria-hidden="true" />
            <span className="ml-1.5">{saving ? 'Saving…' : dirty ? 'Save profile' : 'Saved'}</span>
          </Button>
          {savedAt && (
            <span role="status" className="text-xs text-text-secondary">
              Saved to your account on the server.
            </span>
          )}
          {dirty && !saving && (
            <span className="text-xs text-text-secondary">Unsaved changes — the fields above are a draft.</span>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-control border border-category-attention/40 p-3">
            <TriangleAlert size={13} className="mt-0.5 shrink-0 text-category-attention" aria-hidden="true" />
            <p className="text-xs text-text-secondary leading-relaxed">
              <span className="text-text-primary font-medium">Not saved.</span> {error} The stored profile is unchanged.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

const BRIEFING_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, '0')}:00`,
}));

/**
 * The Sex select's options. `''` is "not set", which the change handler maps to
 * `null` — the only representation of an unset sex, so nothing can default to
 * one of the two values by accident.
 */
const SEX_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium text-text-primary mb-1">{label}</p>
      {children}
      <p className="text-xs text-text-secondary mt-1 leading-relaxed">{hint}</p>
    </div>
  );
}

// ── Data tab ────────────────────────────────────────────

function DataTab() {
  const metrics = useMemo(() => getAllMetrics(), []);
  const categories = useMemo(() => [...new Set(metrics.map(m => m.category))], [metrics]);

  return (
    <div className="space-y-5">
      {/* ── Lab report upload ─────────────────────── */}
      <LabUpload />

      <Card className="p-6">
        <SectionHead icon={<Database size={18} className="text-text-secondary" />} title="Data coverage" />
        <p className="text-sm text-text-secondary mb-4">
          Coverage counts the days on which a value exists. Missing days are excluded from every calculation and never
          counted as zero.
        </p>
        <div className="grid gap-3">
          {metrics.map(m => {
            const fact = coverageFact(m.id);
            const pct = fact ? Math.round((fact.observedDays / Math.max(1, fact.expectedDays)) * 100) : 0;
            return (
              <div key={m.id} className="rounded-control border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-text-primary">{m.displayName}</span>
                    <span className="text-xs text-text-secondary ml-2">
                      {fact ? fact.samplingFrequency : 'no coverage record'}
                    </span>
                  </div>
                  <Badge variant={fact ? (pct >= 80 ? 'success' : pct >= 40 ? 'warning' : 'default') : 'warning'}>
                    {fact ? `${pct}%` : 'No data'}
                  </Badge>
                </div>
                {fact ? (
                  <>
                    <div className="w-full h-2 bg-surface-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-text-secondary mt-1 gap-3">
                      <span className="tnum">{fact.observedDays} of {fact.expectedDays} days</span>
                      <span>{formatDayKeyLong(fact.firstKey)} – {formatDayKeyLong(fact.lastKey)}</span>
                    </div>
                    <div className="text-[10px] text-text-secondary mt-0.5">
                      Sources: {fact.sources.join(', ')} · {fact.observations} stored records
                    </div>
                  </>
                ) : (
                  <DataStateNote>{unavailableReasonFor(m.id)} Nothing is substituted.</DataStateNote>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-6">
        <SectionHead icon={<Info size={18} className="text-text-secondary" />} title="Available metrics" />
        <p className="text-sm text-text-secondary mb-4">
          {metrics.length} metrics are registered across {categories.length} categories. This table is generated from the
          registry, so a metric added there appears here without any further change.
        </p>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Registered metrics">
          <table className="w-full text-sm text-left">
            <caption className="sr-only">Every registered metric with its unit, aggregation, coverage and detail route</caption>
            <thead>
              <tr className="border-b border-border text-xs text-text-secondary">
                <th scope="col" className="py-2 pr-4 font-medium">Metric</th>
                <th scope="col" className="py-2 pr-4 font-medium">Category</th>
                <th scope="col" className="py-2 pr-4 font-medium">Unit</th>
                <th scope="col" className="py-2 pr-4 font-medium">Aggregation</th>
                <th scope="col" className="py-2 pr-4 font-medium">Coverage</th>
                <th scope="col" className="py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => (
                <tr key={m.id} className="border-b border-border/50">
                  <td className="py-2 pr-4 text-text-primary">{m.displayName}</td>
                  <td className="py-2 pr-4 text-text-secondary">{m.category}</td>
                  <td className="py-2 pr-4 text-text-secondary">{m.canonicalUnit || 'none'}</td>
                  <td className="py-2 pr-4 text-text-secondary">{m.aggregationStrategy}</td>
                  <td className="py-2 pr-4 text-[11px] text-text-secondary tnum">{coverageSentence(m.id)}</td>
                  <td className="py-2">
                    <Link href={`/metric/${m.id}`} className="text-xs text-primary hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-6">
        <SectionHead icon={<Info size={18} className="text-text-secondary" />} title="About baselines" />
        <div className="text-sm text-text-secondary leading-relaxed space-y-2">
          <p>
            A baseline is the period immediately before the window being evaluated, with the same length. A 7-day view
            compares the last 7 days against the 7 days before them.
          </p>
          <p>
            Missing days are excluded rather than treated as zero, and a baseline needs a minimum number of observations
            before anything is compared at all. Totals that are still accumulating exclude the in-progress day from both
            sides, so 6 complete days are compared with 6 complete days.
          </p>
          <p className="text-text-primary">
            A personal baseline describes your own recent history. It is not a medical reference range, and a value
            inside or outside it is not, by itself, evidence about your health.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ── Connections tab ─────────────────────────────────────

function ConnectionsTab() {
  const [report, setReport] = useState<PipelineStatusReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setReport(null);
    try {
      const res = await fetch('/api/pipeline/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`The status endpoint answered HTTP ${res.status}.`);
      setReport((await res.json()) as PipelineStatusReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The pipeline status could not be read.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <SectionHead icon={<Database size={18} className="text-text-secondary" />} title="Data pipeline" />
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            Check again
          </Button>
        </div>

        {error && (
          <ErrorState
            title="The pipeline status could not be read"
            message={`${error} No live status is being assumed in its place.`}
            onRetry={() => void load()}
          />
        )}

        {!report && !error && (
          <div role="status" aria-live="polite" className="space-y-3">
            <span className="sr-only">Checking each pipeline stage</span>
            <Skeleton height={16} width="40%" />
            <Skeleton height={80} />
          </div>
        )}

        {report && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Badge variant={report.mode === 'live' ? 'success' : 'accent'}>
                {report.mode === 'live' ? 'Live source configured' : 'Demo mode'}
              </Badge>
              <span className="text-xs text-text-secondary">{report.summary}</span>
            </div>
            <ol className="space-y-3 list-none p-0 m-0">
              {report.stages.map((stage, i) => (
                <li key={stage.id} className="flex items-start gap-3">
                  <StageDot status={stage.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{stage.name}</span>
                      <StageLabel status={stage.status} />
                    </div>
                    <p className="text-[11px] text-text-secondary leading-relaxed">{stage.detail}</p>
                    <p className="text-[10px] text-text-secondary leading-relaxed mt-0.5">
                      How this status was derived: {stage.derivedFrom}
                    </p>
                  </div>
                  <span className="text-[10px] text-text-secondary tnum">{i + 1}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4">
              <DataStateNote>
                A stage is marked healthy only when its status is known from a real check. Unknown is a valid state and
                is used wherever nothing can be confirmed. Data as of {report.dataAsOf}; checked {report.checkedAt}.
              </DataStateNote>
            </div>
          </>
        )}
      </Card>

      <Card className="p-6">
        <SectionHead icon={<Shield size={18} className="text-text-secondary" />} title="Connection configuration and status" />
        <div className="space-y-3 text-sm">
          <StatusRow
            label="Health Auto Export server"
            value={
              report?.config.healthApiConfigured
                ? `Configured (${report.config.healthApiHost ?? 'host unknown'})`
                : 'Not configured'
            }
            tone={report?.config.healthApiConfigured ? 'neutral' : 'muted'}
          />
          <StatusRow
            label="Read token"
            value={report?.config.healthApiConfigured ? 'Present on the server (never exposed)' : 'Not set'}
            tone="muted"
          />
          <StatusRow
            label="Live health adapter"
            value={
              report?.mode === 'live'
                ? 'Active — reads Health Auto Export server-side'
                : 'Not active (demo mode reads the committed fixtures)'
            }
            tone={report?.mode === 'live' ? 'neutral' : 'muted'}
          />
          <StatusRow
            label="Data source"
            value={report?.mode === 'live' ? 'Live Health Auto Export history' : 'Committed demo fixtures'}
            tone="neutral"
          />
        </div>
        <div className="mt-4">
          <DataStateNote>
            Credentials are read from the server environment only and are never returned to the browser. Every health
            read happens in server code: the browser never calls the export API and never receives the token. When live
            mode is selected and the source cannot be read, the app shows a connection error rather than demo data.
          </DataStateNote>
        </div>
      </Card>
    </div>
  );
}

// ── Privacy tab ─────────────────────────────────────────

interface AnalystConfigState {
  configured: boolean;
  misconfigured: boolean;
  misconfiguredReason: string | null;
  provider: string;
  providerDisplayName: string;
  model: string | null;
  destination: string | null;
  hasKey: boolean;
  endpointIsLoopback: boolean;
  sendingCategories: string[];
  systemPromptSource: 'built-in' | 'custom';
  systemPromptWarning: string | null;
  prompts: string[];
}

function PrivacyTab() {
  const [state, setState] = useState<AnalystConfigState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/analyst', { cache: 'no-store' });
      if (!res.ok) throw new Error(`The analyst endpoint answered HTTP ${res.status}.`);
      setState((await res.json()) as AnalystConfigState);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The provider state could not be read.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <SectionHead icon={<Shield size={18} className="text-text-secondary" />} title="AI provider and privacy" />

        {error && (
          <ErrorState
            title="Provider state unavailable"
            message={`${error} Nothing is assumed in its place — the state is reported as unknown rather than "not configured".`}
            onRetry={() => void load()}
          />
        )}

        {!state && !error && (
          <div role="status" aria-live="polite" className="space-y-3">
            <span className="sr-only">Reading the provider configuration state</span>
            <Skeleton height={16} width="50%" />
            <Skeleton height={60} />
          </div>
        )}

        {state && (
          <div className="space-y-3 text-sm">
            <StatusRow
              label="Analyst feature"
              value={
                state.configured
                  ? state.providerDisplayName
                  : state.misconfigured
                    ? `${state.providerDisplayName} (misconfigured)`
                    : 'Demo analyst'
              }
              tone={state.misconfigured ? 'warning' : state.configured ? 'neutral' : 'warning'}
            />
            <StatusRow label="Provider" value={state.configured || state.misconfigured ? state.providerDisplayName : 'None configured (demo)'} tone="muted" />
            <StatusRow label="Model" value={state.model ?? 'None configured'} tone="muted" />
            <StatusRow label="Endpoint host" value={state.destination ?? 'None configured'} tone="muted" />
            <StatusRow
              label="Credential"
              value={
                state.hasKey
                  ? 'Present on the server only'
                  : state.endpointIsLoopback
                    ? 'Not set — not required for a loopback endpoint'
                    : 'Not set'
              }
              tone="muted"
            />
            <StatusRow
              label="System prompt"
              value={
                state.systemPromptSource === 'custom'
                  ? 'Custom (ANALYST_SYSTEM_PROMPT or ANALYST_SYSTEM_PROMPT_FILE)'
                  : 'Built-in analyst prompt'
              }
              tone="muted"
            />
            <StatusRow
              label="Answers in this build"
              value={
                state.configured
                  ? `Generated by ${state.model ?? 'the configured model'} and validated against the selected context server-side`
                  : state.misconfigured
                    ? 'No answer is produced until the configuration is fixed'
                    : `Computed by ${state.prompts.length} deterministic handlers`
              }
              tone="muted"
            />
            {state.misconfiguredReason && (
              <div className="flex items-start gap-2 rounded-control border border-category-attention/40 p-3">
                <TriangleAlert size={13} className="mt-0.5 shrink-0 text-category-attention" aria-hidden="true" />
                <p className="text-xs text-text-secondary leading-relaxed">
                  <span className="text-text-primary font-medium">Configuration invalid.</span>{' '}
                  {state.misconfiguredReason} The analyst reports this instead of falling back to demo answers.
                </p>
              </div>
            )}
            {state.systemPromptWarning && (
              <div className="flex items-start gap-2 rounded-control border border-border p-3">
                <TriangleAlert size={13} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
                <p className="text-xs text-text-secondary leading-relaxed">{state.systemPromptWarning}</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-text-primary mb-1">
              {state?.configured || state?.misconfigured ? 'What is sent to the configured provider' : 'What would be sent, if a provider were configured'}
            </p>
            {state && state.sendingCategories.length > 0 ? (
              <ul className="list-disc pl-5 text-xs text-text-secondary space-y-1">
                {state.sendingCategories.map(c => <li key={c}>{c}</li>)}
              </ul>
            ) : (
              <p className="text-xs text-text-secondary">
                Nothing. With no provider configured, no health context leaves this machine. If one were configured, the
                categories above would be listed here and the prompt is sent to that provider directly.
              </p>
            )}
          </div>
          <DataStateNote>
            Health context is never sent whole: retrieval selects only the summaries a question needs, caps each series at
            90 points, and treats imported notes as untrusted data rather than instructions. Analyst responses are marked
            private and uncacheable.
          </DataStateNote>
          <DataStateNote>
            This build claims no compliance certification and no production security boundary. A local demo may run
            without authentication; a live deployment would need an explicit access-control boundary in front of it.
          </DataStateNote>
        </div>
      </Card>

      <Card className="p-6">
        <SectionHead icon={<Info size={18} className="text-text-secondary" />} title="What the analyst can answer" />
        <p className="text-xs text-text-secondary mb-3">
          {state?.configured
            ? `Any question is sent to ${state.providerDisplayName} with a bounded selection of your data. The questions below are handled locally by deterministic handlers when they match, and are useful examples.`
            : 'The demo analyst answers these questions from your dataset by pattern matching; anything outside the list is reported as unsupported rather than guessed at.'}
        </p>
        <ul className="list-none p-0 m-0 space-y-2">
          {(state?.prompts ?? []).map(p => (
            <li key={p} className="text-sm text-text-secondary flex items-start gap-2">
              <span className="text-primary shrink-0" aria-hidden="true">•</span>
              <Link href={`/analyst?q=${encodeURIComponent(p)}`} className="hover:underline text-text-primary">
                {p}
              </Link>
            </li>
          ))}
          {!state && <li className="text-sm text-text-secondary">Loading the supported questions…</li>}
        </ul>
      </Card>
    </div>
  );
}

// ── Small building blocks ───────────────────────────────

function SectionHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      {icon}
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
    </div>
  );
}

function ChoiceButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-4 py-2 text-sm rounded-control border transition-colors min-h-[44px] ${
        active
          ? 'bg-primary text-primary-text border-primary'
          : 'bg-surface text-text-secondary border-border hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: 'neutral' | 'muted' | 'warning' }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-border last:border-b-0">
      <span className="text-text-primary">{label}</span>
      <span
        className={`text-xs inline-flex items-center gap-1.5 ${
          tone === 'warning' ? 'text-category-attention' : 'text-text-secondary'
        }`}
      >
        {tone === 'warning' && <TriangleAlert size={12} aria-hidden="true" />}
        {value}
      </span>
    </div>
  );
}

function StageDot({ status }: { status: StageStatus }) {
  const tone =
    status === 'healthy'
      ? 'bg-category-activity'
      : status === 'degraded'
        ? 'bg-category-attention'
        : 'bg-border';
  return <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${tone}`} aria-hidden="true" />;
}

function StageLabel({ status }: { status: StageStatus }) {
  const variant = status === 'healthy' ? 'success' : status === 'degraded' ? 'warning' : 'default';
  // The word is part of the label, so the state is never conveyed by colour alone.
  return <Badge variant={variant} className="text-[10px]">{STAGE_STATUS_LABEL[status]}</Badge>;
}

interface UnitExample {
  label: string;
  metricId: string;
  sample: number;
}

const UNIT_EXAMPLES: UnitExample[] = [
  { label: 'Weight', metricId: 'weight_body_mass', sample: 76.8 },
  { label: 'Distance', metricId: 'distance_walking_running', sample: 5 },
  { label: 'Waist', metricId: 'waist_circumference', sample: 84 },
  { label: 'Resting heart rate', metricId: 'resting_heart_rate', sample: 56 },
];

function formatExample(ex: UnitExample, system: UnitSystem): string {
  const meta = getMetric(ex.metricId);
  if (!meta) return '—';
  const shown = formatMetricWithUnit(ex.metricId, ex.sample, system);
  if (!hasConversion(meta.canonicalUnit)) return `${shown} · no conversion defined`;
  const converted = convertValue(ex.sample, meta.canonicalUnit, system);
  const target = displayUnit(meta.canonicalUnit, system);
  return `${shown} · ${ex.sample} ${meta.canonicalUnit} → ${converted.toFixed(1)} ${target}`;
}

const NOTIFICATION_ROWS: {
  key: keyof VitalPreferences['notifications'];
  label: string;
  description: string;
}[] = [
  {
    key: 'dailyBriefing',
    label: 'Highlight the daily briefing',
    description: 'Bring the morning briefing to the top of the Overview when nothing has moved outside its baseline.',
  },
  {
    key: 'weeklyReport',
    label: 'Highlight the weekly report',
    description: 'Surface the most recent complete week on the Insights page.',
  },
  {
    key: 'staleData',
    label: 'Show stale-data indicators',
    description: 'Mark a metric when its most recent reading is more than a day behind the reference day.',
  },
];
