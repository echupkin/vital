// ── Preferences: shared types and pure rules ────────────
//
// The display preferences the SERVER owns: the unit system, the theme and the
// three notification flags. They live in the Vital Postgres database, in the
// same database as the profile (the `preferences` row; see `store.ts`), so one
// person's settings follow them between browsers and devices instead of being
// trapped in one browser's localStorage.
//
// This module has NO imports and touches nothing global, so the server store,
// the API route, the client sync layer and the tests all share one validator
// and one set of defaults. Nothing here reads or writes a file, a browser API
// or the network.
//
// There is no field for a credential, a token or a health record, and the route
// that serves this shape returns nothing else. A timezone is deliberately NOT
// here: it belongs to the server-owned profile (`@/lib/profile`), which is the
// single source of truth for the app's calendar days. Legacy `vital-prefs`
// payloads that still carry one are read once and the key is dropped.

export type ThemeMode = 'light' | 'dark' | 'system';
export type UnitSystem = 'metric' | 'imperial';

export interface NotificationPreferences {
  /** Show the daily briefing prompt on the Overview. */
  dailyBriefing: boolean;
  /** Show the weekly report prompt on the Insights page. */
  weeklyReport: boolean;
  /** Show the stale-data indicator on metric views. */
  staleData: boolean;
}

/** The editable display choices. This is what a PUT replaces, whole. */
export interface VitalPreferences {
  theme: ThemeMode;
  units: UnitSystem;
  notifications: NotificationPreferences;
}

/**
 * The stored record: the display choices plus the server-owned bookkeeping.
 *
 * `revision` is a monotonic integer. A revision of 0 means no record has ever
 * been written — the state the whole app starts in — and every accepted write
 * moves it forward. `updatedAt` is a server timestamp the client never sends.
 */
export interface PreferencesRecord extends VitalPreferences {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
}

/** The version of the stored record. A row with another version is rejected. */
export const PREFS_SCHEMA_VERSION = 1;

/** The namespaced local cache key. Versioned so an old shape is never read. */
export const PREFERENCES_CACHE_PREFIX = 'vital-prefs';
export function preferencesCacheKey(schemaVersion: number = PREFS_SCHEMA_VERSION): string {
  return `${PREFERENCES_CACHE_PREFIX}:v${schemaVersion}`;
}

/** The pre-sync key older builds wrote. Read once, at import, then removed. */
export const LEGACY_STORAGE_KEY = 'vital-prefs';

export const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  dailyBriefing: true,
  weeklyReport: false,
  staleData: true,
};

export const DEFAULT_PREFERENCES: VitalPreferences = {
  theme: 'system',
  units: 'metric',
  notifications: { ...DEFAULT_NOTIFICATIONS },
};

/** The fields a PUT may carry. Anything else is rejected, not dropped. */
export const PREFERENCES_FIELDS = ['theme', 'units', 'notifications', 'revision'] as const;

/** The fields a stored record carries. Anything else is rejected on read. */
export const PREFERENCES_RECORD_FIELDS = [
  'theme',
  'units',
  'notifications',
  'schemaVersion',
  'revision',
  'updatedAt',
] as const;

/** The notification flags a record may carry. */
export const NOTIFICATION_FIELDS = ['dailyBriefing', 'weeklyReport', 'staleData'] as const;

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];
export const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial'];

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

export function isUnitSystem(value: unknown): value is UnitSystem {
  return typeof value === 'string' && (UNIT_SYSTEMS as readonly string[]).includes(value);
}

/** A fresh copy of the defaults. Never a shared mutable object. */
export function defaultPreferences(): VitalPreferences {
  return { ...DEFAULT_PREFERENCES, notifications: { ...DEFAULT_NOTIFICATIONS } };
}

/** The record served when no row exists: defaults at revision 0. */
export function defaultPreferencesRecord(updatedAt: string = new Date(0).toISOString()): PreferencesRecord {
  return { ...defaultPreferences(), schemaVersion: PREFS_SCHEMA_VERSION, revision: 0, updatedAt };
}

// ── Validation ──────────────────────────────────────────

export interface PreferencesValid<T> {
  ok: true;
  value: T;
}

export interface PreferencesInvalid {
  ok: false;
  errors: string[];
}

function unknownFields(body: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(body).filter(key => !allowed.includes(key));
}

