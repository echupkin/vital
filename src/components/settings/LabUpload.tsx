'use client';

// ── Settings → Data & coverage: upload a lab report, review it, commit it ─────
//
// The trust boundary. A PDF is uploaded, the server parses it into a DRAFT that
// is not stored, and everything the reader sees here exists to make that draft
// checkable before a single row is written: what the document is, what date it
// carries, every row with its interval and its verdict, and every warning the
// parser raised.
//
// WHAT THIS COMPONENT MAY NOT DO:
//   * invent a date — when the parser found none the field is empty and the
//     commit is refused until the owner types one;
//   * offer to import an ORDER FORM — it is recognised and reported, and no
//     commit button exists for it;
//   * claim what was stored without the API's own numbers;
//   * render or store a patient identity. `source_line` is the analyte row's own
//     text, already redacted by the extractor, and the identity statement below
//     says plainly that nothing of the sort was kept.
//
// The decisions (what a response means, what may be sent, which rows are
// included) live in `@/lib/lab/review` as pure functions and are tested there;
// this file is the presentation over them.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Download, FileText, Info, RefreshCw, Trash2, Upload,
} from 'lucide-react';
import {
  Badge, Button, Card, DataStateNote, ErrorState, Skeleton,
} from '@/components/ui/primitives';
import type { LabDraft } from '@/lib/lab/commit';
import type { LabReport } from '@/lib/lab/types';
import type { StatusTone } from '@/lib/lab/status';
import {
  FALLBACK_MAX_BYTES,
  checkUploadFile,
  evaluateUploadResponse,
  formatBytes,
  formatDateRange,
  isIsoDate,
  rowsFromDraft,
  analyteOptions,
  statusForRow,
  summariseCommit,
  validateReview,
  type CommitSummary,
  type ReviewRow,
  type UploadProblem,
} from '@/lib/lab/review';
import { useProfile } from '@/components/profile/ProfileProvider';

// ── The stored-report shape the list endpoint returns ───────────────────────

interface ReportSummary extends LabReport {
  resultCount: number;
  analyteCount: number;
  dateCount: number;
  firstResultOn: string | null;
  lastResultOn: string | null;
}

interface ReportsState {
  loading: boolean;
  available: boolean;
  reason: string | null;
  error: string | null;
  maxBytes: number;
  reports: ReportSummary[];
}

const EMPTY_REPORTS: ReportsState = {
  loading: true,
  available: false,
  reason: null,
  error: null,
  maxBytes: FALLBACK_MAX_BYTES,
  reports: [],
};

// ── The panel ───────────────────────────────────────────────────────────────

