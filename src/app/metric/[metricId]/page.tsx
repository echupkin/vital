// ── /metric/[metricId] ──────────────────────────────────
//
// A shareable route per metric. The optional ?range= query opens the metric at
// a specific period, which is what insight and analyst evidence links use.
// useSearchParams needs a Suspense boundary, so the detail view sits inside one.

import { Suspense } from 'react';
import { MetricDetailPage } from '@/components/metric/MetricDetailPage';
import { LoadingState } from '@/components/ui/primitives';

export default function MetricDetail() {
  return (
    <Suspense fallback={<LoadingState label="Loading the metric detail view" />}>
      <MetricDetailPage />
    </Suspense>
  );
}
