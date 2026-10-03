// ── /api/map-providers ──────────────────────────────────
//
//   GET → each map tile provider and whether it is ready to draw: it needs no
//         key, or its key is set in the server environment. Read-only, for
//         Settings → Connections. The key itself is never in the response.

import { readProviderStatus } from '@/lib/activity-maps/tiles';
import { jsonResponse } from '@/lib/activity-maps/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  return jsonResponse({ providers: readProviderStatus() });
}
