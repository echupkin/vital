'use client';

// ── Live connection error (never a silent demo fallback) ─
//
// Shown in place of the dashboard when live mode is selected and the Health Auto
// Export API cannot be read. SPEC §10 is explicit: a failed live read is reported,
// never replaced with demo data, so this state replaces the pages entirely and
// offers a retry.

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Card, Button, Badge, DataStateNote } from '@/components/ui/primitives';

export interface ConnectionErrorStateProps {
  /** Short headline. */
  title: string;
  /** What failed, in plain language. */
  message: string;
  /** Host being read, or null when unconfigured. */
  host: string | null;
  /** Optional extra context (a remediation hint). */
  hint?: string;
}

export function ConnectionErrorState({ title, message, host, hint }: ConnectionErrorStateProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState(false);

  const retry = () => {
    setRefreshing(true);
    startTransition(() => {
      router.refresh();
      setTimeout(() => setRefreshing(false), 800);
    });
  };

  return (
    <div className="max-w-2xl mx-auto py-6">
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="warning" className="text-[10px]">Live source unreachable</Badge>
          <span className="text-[11px] text-text-secondary">
            {host ? `Source: ${host}` : 'No source configured'}
          </span>
        </div>
        <h1 className="text-xl font-semibold text-text-primary mb-2">{title}</h1>
        <p className="text-sm text-text-secondary leading-relaxed mb-3">{message}</p>
        {hint && <DataStateNote tone="attention">{hint}</DataStateNote>}
        <div className="mt-4 flex items-center gap-3">
          <Button variant="secondary" onClick={retry} disabled={pending || refreshing}>
            {pending || refreshing ? 'Retrying…' : 'Retry'}
          </Button>
          <span className="text-[11px] text-text-secondary">
            Demo data is deliberately not substituted for a failed live read.
          </span>
        </div>
      </Card>
    </div>
  );
}
