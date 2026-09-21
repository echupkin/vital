// ── /analyst (SPEC §8) ──────────────────────────────────
//
// The page is a client component that talks to the server-side analyst service
// through /api/analyst. No provider, credential or dataset access is exposed
// here: the client only renders what the service returns.
//
// useSearchParams needs a Suspense boundary so the route can be prerendered.

import { Suspense } from 'react';
import { AnalystPage } from '@/components/analyst/AnalystPage';
import { LoadingState } from '@/components/ui/primitives';

export default function Analyst() {
  return (
    <Suspense
      fallback={
        <div className="max-w-3xl mx-auto px-4 py-10">
          <LoadingState label="Loading the analyst workspace" />
        </div>
      }
    >
      <AnalystPage />
    </Suspense>
  );
}
