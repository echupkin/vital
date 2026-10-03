// ── /api/geocode ────────────────────────────────────────
//
//   GET ?q=… → up to six places matching the text, for the add-map dialog.
//
// The search is sent from the server to GEOCODER_URL (OpenStreetMap Nominatim by
// default); `GEOCODER_URL=off` answers 200 with `available: false` and sends
// nothing. Neither the query nor the results are logged or stored.

import { GeocodeError, geocode, geocoderUrl } from '@/lib/activity-maps/geocode';
import { jsonResponse } from '@/lib/activity-maps/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  if (!geocoderUrl()) {
    return jsonResponse({ available: false, reason: 'Place search is turned off on this server.', results: [] });
  }
  const q = new URL(request.url).searchParams.get('q') ?? '';
  try {
    return jsonResponse({ available: true, reason: null, results: await geocode(q) });
  } catch (error) {
    const reason = error instanceof GeocodeError ? error.message : 'The place search failed.';
    return jsonResponse({ available: true, reason, results: [] }, 502);
  }
}
