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
