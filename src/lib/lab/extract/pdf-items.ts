// ── PDF text WITH GEOMETRY (SERVER ONLY) ─────────────────────────────────────
//
// The only place the application opens a PDF. It reads each page's text layer as
// positioned ITEMS — a string plus the rectangle it occupies in PDF user space —
// and nothing else: no canvas, no rendering, no images, no annotation.
//
// WHY GEOMETRY AT ALL. The lab's trend documents interleave values and flags in
// the text layer: a `MO%` row prints `12.1 %` on one line and
// `Normal Range: 5.0 - 12.0 %   High   9.3 %` on the next, and the A1C table puts
// two values on one line and their two `High` flags on the line below. Reading
// line by line mis-assigns those cells; reading the x position of every item is
// what makes the column assignment possible (see ./layout.ts).
//
// SERVER ONLY, BY CONSTRUCTION. `pdfjs-dist` is imported dynamically inside
// `readPdfItems`, so this module has no top-level dependency on it and cannot be
// pulled into a browser bundle by a stray static import; `next.config.js` lists
// it in `serverExternalPackages` so the standalone server resolves it at runtime
// instead of trying to bundle it. Nothing here returns the document's text as a
// blob a caller might store — only positioned items.

/** One positioned run of text on a page. Coordinates are PDF user space. */
export interface PdfTextItem {
  /** The run's text. Never redacted here; callers redact before storing. */
  str: string;
  /** Left edge, PDF user space (points, origin bottom-left). */
  x: number;
  /** Baseline y, PDF user space. Larger is higher up the page. */
  y: number;
  /** Rendered width in points. */
  width: number;
  /** Font size in points (0 for synthetic runs the reader emits). */
  height: number;
}

/** One page's positioned items, in the order the reader returned them. */
export interface PdfPage {
  /** 1-based page number. */
  page: number;
  /** Page width in points. */
  width: number;
  /** Page height in points. */
  height: number;
  items: PdfTextItem[];
}

/** A whole document's geometry, plus the date the file itself records. */
export interface PdfGeometry {
  pageCount: number;
  pages: PdfPage[];
  /**
   * The document's embedded creation date as an ISO date (YYYY-MM-DD), or null.
   * This is a metadata field OF THE FILE, not a result date: it says when the PDF
   * was produced. The date portion is taken exactly as printed (its own offset is
   * not converted), so a document created late at night does not land on a
   * different day.
   */
  creationDate: string | null;
}

/** The reader's item shape, narrowed to what this module reads. */
interface RawTextItem {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
}

/**
 * Read a PDF's text with geometry.
 *
 * `bytes` is the file's content. Nothing is written anywhere and nothing is
 * cached: the caller owns the bytes and gets only positioned items back.
 */
export async function readPdfItems(bytes: Uint8Array): Promise<PdfGeometry> {
  // The legacy build is the one that runs on plain Node without a DOM.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdfjs TRANSFERS the buffer it is given to its worker, which DETACHES the
  // caller's view: after the read, `bytes.byteLength` would be 0 and any later
  // hash or re-read of the same array would silently see an empty file. Hand it a
  // private copy so the caller's bytes stay exactly as they were.
  const data = Uint8Array.from(bytes);
  const loading = pdfjs.getDocument({
    data,
    // No worker fetch, no wasm, no font faces: this is a one-shot text read and
    // none of those are needed to hand back positioned strings.
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    disableFontFace: true,
    // Suppress the reader's own warnings (a missing standard-font file is
    // expected and harmless for a text-only read); real errors still throw.
    verbosity: 0,
  });
  const document = await loading.promise;

  try {
    const pages: PdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const raw of content.items as RawTextItem[]) {
        if (typeof raw.str !== 'string') continue;
        const transform = raw.transform;
        if (!Array.isArray(transform) || transform.length < 6) continue;
        const numbers = transform.filter((value): value is number => typeof value === 'number');
        if (numbers.length < 6) continue;
        items.push({
          str: raw.str,
          x: numbers[4],
          y: numbers[5],
          width: typeof raw.width === 'number' ? raw.width : 0,
          height: typeof raw.height === 'number' ? raw.height : 0,
        });
      }
      pages.push({ page: pageNumber, width: viewport.width, height: viewport.height, items });
    }

    return { pageCount: document.numPages, pages, creationDate: await readCreationDate(document) };
  } finally {
    // `destroy` lives on the loading task; it tears down the worker and any
    // in-flight reads. Failure here has nothing left to clean up.
    await loading.destroy().catch(() => {
      // Nothing useful to do: the pages are already read.
    });
  }
}

/** Read the file's own creation date, as an ISO date. Never throws. */
async function readCreationDate(document: { getMetadata: () => Promise<unknown> }): Promise<string | null> {
  try {
    const metadata = (await document.getMetadata()) as { info?: unknown } | null;
    const info = metadata?.info as Record<string, unknown> | undefined;
    const raw = info?.CreationDate;
    return typeof raw === 'string' ? parsePdfDate(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Parse a PDF date string — `D:YYYYMMDDHHmmSS` optionally followed by an offset —
 * into an ISO date. Returns null rather than guessing when the shape is unknown.
 */
export function parsePdfDate(raw: string): string | null {
  const match = /^D?:?(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day}`;
}