export function LabUpload() {
  const { profile } = useProfile();

  const [reports, setReports] = useState<ReportsState>(EMPTY_REPORTS);
  const [problem, setProblem] = useState<UploadProblem | null>(null);
  const [pending, setPending] = useState<{ filename: string; progress: number } | null>(null);
  const [review, setReview] = useState<{
    draft: LabDraft;
    rows: ReviewRow[];
    documentDate: string;
    duplicateNotice: string | null;
  } | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ summary: CommitSummary | null; reportId: string } | null>(null);
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [listNotice, setListNotice] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setReports(current => ({ ...current, loading: true, error: null }));
    try {
      const res = await fetch('/api/lab/reports', { cache: 'no-store' });
      const body = (await res.json()) as Partial<ReportsState> & { reports?: ReportSummary[] };
      if (!res.ok) throw new Error(`The reports endpoint answered HTTP ${res.status}.`);
      setReports({
        loading: false,
        available: body.available ?? false,
        reason: body.reason ?? null,
        error: null,
        maxBytes: typeof body.maxBytes === 'number' ? body.maxBytes : FALLBACK_MAX_BYTES,
        reports: body.reports ?? [],
      });
    } catch (error) {
      setReports(current => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : 'The stored reports could not be read.',
      }));
    }
  }, []);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const maxBytes = reports.maxBytes;

  // ── Upload ────────────────────────────────────────────────────────────────

  const upload = useCallback(
    (file: File) => {
      // The browser's own checks first, with the API's own limit, so a doomed
      // upload is refused here with the same reason rather than after a trip.
      const clientProblem = checkUploadFile(file, maxBytes);
      if (clientProblem) {
        setProblem(clientProblem);
        setReview(null);
        setResult(null);
        return;
      }

      setProblem(null);
      setReview(null);
      setResult(null);
      setCommitError(null);
      setPending({ filename: file.name, progress: 0 });

      // XMLHttpRequest rather than fetch: only it reports upload progress, and an
      // honest progress state was asked for.
      const form = new FormData();
      form.append('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/lab/reports');
      xhr.responseType = 'text';
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) {
          setPending({ filename: file.name, progress: event.loaded / event.total });
        }
      };
      xhr.onerror = () => {
        setPending(null);
        setProblem({
          code: 'network',
          message: 'The upload could not reach the server. Nothing was imported.',
          retryable: true,
        });
      };
      xhr.onload = () => {
        setPending(null);
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }
        if (body === null) {
          setProblem({
            code: 'unreadable',
            message: `The server answered HTTP ${xhr.status} with a body that was not JSON. Nothing was imported.`,
            retryable: true,
          });
          return;
        }
        const outcome = evaluateUploadResponse(xhr.status, body);
        if (outcome.outcome === 'problem') {
          setProblem(outcome.problem);
          return;
        }
        const draft = outcome.draft;
        setReview({
          draft,
          rows: rowsFromDraft(draft),
          documentDate: draft.documentDate ?? '',
          duplicateNotice: null,
        });
      };
      xhr.send(form);
    },
    [maxBytes]
  );

  // ── Commit ────────────────────────────────────────────────────────────────

  const commit = useCallback(async () => {
    if (!review) return;
    setCommitError(null);
    const validated = validateReview(review.draft, review.rows, review.documentDate || null);
    if (!validated.ok) {
      setCommitError(validated.error);
      return;
    }
    setCommitting(true);
    try {
      const res = await fetch('/api/lab/reports/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validated.payload),
        cache: 'no-store',
      });
      const body = (await res.json()) as {
        error?: string;
        duplicate?: boolean;
        message?: string;
        report?: { id: string };
      };
      if (res.status === 409 && body.duplicate) {
        // The same document is already stored. Say so, and keep the review on
        // screen so nothing the owner typed is thrown away.
        setReview(current => (current ? { ...current, duplicateNotice: body.error ?? 'Already imported.' } : current));
        setCommitError(body.error ?? 'This document is already stored.');
        return;
      }
      if (!res.ok) {
        setCommitError(body.error ?? `The import was refused (HTTP ${res.status}). Nothing was stored.`);
        return;
      }
      setResult({ summary: summariseCommit(body), reportId: body.report?.id ?? '' });
      setReview(null);
      void loadReports();
    } catch (error) {
      setCommitError(
        `${error instanceof Error ? error.message : 'The import could not be sent.'} Nothing was stored.`
      );
    } finally {
      setCommitting(false);
    }
  }, [review, loadReports]);

  // ── Reparse / delete ──────────────────────────────────────────────────────

  const reparse = useCallback(
    async (id: string) => {
      setBusyReportId(id);
      setListNotice(null);
      try {
        const res = await fetch(`/api/lab/reports/${id}/reparse`, { method: 'POST', cache: 'no-store' });
        const body = (await res.json()) as { error?: string; replaced?: number };
        if (!res.ok) {
          setListNotice(body.error ?? `Re-parsing was refused (HTTP ${res.status}). The stored rows are untouched.`);
        } else {
          setListNotice(`Re-parsed: the report now holds ${body.replaced ?? 0} observation(s).`);
          await loadReports();
        }
      } catch (error) {
        setListNotice(error instanceof Error ? error.message : 'The report could not be re-parsed.');
      } finally {
        setBusyReportId(null);
      }
    },
    [loadReports]
  );

  const remove = useCallback(
    async (id: string, label: string) => {
      if (!window.confirm(`Delete ${label}? Its observations are removed with it. This cannot be undone.`)) {
        return;
      }
      setBusyReportId(id);
      setListNotice(null);
      try {
        const res = await fetch(`/api/lab/reports/${id}`, { method: 'DELETE', cache: 'no-store' });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) {
          setListNotice(body.error ?? `Deleting was refused (HTTP ${res.status}).`);
        } else {
          setListNotice('Deleted. The report and its observations are gone.');
          await loadReports();
        }
      } catch (error) {
        setListNotice(error instanceof Error ? error.message : 'The report could not be deleted.');
      } finally {
        setBusyReportId(null);
      }
    },
    [loadReports]
  );

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <SectionHead icon={<Upload size={18} className="text-text-secondary" />} title="Upload a lab report" />
        <p className="text-sm text-text-secondary mb-4">
          Upload a lab report PDF. Its results are read out per metric and shown for review before anything is
          stored; each observation keeps the report&rsquo;s own date, so several reports over time line up.
        </p>

        <Dropzone
          maxBytes={maxBytes}
          disabled={Boolean(pending)}
          onFile={upload}
        />

        {pending && (
          <div role="status" aria-live="polite" className="mt-4">
            <p className="text-xs text-text-secondary mb-1.5">
              Uploading {pending.filename} — {Math.round(pending.progress * 100)}%
            </p>
            <div
              className="w-full h-2 bg-surface-muted rounded-full overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pending.progress * 100)}
              aria-label="Upload progress"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(pending.progress * 100)}%` }} />
            </div>
          </div>
        )}

        {problem && <ProblemNotice problem={problem} />}

        {result && (
          <div className="mt-4 flex items-start gap-2 rounded-control border border-border p-3">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-category-activity" aria-hidden="true" />
            <div className="text-xs text-text-secondary leading-relaxed">
              <p className="text-text-primary font-medium">Imported.</p>
              {result.summary ? (
                <p>
                  Stored {result.summary.documents} document{result.summary.documents === 1 ? '' : 's'} ·{' '}
                  {result.summary.observations} observation{result.summary.observations === 1 ? '' : 's'} ·{' '}
                  {result.summary.analytes} analyte{result.summary.analytes === 1 ? '' : 's'} · result dates{' '}
                  {formatDateRange(result.summary.firstOn, result.summary.lastOn)}.
                </p>
              ) : (
                <p>
                  The import was accepted, but the server&rsquo;s response carried no counts to report. The reports list
                  below is the record of what is stored.
                </p>
              )}
            </div>
          </div>
        )}

        {review && (
          <ReviewPanel
            review={review}
            onRowsChange={rows => setReview(current => (current ? { ...current, rows } : current))}
            onDateChange={date => setReview(current => (current ? { ...current, documentDate: date } : current))}
            knownSha={reports.reports.map(report => report.sourceSha256)}
            commitError={commitError}
            committing={committing}
            onCommit={() => void commit()}
            onDiscard={() => {
              setReview(null);
              setCommitError(null);
            }}
          />
        )}
      </Card>

      <ImportedReports
        state={reports}
        notice={listNotice}
        busyReportId={busyReportId}
        onReload={() => void loadReports()}
        onReparse={id => void reparse(id)}
        onDelete={(id, label) => void remove(id, label)}
      />
    </div>
  );
}

// ── The dropzone ────────────────────────────────────────────────────────────

function Dropzone({
  maxBytes,
  disabled,
  onFile,
}: {
  maxBytes: number;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <div>
      <label
        htmlFor="lab-upload-input"
        onDragOver={event => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) take(event.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-8 text-center cursor-pointer min-h-[132px] transition-colors focus-within:ring-2 focus-within:ring-accent ${
          dragging ? 'border-accent bg-accent-tint' : 'border-border bg-surface-muted/40 hover:bg-surface-muted'
        } ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <Upload size={22} className="text-text-secondary" aria-hidden="true" />
        <span className="text-sm text-text-primary">Choose a lab report PDF, or drop one here</span>
        <span className="text-xs text-text-secondary">
          PDF only, up to {formatBytes(maxBytes)}. The file is read for its results; nothing is stored until you review it.
        </span>
        <input
          ref={inputRef}
          id="lab-upload-input"
          type="file"
          accept="application/pdf,.pdf"
          disabled={disabled}
          className="sr-only"
          onChange={event => {
            take(event.target.files);
            // Allow re-picking the same file after a refusal.
            event.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

// ── Problem notice ──────────────────────────────────────────────────────────

const PROBLEM_TITLE: Record<string, string> = {
  not_pdf: 'Not a PDF',
  too_large: 'File is too large',
  empty: 'Empty file',
  scan: 'Looks like a scan',
  order_form: 'This is a lab order',
  unreadable: 'Could not be read',
  duplicate: 'Already imported',
  network: 'Upload failed',
  unknown: 'Upload refused',
};

/**
 * The retry hint shown after a problem message. A message that already says
 * nothing was imported does not need to hear it a second time — that repetition
 * was the worst part of the copy the owner saw. Only the part the message does
 * not already carry is appended.
 */
function retryHint(problem: UploadProblem): string {
  if (!problem.retryable) return '';
  return /nothing was imported/i.test(problem.message)
    ? ' You can choose another file.'
    : ' Nothing was imported; you can choose another file.';
}

function ProblemNotice({ problem }: { problem: UploadProblem }) {
  return (
    <div
      role="status"
      className="mt-4 flex items-start gap-2 rounded-control border border-category-attention/40 p-3"
    >
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-category-attention" aria-hidden="true" />
      <p className="text-xs text-text-secondary leading-relaxed">
        <span className="text-text-primary font-medium">{PROBLEM_TITLE[problem.code] ?? 'Upload refused'}.</span>{' '}
        {problem.message}
        {retryHint(problem)}
      </p>
    </div>
  );
}

// ── The review panel ────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  results: 'Results report',
  order: 'Order form',
  unknown: 'Unrecognised document',
};

function ReviewPanel({
  review,
  onRowsChange,
  onDateChange,
  knownSha,
  commitError,
  committing,
  onCommit,
  onDiscard,
}: {
  review: { draft: LabDraft; rows: ReviewRow[]; documentDate: string; duplicateNotice: string | null };
  onRowsChange: (rows: ReviewRow[]) => void;
  onDateChange: (date: string) => void;
  knownSha: string[];
  commitError: string | null;
  committing: boolean;
  onCommit: () => void;
  onDiscard: () => void;
}) {
  const { profile } = useProfile();
  const { draft, rows, documentDate } = review;

  const included = rows.filter(row => row.include).length;
  const dateMissing = draft.documentDate === null;
  const duplicateInList = knownSha.includes(draft.sha256);

  const updateRow = (lineNo: number, patch: Partial<ReviewRow>) => {
    onRowsChange(rows.map(row => (row.lineNo === lineNo ? { ...row, ...patch } : row)));
  };

  return (
    <div className="mt-5 space-y-4 border-t border-border pt-5">
      {/* ── Document header ─────────────────────────── */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <SectionHead icon={<FileText size={18} className="text-text-secondary" />} title="Review before importing" />
          <Badge variant={draft.kind === 'results' ? 'success' : 'warning'}>{KIND_LABEL[draft.kind] ?? draft.kind}</Badge>
          {duplicateInList && <Badge variant="warning">This file is already imported</Badge>}
        </div>

        {duplicateInList && (
          <div className="mb-3 flex items-start gap-2 rounded-control border border-category-attention/40 p-3">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-category-attention" aria-hidden="true" />
            <p className="text-xs text-text-secondary leading-relaxed">
              A report with this exact SHA-256 is already stored, so importing it again will be refused. Delete the stored
              one first if you meant to replace it.
            </p>
          </div>
        )}

        {review.duplicateNotice && (
          <div className="mb-3 flex items-start gap-2 rounded-control border border-category-attention/40 p-3">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-category-attention" aria-hidden="true" />
            <p className="text-xs text-text-secondary leading-relaxed">{review.duplicateNotice}</p>
          </div>
        )}

        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
          <Fact label="Lab" value={draft.labName ?? 'Not named in the document'} />
          <Fact label="Pages" value={String(draft.pageCount)} />
          <Fact label="File" value={draft.filename} />
          <Fact label="Size" value={formatBytes(draft.bytes)} />
          <Fact label="SHA-256" value={draft.sha256} mono />
          <Fact
            label="Parser pass"
            value={draft.pass === 'model' ? 'Deterministic pass plus the optional model pass' : 'Deterministic pass'}
          />
        </dl>

        {/* ── Document date ───────────────────────────── */}
        <div className="max-w-xs">
          <label htmlFor="lab-document-date" className="block text-sm font-medium text-text-primary mb-1">
            Document date{' '}
            {dateMissing && <span className="text-category-attention">(required — the document printed none)</span>}
          </label>
          <input
            id="lab-document-date"
            type="date"
            required
            value={documentDate}
            aria-invalid={!isIsoDate(documentDate)}
            onChange={event => onDateChange(event.target.value)}
            className="bg-surface border border-border rounded-control px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent min-h-[44px] tnum"
          />
          <p className="text-xs text-text-secondary mt-1 leading-relaxed">
            {dateMissing
              ? 'The parser found no date in the document and none is invented: enter the date the report was produced.'
              : 'The date the document itself was produced, as the parser read it. Correct it if it is wrong.'}
          </p>
        </div>
      </div>

      {/* ── Warnings, in full ───────────────────────── */}
      {draft.warnings.length > 0 && (
        <div className="rounded-control border border-border p-3">
          <p className="text-sm font-medium text-text-primary mb-2">
            Warnings from the parser ({draft.warnings.length})
          </p>
          <ul className="list-disc pl-5 text-xs text-text-secondary space-y-1">
            {draft.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                {warning.page !== null ? `Page ${warning.page}: ` : ''}
                {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {draft.detectedDates.length > 0 && (
        <p className="text-xs text-text-secondary">
          Result dates read from the document: <span className="tnum">{draft.detectedDates.join(', ')}</span>. Each
          observation keeps its own column date, never the document&rsquo;s date.
        </p>
      )}

      {/* ── Rows ────────────────────────────────────── */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-sm font-medium text-text-primary">
            Extracted rows ({rows.length}) — {included} included
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onRowsChange(rows.map(row => ({ ...row, include: true })))}>
              Include all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onRowsChange(rows.map(row => ({ ...row, include: false })))}>
              Exclude all
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Extracted lab rows under review">
          <table className="w-full text-sm text-left min-w-[900px]">
            <caption className="sr-only">
              Every extracted observation, with its value, unit, interval, the report&rsquo;s own flag and the computed
              status. Each row can be edited and excluded before importing.
            </caption>
            <thead>
              <tr className="border-b border-border text-xs text-text-secondary">
                <th scope="col" className="py-2 pr-3 font-medium">Include</th>
                <th scope="col" className="py-2 pr-3 font-medium">Printed name</th>
                <th scope="col" className="py-2 pr-3 font-medium">Analyte</th>
                <th scope="col" className="py-2 pr-3 font-medium">Value</th>
                <th scope="col" className="py-2 pr-3 font-medium">Value text</th>
                <th scope="col" className="py-2 pr-3 font-medium">Unit</th>
                <th scope="col" className="py-2 pr-3 font-medium">Interval as printed</th>
                <th scope="col" className="py-2 pr-3 font-medium">Report flag</th>
                <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                <th scope="col" className="py-2 pr-3 font-medium">Interval source</th>
                <th scope="col" className="py-2 font-medium">Warning</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <RowEditor
                  key={row.lineNo}
                  row={row}
                  profile={{ dateOfBirth: profile.dateOfBirth, sex: profile.sex }}
                  onChange={patch => updateRow(row.lineNo, patch)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Privacy statement ───────────────────────── */}
      <div className="flex items-start gap-2 rounded-control border border-border p-3">
        <Info size={13} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
        <p className="text-xs text-text-secondary leading-relaxed">
          Patient identifiers found in the document — name, date of birth, address, phone, SSN, physician and NPI — were
          <span className="text-text-primary font-medium"> not stored</span>. They have no column in the database. The
          only text kept for a row is the analyte line itself, which the parser redacts before a row exists.
        </p>
      </div>

      {commitError && (
        <div className="flex items-start gap-2 rounded-control border border-category-attention/40 p-3">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-category-attention" aria-hidden="true" />
          <p className="text-xs text-text-secondary leading-relaxed">
            <span className="text-text-primary font-medium">Not imported.</span> {commitError}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={onCommit} disabled={committing || included === 0}>
          <Download size={14} aria-hidden="true" />
          <span className="ml-1.5">
            {committing ? 'Importing…' : `Import ${included} observation${included === 1 ? '' : 's'}`}
          </span>
        </Button>
        <Button variant="secondary" onClick={onDiscard} disabled={committing}>
          Discard this draft
        </Button>
        <span className="text-xs text-text-secondary">
          Nothing is stored until you import. Excluded rows are not sent at all.
        </span>
      </div>
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col min-w-0">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className={`text-text-primary break-all ${mono ? 'text-[11px] tnum' : ''}`}>{value}</dd>
    </div>
  );
}

// ── One editable row ────────────────────────────────────────────────────────

const inputClass =
  'w-full bg-surface border border-border rounded-control px-2 py-1.5 text-xs text-text-primary outline-none focus:ring-2 focus:ring-accent min-h-[36px]';

function RowEditor({
  row,
  profile,
  onChange,
}: {
  row: ReviewRow;
  profile: { dateOfBirth: string | null; sex: 'male' | 'female' | null };
  onChange: (patch: Partial<ReviewRow>) => void;
}) {
  const status = useMemo(() => statusForRow(row, profile), [row, profile]);
  const options = useMemo(() => {
    const base = analyteOptions();
    // An unrecognised analyte still gets a stable key; offer it so the select
    // never silently drops the row's own identity.
    if (!base.some(option => option.value === row.analyteKey)) {
      return [{ value: row.analyteKey, label: `${row.printedName || row.analyteKey} · ${row.analyteKey}` }, ...base];
    }
    return base;
  }, [row.analyteKey, row.printedName]);

  return (
    <tr className={`border-b border-border/50 align-top ${row.include ? '' : 'opacity-60'}`}>
      <td className="py-2 pr-3">
        <label className="flex items-center gap-1.5 min-h-[36px]">
          <input
            type="checkbox"
            checked={row.include}
            onChange={event => onChange({ include: event.target.checked })}
            className="h-4 w-4"
          />
          <span className="sr-only">
            Include {row.printedName || 'this row'} ({row.resultOn}) in the import
          </span>
        </label>
      </td>
      <td className="py-2 pr-3">
        <input
          type="text"
          value={row.printedName}
          onChange={event => onChange({ printedName: event.target.value })}
          aria-label={`Printed name for row ${row.lineNo}`}
          className={inputClass}
        />
        <span className="block text-[10px] text-text-secondary mt-0.5 tnum">{row.resultOn}</span>
      </td>
      <td className="py-2 pr-3">
        <select
          value={row.analyteKey}
          onChange={event => onChange({ analyteKey: event.target.value })}
          aria-label={`Analyte for row ${row.lineNo}`}
          className={inputClass}
        >
          {options.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-3">
        <input
          type="text"
          inputMode="decimal"
          value={row.value}
          onChange={event => onChange({ value: event.target.value })}
          aria-label={`Value for row ${row.lineNo}`}
          className={`${inputClass} tnum`}
        />
      </td>
      <td className="py-2 pr-3">
        <input
          type="text"
          value={row.valueText}
          onChange={event => onChange({ valueText: event.target.value })}
          aria-label={`Printed value text for row ${row.lineNo}`}
          className={inputClass}
        />
      </td>
      <td className="py-2 pr-3">
        <input
          type="text"
          value={row.unit}
          onChange={event => onChange({ unit: event.target.value })}
          aria-label={`Unit for row ${row.lineNo}`}
          className={inputClass}
        />
      </td>
      <td className="py-2 pr-3">
        <input
          type="text"
          value={row.refText}
          onChange={event => onChange({ refText: event.target.value })}
          aria-label={`Interval as printed for row ${row.lineNo}`}
          className={inputClass}
        />
        <div className="flex gap-1 mt-1">
          <input
            type="text"
            inputMode="decimal"
            value={row.refLow}
            onChange={event => onChange({ refLow: event.target.value })}
            aria-label={`Interval lower bound for row ${row.lineNo}`}
            placeholder="low"
            className={`${inputClass} tnum`}
          />
          <input
            type="text"
            inputMode="decimal"
            value={row.refHigh}
            onChange={event => onChange({ refHigh: event.target.value })}
            aria-label={`Interval upper bound for row ${row.lineNo}`}
            placeholder="high"
            className={`${inputClass} tnum`}
          />
        </div>
      </td>
      <td className="py-2 pr-3 text-xs text-text-secondary">{row.printedFlag ?? '—'}</td>
      <td className="py-2 pr-3">
        <StatusBadge label={status.label} tone={status.tone} />
      </td>
      <td className="py-2 pr-3">
        <Badge variant={status.interval.origin === 'report' ? 'accent' : status.interval.origin === 'none' ? 'default' : 'info'}>
          {status.sourceLabel}
        </Badge>
      </td>
      <td className="py-2 text-[11px] text-text-secondary max-w-[220px]">
        {status.warning ?? '—'}
      </td>
    </tr>
  );
}

/**
 * A verdict with a WORD and an ICON, never colour alone. The tone chooses the
 * palette; the label is what carries the meaning.
 */
function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  const styles: Record<StatusTone, string> = {
    good: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    caution: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
    attention: 'bg-red-50 text-red-800 dark:bg-red-900/40 dark:text-red-200',
    neutral: 'bg-surface-muted text-text-secondary',
  };
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'neutral' ? Info : AlertTriangle;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full ${styles[tone]}`}>
      <Icon size={11} aria-hidden="true" />
      {label}
    </span>
  );
}

