import type { ManyToManyInfo } from "../../native/metadataService";

/** Cap countMatchingCapped pages up to — see its doc comment for why an exact count isn't always
 *  obtainable/worth obtaining. */
export const COUNT_CAP = 100000;

export interface OneToManyRefTable {
  kind: "onetomany";
  relationshipSchemaName: string;
  /** The child (referencing) table. */
  entityLogicalName: string;
  referencingAttribute: string;
  count: number;
  /** True if `count` is `COUNT_CAP` itself because the real count is at least that many —
   *  scanning stopped at the cap rather than paging through an unbounded number of rows just to
   *  report an exact figure nobody needs. */
  exceedsCap: boolean;
}

export interface ManyToManyRefTable {
  kind: "manytomany";
  relationshipSchemaName: string;
  intersectEntityName: string;
  /** The table on the other side of the association (not the scanned record's own table). */
  otherEntityLogicalName: string;
  count: number;
  exceedsCap: boolean;
  info: ManyToManyInfo;
  /** Which side of `info` the scanned record sits on. A self-referencing N:N relationship
   *  produces two `ManyToManyRefTable` entries — one per side — since the record can appear in
   *  either intersect-attribute slot. */
  side: "entity1" | "entity2";
}

export type RefTable = OneToManyRefTable | ManyToManyRefTable;

export interface FailedRelationship {
  relationship: string;
  error: string;
}

export interface ReferenceScanResult {
  entityLogicalName: string;
  id: string;
  primaryName: string | null;
  tables: RefTable[];
  /** Relationships whose count query errored and were skipped, with the actual error message —
   *  surfaced to the user instead of silently folding into "0 references", since a real
   *  environment bug (a filter/select form Dataverse rejects for a specific lookup) looks
   *  identical to "genuinely no references" unless something says otherwise, and the message
   *  itself is what lets the user (or a future fix) tell which case it is. */
  failedRelationships: FailedRelationship[];
}

/** One referencing/associated record, formatted for read-only display — `values` is keyed by the
 *  same field name that appears in `RefTableRecordsResult.columns` (the target entity's default
 *  view, in that view's own order), each already rendered "label (raw)" style the same way
 *  Record Explorer used to. */
export interface RefTableRecord {
  id: string;
  primaryName: string;
  values: Record<string, string>;
}

export interface RefTableRecordsResult {
  /** The target entity's default view field order — falls back to just the primary id/name
   *  attributes if the entity has no default view layout to read (rare, but not impossible). */
  columns: string[];
  rows: RefTableRecord[];
  /** True when there were more matching records than REF_RECORD_ROW_LIMIT (dataverseOps.ts) —
   *  same "show the first N, say so" approach as the reference-count scan itself, not a real
   *  pagination UI, since this is a quick look at the data, not the migration path itself. */
  truncated: boolean;
}

export interface MigrationLogEntry {
  /** Display table: the referencing entity for 1:N, the other-side entity for N:N. */
  table: string;
  /** The referencing record's id for 1:N, the other-side record's id for N:N. */
  key: string;
  action: string;
  state: "success" | "error";
  error?: string;
}

/** Sum of every table's count, plus whether any table hit `COUNT_CAP` — callers that display the
 *  total need to know it's a lower bound (e.g. "≥ N") rather than an exact figure in that case. */
export function totalReferenceCount(tables: RefTable[]): { count: number; exceedsCap: boolean } {
  return {
    count: tables.reduce((sum, t) => sum + t.count, 0),
    exceedsCap: tables.some((t) => t.exceedsCap),
  };
}

/** Parses a pasted Dynamics 365 record URL's `etn`/`id` query params. Returns null for anything
 *  that isn't a recognizable record URL (e.g. a bare GUID) — callers fall back to the manually
 *  entered entity name field in that case. */
export function parseRecordUrl(input: string): { entityLogicalName: string; id: string } | null {
  const etnMatch = input.match(/[?&]etn=([a-zA-Z_][a-zA-Z0-9_]*)/);
  const idMatch = input.match(/[?&]id=(\{?[0-9a-fA-F-]{36}\}?)/) ?? input.match(/([0-9a-fA-F-]{36})/);
  if (!etnMatch || !idMatch) return null;
  return { entityLogicalName: etnMatch[1], id: idMatch[1].replace(/[{}]/g, "") };
}

const GUID_RE = /^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$/;

export function extractGuid(input: string): string | null {
  const trimmed = input.trim();
  if (GUID_RE.test(trimmed)) return trimmed.replace(/[{}]/g, "");
  const match = trimmed.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
  return match ? match[1] : null;
}
