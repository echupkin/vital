// ── /lab/[analyteKey] ───────────────────────────────────
//
// A shareable route per analyte: its whole imported history, the chart with the
// interval band and a range control, every stored row with its provenance, and
// the analytes related to it. An unknown key renders an honest not-found state
// rather than throwing.

import { LabDetailPage } from '@/components/domain/LabDetailPage';

export default function AnalyteDetail() {
  return <LabDetailPage />;
}