// ── Imported reports ────────────────────────────────────────────────────────

function ImportedReports({
  state,
  notice,
  busyReportId,
  onReload,
  onReparse,
  onDelete,
}: {
  state: ReportsState;
  notice: string | null;
  busyReportId: string | null;
  onReload: () => void;
  onReparse: (id: string) => void;
  onDelete: (id: string, label: string) => void;
}) {
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <SectionHead icon={<FileText size={18} className="text-text-secondary" />} title="Imported lab reports" />
        <Button variant="secondary" size="sm" onClick={onReload}>
          <RefreshCw size={13} aria-hidden="true" />
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      {notice && (
        <p role="status" className="text-xs text-text-secondary mb-3">
          {notice}
        </p>
      )}

      {state.loading && (
        <div role="status" aria-live="polite" className="space-y-3">
          <span className="sr-only">Reading the stored reports</span>
          <Skeleton height={16} width="40%" />
          <Skeleton height={80} />
        </div>
      )}

      {!state.loading && state.error && (
        <ErrorState
          title="The stored reports could not be read"
          message={`${state.error} Nothing is assumed in its place.`}
          onRetry={onReload}
        />
      )}

      {!state.loading && !state.error && !state.available && (
        <DataStateNote>{(state.reason ?? 'Reports cannot be listed.') + ' Nothing is shown in their place.'}</DataStateNote>
      )}

      {!state.loading && !state.error && state.available && state.reports.length === 0 && (
        <div className="py-8 text-center">
          <p className="text-sm font-medium text-text-primary">No lab reports imported yet</p>
          <p className="text-xs text-text-secondary mt-1">
            An imported report appears here with its document date, lab, kind and result range.
          </p>
        </div>
      )}

      {!state.loading && !state.error && state.available && state.reports.length > 0 && (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Imported lab reports">
          <table className="w-full text-sm text-left min-w-[760px]">
            <caption className="sr-only">Every stored lab report, with its counts and result date range</caption>
            <thead>
              <tr className="border-b border-border text-xs text-text-secondary">
                <th scope="col" className="py-2 pr-4 font-medium">Document date</th>
                <th scope="col" className="py-2 pr-4 font-medium">Lab</th>
                <th scope="col" className="py-2 pr-4 font-medium">Kind</th>
                <th scope="col" className="py-2 pr-4 font-medium">Observations</th>
                <th scope="col" className="py-2 pr-4 font-medium">Analytes</th>
                <th scope="col" className="py-2 pr-4 font-medium">Result range</th>
                <th scope="col" className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.reports.map(report => {
                const label = `${report.sourceFilename} (${report.documentDate ?? 'no document date'})`;
                const busy = busyReportId === report.id;
                return (
                  <tr key={report.id} className="border-b border-border/50">
                    <td className="py-2 pr-4 text-text-primary tnum">{report.documentDate ?? 'none printed'}</td>
                    <td className="py-2 pr-4 text-text-secondary">{report.labName ?? 'not named'}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={report.kind === 'results' ? 'success' : 'warning'}>{KIND_LABEL[report.kind] ?? report.kind}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-text-secondary tnum">{report.resultCount}</td>
                    <td className="py-2 pr-4 text-text-secondary tnum">{report.analyteCount}</td>
                    <td className="py-2 pr-4 text-text-secondary tnum">
                      {formatDateRange(report.firstResultOn, report.lastResultOn)}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onReparse(report.id)}>
                          <RefreshCw size={12} aria-hidden="true" />
                          <span className="ml-1">Reparse</span>
                        </Button>
                        <Button variant="danger" size="sm" disabled={busy} onClick={() => onDelete(report.id, label)}>
                          <Trash2 size={12} aria-hidden="true" />
                          <span className="ml-1">Delete</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SectionHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
    </div>
  );
}