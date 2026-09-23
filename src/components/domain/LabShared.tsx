'use client';

// ── Shared building blocks for the Lab pages ────────────────────────────────
//
// Small pieces used by both `LabPage` and `LabDetailPage`: the status pill (word
// + icon + tone, so colour is never the only signal), the honesty notices, and
// the one function that turns a stored observation into a table row with its
// provenance. Keeping the row builder here means the summary card's alternative
// table and the detail page's history table cannot drift apart.

import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { TONE_CLASS, TONE_ICON } from '@/lib/lab/tone';
import type { RowProvenance } from '@/lib/lab/client-data';
import type { StatusTone } from '@/lib/lab/status';
import {
  formatReading,
  intervalProvenance,
  orderedPoints,
  unscoredReason,
  type LabAnalyte,
  type LabPoint,
  type LabProfileFacts,
} from '@/lib/lab/view';
import {
  LAB_EDUCATIONAL_NOTICE,
  LAB_INTERVAL_NOTICE,
  LAB_SOURCE_NOTICE,
} from '@/lib/lab/notice';
import type { LabTableRow } from '@/components/charts';

/** A verdict as a WORD with an ICON and a tone. Never colour alone. */
export function LabStatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  const icon = TONE_ICON[tone];
  const Icon = icon === 'check' ? CheckCircle2 : icon === 'warn' ? AlertTriangle : Info;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full ${TONE_CLASS[tone]}`}>
      <Icon size={11} aria-hidden="true" />
      {label}
    </span>
  );
}

/** The three disclosures every Lab surface carries. */
export function LabNotices({ showSource = true }: { showSource?: boolean }) {
  return (
    <div className="space-y-1.5">
      {showSource && <p className="text-[11px] leading-relaxed text-text-secondary">{LAB_SOURCE_NOTICE}</p>}
      <p className="text-[11px] leading-relaxed text-text-secondary">{LAB_INTERVAL_NOTICE}</p>
      <p className="text-[11px] leading-relaxed text-text-secondary">{LAB_EDUCATIONAL_NOTICE}</p>
    </div>
  );
}

/** A source line for one observation: which document, printed when. */
export function sourceLabel(point: LabPoint, provenance: Map<string, RowProvenance>): string {
  const row = provenance.get(point.resultId);
  if (!row) return 'stored document (provenance not readable)';
  const date = row.documentDate ? `document dated ${row.documentDate}` : 'no document date printed';
  return `${row.sourceFilename} · ${date}`;
}

/** The value's interval, exactly as shown with the row. */
export function intervalLabelFor(point: LabPoint, provenance: Map<string, RowProvenance>): string | null {
  const row = provenance.get(point.resultId);
  const printed = row?.refText ?? null;
  const resolved = intervalProvenance(point.interval).refText;
  if (printed) return printed;
  return resolved;
}

export function describeExtraction(method: RowProvenance['extractionMethod']): string {
  switch (method) {
    case 'deterministic':
      return 'read by the layout pass';
    case 'model':
      return 'read with the optional model pass';
    default:
      return 'corrected by hand';
  }
}

/**
 * Every observation of one analyte as an accessible table row, oldest first,
 * with its provenance and — when it carries no status — the reason why.
 */
export function observationRows(
  analyte: LabAnalyte,
  provenance: Map<string, RowProvenance>,
  profile: LabProfileFacts
): LabTableRow[] {
  return orderedPoints(analyte).map(point => {
    const row = provenance.get(point.resultId);
    return {
      id: point.resultId,
      date: point.resultOn,
      reading: formatReading(point),
      interval: intervalLabelFor(point, provenance),
      intervalProvenance: intervalProvenance(point.interval).text,
      status: point.statusLabel,
      source: sourceLabel(point, provenance),
      provenance: row
        ? `printed as “${row.printedName}” · ${describeExtraction(row.extractionMethod)}${
            row.printedFlag ? ` · report flag ${row.printedFlag}` : ''
          }`
        : null,
      note: unscoredReason(analyte, point, profile),
    };
  });
}

/**
 * The sex-specific-interval disclosure, shown where it matters: the profile has
 * no sex set AND a result of this analyte is unscored for exactly that reason,
 * so no band was applied and nothing was scored against a guessed sex.
 */
export function needsSexNotice(analyte: LabAnalyte, profile: LabProfileFacts): boolean {
  if (profile.sexSet || !analyte.registered) return false;
  return analyte.points.some(
    point =>
      point.status === 'unscored_no_range' &&
      (unscoredReason(analyte, point, profile) ?? '').includes('Sex in Settings')
  );
}