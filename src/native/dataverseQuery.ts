import { callNative, QUERY_TIMEOUT_MS } from "./bridge";

/** Default row cap for a SELECT result across every query tool. Dataverse returns at most 5000
 *  rows per page; this pages past that up to the cap, then stops and flags the result truncated so
 *  the tool can tell the user there's more. Raise it (or pass 0 = no limit) per query. */
export const DEFAULT_QUERY_ROW_LIMIT = 10_000;

export interface PagedQueryOptions {
  /** Stop after this many rows. 0 = no limit (page until Dataverse runs out — can be slow/large). */
  maxRows: number;
  /** Adds the `Prefer: odata.include-annotations` header — FormattedValue labels for Lookup/
   *  OptionSet columns. Roughly triples the payload size for a lookup-heavy entity. */
  includeFormattedValues?: boolean;
  /** Aborts the in-flight page request (and stops paging) — wire to a "cancel query" button. */
  signal?: AbortSignal;
  /** Called after each page lands, with the running row total — for a "已加载 N 行" indicator. */
  onProgress?: (loaded: number) => void;
}

export interface PagedQueryResult {
  /** All rows across every page, concatenated. Still raw OData shape — caller unwraps. */
  value: Record<string, unknown>[];
  /** True when the run stopped short of everything Dataverse had — either `maxRows` was hit, or
   *  the payload-size ceiling below was (see `stoppedForSize`). */
  truncated: boolean;
  /** Set when the byte ceiling stopped it rather than `maxRows` — the caller shows a "rows are
   *  wide, SELECT fewer columns" hint instead of "raise the row limit". */
  stoppedForSize: boolean;
  /** Total pages fetched (1 for the common under-5000 case). */
  pages: number;
}

/** Rough cap on how much row data to pull into the tab regardless of the row limit — a
 *  `SELECT *` over a wide entity is ~4-5 KB/row, so an un-capped run of a 50k-row table is
 *  hundreds of MB of JS objects (plus the same again after unwrap + the grid's own copy). Past
 *  this the tab gets sluggish and the WebView message for each page gets unwieldy, so stop and
 *  tell the user to narrow the SELECT list. */
const MAX_RESULT_BYTES = 60_000_000;

/** Cheap byte estimate for a page of rows — `JSON.stringify` once (the raw text isn't available
 *  on this side, the bridge already parsed it) to learn the per-row weight, then extrapolate. */
function estimateBytesPerRow(rows: Record<string, unknown>[]): number {
  if (rows.length === 0) return 0;
  const sample = rows.slice(0, Math.min(rows.length, 200));
  return JSON.stringify(sample).length / sample.length;
}

interface RawPage {
  value: Record<string, unknown>[];
  "@odata.nextLink"?: string;
  "@Microsoft.Dynamics.CRM.fetchxmlpagingcookie"?: string;
  "@Microsoft.Dynamics.CRM.morerecords"?: boolean;
}

const FETCHXML_PARAM_RE = /([?&])fetchXml=/i;

/** Builds the next page's request path for a FetchXML query by decoding Dataverse's paging cookie
 *  annotation and splicing `page="N" paging-cookie="..."` into the `<fetch>` element. The cookie in
 *  the annotation is double-URL-encoded (confirmed against a live org); it decodes to a small XML
 *  `<cookie>…</cookie>` fragment that goes back in as an XML-attribute value. */
export function nextFetchXmlPath(initialPath: string, pagingCookieAnnotation: string, pageNumber: number): string {
  const cookieMatch = /pagingcookie="([^"]*)"/i.exec(pagingCookieAnnotation);
  let attrValue = "";
  if (cookieMatch) {
    const decoded = decodeURIComponent(decodeURIComponent(cookieMatch[1]));
    attrValue = decoded
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const paramMatch = FETCHXML_PARAM_RE.exec(initialPath);
  if (!paramMatch) return initialPath; // not actually a fetchXml path — shouldn't happen
  const splitAt = paramMatch.index + paramMatch[0].length;
  const prefix = initialPath.slice(0, splitAt);
  const xml = decodeURIComponent(initialPath.slice(splitAt));

  const pagedXml = xml
    .replace(/\s+page="[^"]*"/i, "")
    .replace(/\s+paging-cookie="[^"]*"/i, "")
    .replace(/^<fetch/i, `<fetch page="${pageNumber}" paging-cookie="${attrValue}"`);

  return prefix + encodeURIComponent(pagedXml);
}

