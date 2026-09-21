// ── Analyst error scrubbing (SPEC §11) ──────────────────
//
// Everything that could reach a response body, a page or a log is scrubbed here
// first: credentials, auth headers and URLs carrying userinfo. Upstream error
// bodies are reduced to a short excerpt so a provider cannot echo anything large
// (or anything sensitive) back into the UI.

/** Any secret shorter than this is not string-replaced: it would match too much. */
const MIN_SECRET_LENGTH = 6;

export const REDACTED = '[redacted]';

/** Host only, for display. An unparseable URL has no host to show. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Remove credentials and auth header values from a string.
 *
 * Order matters: named header patterns are handled first, then literal secret
 * values, then URL userinfo.
 */
export function scrubText(text: string, secrets: (string | null | undefined)[] = []): string {
  let out = text;

  // Authorization: Bearer <token>  /  x-api-key: <token>
  out = out.replace(/(authorization\s*:\s*)(bearer\s+)?\S+/gi, `$1${REDACTED}`);
  out = out.replace(/(x-api-key\s*:\s*)\S+/gi, `$1${REDACTED}`);
  out = out.replace(/(api[-_]?key["'\s:=]+)\S+/gi, `$1${REDACTED}`);

  // Literal secret values, wherever they appear.
  for (const secret of secrets) {
    const value = secret?.trim();
    if (value && value.length >= MIN_SECRET_LENGTH) {
      out = out.split(value).join(REDACTED);
    }
  }

  // URL userinfo: https://user:pass@host/... → https://[redacted]@host/...
  out = out.replace(/(https?:\/\/)[^/\s@]+@/gi, `$1${REDACTED}@`);

  return out;
}

/**
 * A short, single-line, scrubbed excerpt of an upstream body.
 * Never returns more than `max` characters and never returns a newline run.
 */
export function safeExcerpt(text: string, secrets: (string | null | undefined)[] = [], max = 280): string {
  const flat = scrubText(text, secrets).replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}