import type { ManyToManyInfo } from "../../native/metadataService";

export interface OneToManyRefTable {
  kind: "onetomany";
  relationshipSchemaName: string;
  /** The child (referencing) table. */
  entityLogicalName: string;
  referencingAttribute: string;
  count: number;
}

export interface ManyToManyRefTable {
  kind: "manytomany";
  relationshipSchemaName: string;
  intersectEntityName: string;
  /** The table on the other side of the association (not the scanned record's own table). */
  otherEntityLogicalName: string;
  count: number;
  info: ManyToManyInfo;
  /** Which side of `info` the scanned record sits on. A self-referencing N:N relationship
   *  produces two `ManyToManyRefTable` entries — one per side — since the record can appear in
   *  either intersect-attribute slot. */
  side: "entity1" | "entity2";
}

export type RefTable = OneToManyRefTable | ManyToManyRefTable;

export interface ReferenceScanResult {
  entityLogicalName: string;
  id: string;
  primaryName: string | null;
  tables: RefTable[];
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

export function totalReferenceCount(tables: RefTable[]): number {
  return tables.reduce((sum, t) => sum + t.count, 0);
}