/** Strips the `https://org.crm.dynamics.com/api/data/v9.x/` prefix off an `@odata.nextLink` so it
 *  can be handed back to `dataverse.request` (which builds the base URL itself). */
function nextLinkToPath(nextLink: string): string {
  return nextLink.replace(/^https?:\/\/[^/]+\/api\/data\/v[\d.]+\//i, "");
}

/** Runs a SELECT, following pagination (OData `@odata.nextLink` or FetchXML paging cookie) up to
 *  `maxRows`. Shared by every query tool (SQL4CDS / Data Migration / Data Copy / Data Edit /
 *  FetchXML Builder) so the timeout, row cap, cancellation and progress reporting all behave the
 *  same. `initialPath` is the request path a translated SELECT produces (an OData `entityset?$…`
 *  or an `entityset?fetchXml=…`). */
export async function runPagedQuery(
  connectionId: string,
  initialPath: string,
  opts: PagedQueryOptions,
): Promise<PagedQueryResult> {
  const { maxRows, includeFormattedValues, signal, onProgress } = opts;
  const isFetchXml = FETCHXML_PARAM_RE.test(initialPath);
  const all: Record<string, unknown>[] = [];
  let path: string | null = initialPath;
  let pageCount = 0;
  let truncated = false;
  let stoppedForSize = false;
  let bytesPerRow = 0;

  while (path) {
    pageCount += 1;
    const page = await callNative<RawPage>(
      "dataverse.request",
      { connectionId, method: "GET", path, includeFormattedValues: includeFormattedValues ?? false },
      { timeoutMs: QUERY_TIMEOUT_MS, signal },
    );

    const pageRows = page.value ?? [];
    all.push(...pageRows);
    onProgress?.(all.length);
    if (bytesPerRow === 0) bytesPerRow = estimateBytesPerRow(pageRows);

    const hasMore = isFetchXml
      ? page["@Microsoft.Dynamics.CRM.morerecords"] === true
      : typeof page["@odata.nextLink"] === "string";

    if (maxRows > 0 && all.length >= maxRows) {
      truncated = hasMore || all.length > maxRows;
      all.length = maxRows;
      break;
    }

    // Payload-size guard — independent of maxRows. Stop before the next page if the running total
    // plus another ~5000-row page would blow past the byte ceiling.
    if (hasMore && bytesPerRow > 0 && (all.length + 5000) * bytesPerRow > MAX_RESULT_BYTES) {
      truncated = true;
      stoppedForSize = true;
      break;
    }

    if (!hasMore) break;

    if (isFetchXml) {
      const cookie = page["@Microsoft.Dynamics.CRM.fetchxmlpagingcookie"];
      if (!cookie) break; // more records but no cookie — nothing to page with
      path = nextFetchXmlPath(initialPath, cookie, pageCount + 1);
    } else {
      path = nextLinkToPath(page["@odata.nextLink"] as string);
    }
  }

  return { value: all, truncated, stoppedForSize, pages: pageCount };
}

/** `Array.map`, but yields to the event loop every `chunkSize` items so a large result set
 *  (thousands of rows, each unwrapped + reshaped for the grid) doesn't freeze the tab in one
 *  synchronous burst right after the network wait. `onProgress` fires per chunk with the count
 *  done so far — feed it the same "已加载 N 行" indicator the paging used. */
export async function mapWithYield<T, R>(
  items: T[],
  fn: (item: T, index: number) => R,
  opts: { chunkSize?: number; onProgress?: (done: number) => void; signal?: AbortSignal } = {},
): Promise<R[]> {
  const chunkSize = opts.chunkSize ?? 2000;
  const out: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    out[i] = fn(items[i], i);
    if ((i + 1) % chunkSize === 0 && i + 1 < items.length) {
      if (opts.signal?.aborted) throw new DOMException("查询已取消", "AbortError");
      opts.onProgress?.(i + 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return out;
}