function readNotifications(
  raw: unknown,
  errors: string[],
  field: string
): NotificationPreferences {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push(`"${field}" must be an object with the notification flags.`);
    return { ...DEFAULT_NOTIFICATIONS };
  }
  const body = raw as Record<string, unknown>;
  const extra = unknownFields(body, NOTIFICATION_FIELDS);
  if (extra.length > 0) {
    errors.push(
      `Unknown field(s) in "${field}": ${extra.join(', ')}. Allowed fields are ${NOTIFICATION_FIELDS.join(', ')}.`
    );
  }
  const out = { ...DEFAULT_NOTIFICATIONS };
  for (const key of NOTIFICATION_FIELDS) {
    const value = body[key];
    if (value === undefined) {
      errors.push(`"${field}.${key}" is required.`);
    } else if (typeof value !== 'boolean') {
      errors.push(`"${field}.${key}" must be a boolean.`);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Validate an incoming PUT body: the display choices plus the client's
 * last-seen `revision`. Rejects unknown fields, wrong types and a revision that
 * is not a non-negative whole number, and returns a complete set of display
 * choices so a PUT always replaces the whole record.
 */
export function validatePreferencesInput(raw: unknown): PreferencesValid<{
  preferences: VitalPreferences;
  revision: number;
}> | PreferencesInvalid {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['The request body must be a JSON object.'] };
  }
  const body = raw as Record<string, unknown>;
  const errors: string[] = [];

  const extra = unknownFields(body, PREFERENCES_FIELDS);
  if (extra.length > 0) {
    errors.push(
      `Unknown field(s): ${extra.join(', ')}. Allowed fields are ${PREFERENCES_FIELDS.join(', ')}.`
    );
  }

  if (!isThemeMode(body.theme)) {
    errors.push(`"theme" must be one of ${THEME_MODES.join(', ')}.`);
  }
  if (!isUnitSystem(body.units)) {
    errors.push(`"units" must be one of ${UNIT_SYSTEMS.join(', ')}.`);
  }
  const notifications = readNotifications(body.notifications, errors, 'notifications');

  const revisionRaw = body.revision;
  let revision = 0;
  if (
    typeof revisionRaw !== 'number' ||
    !Number.isInteger(revisionRaw) ||
    revisionRaw < 0
  ) {
    errors.push('"revision" must be the non-negative whole number you last read.');
  } else {
    revision = revisionRaw;
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      preferences: {
        theme: body.theme as ThemeMode,
        units: body.units as UnitSystem,
        notifications,
      },
      revision,
    },
  };
}

/**
 * Validate a stored record on the way in, so a hand-edited row cannot smuggle
 * in an unknown field, a wrong type or a schema this build does not understand.
 */
export function validatePreferencesRecord(
  raw: unknown
): PreferencesValid<PreferencesRecord> | PreferencesInvalid {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['The stored preferences must be a JSON object.'] };
  }
  const body = raw as Record<string, unknown>;
  const errors: string[] = [];

  const extra = unknownFields(body, PREFERENCES_RECORD_FIELDS);
  if (extra.length > 0) {
    errors.push(
      `Unknown field(s): ${extra.join(', ')}. Allowed fields are ${PREFERENCES_RECORD_FIELDS.join(', ')}.`
    );
  }

  if (body.schemaVersion !== PREFS_SCHEMA_VERSION) {
    errors.push(`"schemaVersion" must be ${PREFS_SCHEMA_VERSION}.`);
  }
  if (!isThemeMode(body.theme)) {
    errors.push(`"theme" must be one of ${THEME_MODES.join(', ')}.`);
  }
  if (!isUnitSystem(body.units)) {
    errors.push(`"units" must be one of ${UNIT_SYSTEMS.join(', ')}.`);
  }
  const notifications = readNotifications(body.notifications, errors, 'notifications');

  if (
    typeof body.revision !== 'number' ||
    !Number.isInteger(body.revision) ||
    (body.revision as number) < 0
  ) {
    errors.push('"revision" must be a non-negative whole number.');
  }

  if (typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt))) {
    errors.push('"updatedAt" must be an ISO timestamp string.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      theme: body.theme as ThemeMode,
      units: body.units as UnitSystem,
      notifications,
      schemaVersion: PREFS_SCHEMA_VERSION,
      revision: body.revision as number,
      updatedAt: body.updatedAt as string,
    },
  };
}

/**
 * Read a legacy `vital-prefs` payload for the one-time import.
 *
 * Every field is validated on its own: a wrong-typed value falls back to its
 * default instead of poisoning the whole import, and any other key — most
 * importantly a legacy `timezone` — is ignored. Returns `null` only when the
 * value is not a JSON object at all.
 */
export function parseLegacyPreferences(raw: string): VitalPreferences | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;

  const theme = isThemeMode(body.theme) ? body.theme : DEFAULT_PREFERENCES.theme;
  const units = isUnitSystem(body.units) ? body.units : DEFAULT_PREFERENCES.units;

  const notifications = { ...DEFAULT_NOTIFICATIONS };
  const rawNotifications = body.notifications;
  if (typeof rawNotifications === 'object' && rawNotifications !== null && !Array.isArray(rawNotifications)) {
    const n = rawNotifications as Record<string, unknown>;
    for (const key of NOTIFICATION_FIELDS) {
      if (typeof n[key] === 'boolean') notifications[key] = n[key] as boolean;
    }
  }

  // A legacy `timezone` (and anything else) is deliberately dropped: the
  // timezone lives in the server-owned profile and is never a browser value.
  return { theme, units, notifications };
}

/**
 * The exact keys and values held on this device — the local cache, which exists
 * only to key the pre-paint theme and to keep the display working offline. It
 * mirrors the server's record; it is never its source of truth.
 */
export function describeStoredPreferences(prefs: VitalPreferences): { key: string; value: string }[] {
  return [
    { key: 'theme', value: prefs.theme },
    { key: 'units', value: prefs.units },
    { key: 'notifications.dailyBriefing', value: String(prefs.notifications.dailyBriefing) },
    { key: 'notifications.weeklyReport', value: String(prefs.notifications.weeklyReport) },
    { key: 'notifications.staleData', value: String(prefs.notifications.staleData) },
  ];
}
