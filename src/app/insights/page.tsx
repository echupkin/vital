// ── /insights (SPEC §7) ─────────────────────────────────
//
// The filter and tab are read from the query string so an evidence link such as
// /insights?tab=reports lands on the archive it refers to.

import { InsightsPage } from '@/components/domain/InsightsPage';

const FILTERS = ['all', 'change', 'trend', 'association', 'report'] as const;
const TABS = ['insights', 'reports', 'story'] as const;

export default async function Insights({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const filter = FILTERS.includes(params.filter as (typeof FILTERS)[number])
    ? (params.filter as (typeof FILTERS)[number])
    : 'all';
  const tab = TABS.includes(params.tab as (typeof TABS)[number]) ? (params.tab as string) : 'insights';

  return <InsightsPage initialFilter={filter} initialTab={tab} />;
}
