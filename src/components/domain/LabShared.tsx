'use client';

// ── Shared building blocks for the Lab pages ────────────────────────────────
//
// Small pieces used by both `LabPage` and `LabDetailPage`: the status pill (word
// + icon + tone, so colour is never the only signal), the honesty notices, and
// the one function that turns a stored observation into a table row with its
// provenance. Keeping the row builder here means the summary card's alternative
// table and the detail page's history table cannot drift apart.

import { AlertTriangle, CheckCircle2, ExternalLink, Info } from 'lucide-react';
import { TONE_CLASS, TONE_ICON } from '@/lib/lab/tone';
import { analyteDescription } from '@/lib/lab/descriptions';
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
  LAB_DESCRIPTION_NOTICE,
  LAB_EDUCATIONAL_NOTICE,
  LAB_INTERVAL_NOTICE,
  LAB_SOURCE_NOTICE,
} from '@/lib/lab/notice';
import { Card } from '@/components/ui/primitives';
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
 * with the interval it was scored against, the basis of its verdict — and, when
 * it carries no status, the reason why.
 *
 * NO SOURCE DOCUMENT IS NAMED. The observation date is the date a row shows;
 * the uploaded documents themselves are listed in Settings → Data & coverage.
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
      // The reason a row is unscored, or — for a row that carries no number but
      // does carry a verdict (a qualitative POSITIVE/NEGATIVE/NONE SEEN, or a
      // bound) — the basis of that verdict.
      note: unscoredReason(analyte, point, profile) ?? (point.value === null ? point.notes[0] ?? null : null),
      provenance: row
        ? `printed as “${row.printedName}”${point.panel ? ` · under “${point.panel}”` : ''} · ${describeExtraction(row.extractionMethod)}${
            row.printedFlag ? ` · report flag ${row.printedFlag}` : ''
          }`
        : null,
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

/**
 * An analyte's description on the detail route: what it is, what a high or a low
 * value may mean, the cited page as a link the reader can open and check any
 * sentence against, and the one line that says this is general information and
 * not a diagnosis.
 *
 * AN ABSENT DESCRIPTION IS ABSENT. An analyte with no description entry renders
 * NOTHING here — no card, no "Description" header and no placeholder — which is
 * this app's standing convention: a thing that is missing is missing.
 */
export function LabAnalyteDescription({ analyteKey }: { analyteKey: string }) {
  const description = analyteDescription(analyteKey);
  if (!description) return null;

  return (
    <Card className="p-5" as="section" aria-label="Description">
      <h2 className="text-sm font-semibold text-text-primary mb-2">Description</h2>
      <p className="text-sm text-text-primary leading-relaxed">{description.whatItIs}</p>
      {description.ifHigh && (
        <p className="mt-2 text-sm text-text-primary leading-relaxed">
          <span className="font-medium">If high:</span> {description.ifHigh}
        </p>
      )}
      {description.ifLow && (
        <p className="mt-2 text-sm text-text-primary leading-relaxed">
          <span className="font-medium">If low:</span> {description.ifLow}
        </p>
      )}
      <p className="mt-3">
        <a
          href={description.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline min-h-[44px]"
        >
          {description.sourceTitle}
          <ExternalLink size={12} aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </p>
      <p className="text-[11px] text-text-secondary leading-relaxed">{LAB_DESCRIPTION_NOTICE}</p>
    </Card>
  );
}