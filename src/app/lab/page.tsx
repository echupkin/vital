// ── /lab ────────────────────────────────────────────────
//
// Imported lab results: one card per analyte, a chart per analyte, the counts by
// status, and the comparison across documents. The page reads its data from
// `/api/lab/summary` and `/api/lab/reports` in the browser, so a direct load and
// a refresh both render it — there is no client-side-only navigation involved.

import { LabPage } from '@/components/domain/LabPage';

export const metadata = {
  title: 'Lab — Vital',
};

export default function Page() {
  return <LabPage />;
}