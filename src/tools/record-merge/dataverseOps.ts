import { callNative } from "../../native/bridge";
import { fetchEntityMeta, type ManyToManyInfo } from "../../native/metadataService";
import { getBindNavigationProperty } from "../../native/navProperty";
import { runConcurrent } from "../sql4cds/concurrency";
import { deleteIntersectRow, insertIntersectRow, withRetryOn429, type IntersectRowValues } from "../sql4cds/writeOps";
import { COUNT_CAP, type FailedRelationship, type ManyToManyRefTable, type MigrationLogEntry, type OneToManyRefTable, type RefTable } from "./types";

export interface ScanResult {
  tables: RefTable[];
  failedRelationships: FailedRelationship[];
}

const SCAN_CONCURRENCY = 8;
/** Matches the API version literal writeOps.ts's insertIntersectRow already hardcodes for
 *  building `@odata.id` — kept as the same literal rather than a shared constant, since neither
 *  file introduces an abstraction the other doesn't already forgo. */
const API_VERSION_SEGMENT = "/api/data/v9.2/";
/** Dataverse's default Web API page size — also the threshold `@odata.count` stops being
 *  trustworthy at (see countMatchingCapped's doc comment). */
const PAGE_SIZE = 5000;

async function fetchDataverse<T>(connectionId: string, path: string): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "GET", path });
}

/** A Lookup attribute's `$filter`/`$select` property name — Dataverse's OData model exposes some
 *  lookups (confirmed live: `transactioncurrencyid` on `account`) only as a
 *  navigation property under the bare logical name, so `$filter=transactioncurrencyid eq <guid>`
 *  400s with "A binary operator with incompatible types was detected. Found operand types
 *  'Microsoft.Dynamics.CRM.transactioncurrency' and 'Edm.Guid'" even though the identical bare-name
 *  filter works for other lookups. The `_name_value` form is the one Dataverse always exposes as a
 *  real scalar Guid property (also required for `$select` — bare name 400s there too, same as
 *  Record Explorer's `selectFieldFor`), so every lookup filter/select here goes through it instead
 *  of relying on the bare name sometimes happening to work. */
function lookupValueKey(attr: string): string {
  return `_${attr}_value`;
}

export interface RecordLookup {
  exists: boolean;
  primaryName: string | null;
}

/** Looks up one record by id against `entityLogicalName`'s own entity set — used both to locate
 *  the target record and to validate the user-entered replacement id. Querying the *same*
 *  entity's set for both naturally enforces "same table" (Dataverse lookups are typed to one
 *  target entity per relationship, so a replacement from a different table would 400 on every
 *  migrated row anyway — better to reject it here with a clear reason). */
export async function lookupRecord(connectionId: string, entityLogicalName: string, id: string): Promise<RecordLookup> {
  const meta = await fetchEntityMeta(connectionId, entityLogicalName);
  try {
    const raw = await fetchDataverse<Record<string, unknown>>(
      connectionId,
      `${meta.entitySetName}(${id})?$select=${meta.primaryIdAttribute},${meta.primaryNameAttribute}`,
    );
    const name = raw[meta.primaryNameAttribute];
    return { exists: true, primaryName: typeof name === "string" && name.trim() ? name.trim() : null };
  } catch {
    return { exists: false, primaryName: null };
  }
}

interface CountOutcome {
  count: number;
  exceedsCap: boolean;
}

/** `@odata.count` is only a real total below one page's worth of matching rows — confirmed live
 *  (two unrelated tables both reported exactly 5000 against a currency record that clearly has
 *  more real references than that): once the true count reaches the page size, Dataverse stops
 *  counting and just reports the page size itself instead of the real total. Below that threshold
 *  the cheap `$count=true&$top=1` call is trusted as-is; at/above it, this pages through
 *  `$select=<primary key>` results instead and counts real rows, stopping at `COUNT_CAP` — a
 *  reference-count display doesn't need to page through an unbounded number of rows just to prove
 *  the real number is bigger than anyone needs to see. */
async function countMatchingCapped(
  connectionId: string,
  entitySetName: string,
  primaryIdAttribute: string,
  filter: string,
): Promise<CountOutcome> {
  const initial = await fetchDataverse<{ "@odata.count"?: number }>(connectionId, `${entitySetName}?$filter=${filter}&$count=true&$top=1`);
  // Some tables (SharePoint-integration ones observed live) report a negative sentinel instead of
  // throwing, e.g. when the feature the table backs is disabled org-wide — never meaningful as a
  // reference count regardless of the reason, so clamp rather than surface "-1 条引用".
  const reported = Math.max(0, initial["@odata.count"] ?? 0);
  if (reported < PAGE_SIZE) return { count: reported, exceedsCap: false };

  let counted = 0;
  let path: string | null = `${entitySetName}?$select=${primaryIdAttribute}&$filter=${filter}&$top=${PAGE_SIZE}`;
  while (path) {
    const res: { value: unknown[]; "@odata.nextLink"?: string } = await fetchDataverse(connectionId, path);
    counted += res.value.length;
    if (counted >= COUNT_CAP) return { count: COUNT_CAP, exceedsCap: true };
    const next = res["@odata.nextLink"];
    const idx = next ? next.indexOf(API_VERSION_SEGMENT) : -1;
    path = idx >= 0 ? next!.slice(idx + API_VERSION_SEGMENT.length) : null;
  }
  return { count: counted, exceedsCap: false };
}

interface OneToManyRelRaw {
  SchemaName: string;
  ReferencingEntity: string;
  ReferencingAttribute: string;
}

interface ManyToManyRelRaw {
  SchemaName: string;
  IntersectEntityName: string;
  Entity1LogicalName: string;
  Entity1IntersectAttribute: string;
  Entity1NavigationPropertyName: string;
  Entity2LogicalName: string;
  Entity2IntersectAttribute: string;
  Entity2NavigationPropertyName: string;
}

/** Scans every 1:N and N:N relationship this entity participates in (system tables included —
 *  unlike Record Explorer's browsing view, a reference-migration tool needs to be complete, not
 *  just readable) and returns one `RefTable` per relationship/side that actually has at least one
 *  matching row. A relationship whose $filter/$count call errors (a handful of system
 *  relationships have quirky Web API support) is skipped rather than failing the whole scan. */
export async function scanReferences(connectionId: string, entityLogicalName: string, id: string): Promise<ScanResult> {
  const failedRelationships: FailedRelationship[] = [];
  const [oneToMany, manyToMany] = await Promise.all([
    fetchDataverse<{ value: OneToManyRelRaw[] }>(
      connectionId,
      `EntityDefinitions(LogicalName='${entityLogicalName}')/OneToManyRelationships?$select=SchemaName,ReferencingEntity,ReferencingAttribute`,
    ),
    fetchDataverse<{ value: ManyToManyRelRaw[] }>(
      connectionId,
      `EntityDefinitions(LogicalName='${entityLogicalName}')/ManyToManyRelationships` +
        "?$select=SchemaName,IntersectEntityName,Entity1LogicalName,Entity1IntersectAttribute,Entity1NavigationPropertyName,Entity2LogicalName,Entity2IntersectAttribute,Entity2NavigationPropertyName",
    ),
  ]);

  const jobs: (() => Promise<RefTable | null>)[] = [];

  for (const rel of oneToMany.value) {
    jobs.push(async () => {
      try {
        const childMeta = await fetchEntityMeta(connectionId, rel.ReferencingEntity);
        const { count, exceedsCap } = await countMatchingCapped(
          connectionId,
          childMeta.entitySetName,
          childMeta.primaryIdAttribute,
          `${lookupValueKey(rel.ReferencingAttribute)} eq ${id}`,
        );
        if (count === 0) return null;
        const table: OneToManyRefTable = {
          kind: "onetomany",
          relationshipSchemaName: rel.SchemaName,
          entityLogicalName: rel.ReferencingEntity,
          referencingAttribute: rel.ReferencingAttribute,
          count,
          exceedsCap,
        };
        return table;
      } catch (err) {
        failedRelationships.push({ relationship: rel.SchemaName, error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    });
  }

  for (const rel of manyToMany.value) {
    const info: ManyToManyInfo = {
      intersectEntityName: rel.IntersectEntityName,
      entity1LogicalName: rel.Entity1LogicalName,
      entity1IntersectAttribute: rel.Entity1IntersectAttribute,
      entity1NavigationPropertyName: rel.Entity1NavigationPropertyName,
      entity2LogicalName: rel.Entity2LogicalName,
      entity2IntersectAttribute: rel.Entity2IntersectAttribute,
      entity2NavigationPropertyName: rel.Entity2NavigationPropertyName,
    };
    const sides: { side: "entity1" | "entity2"; thisAttr: string; otherEntity: string }[] = [];
    if (rel.Entity1LogicalName.toLowerCase() === entityLogicalName.toLowerCase()) {
      sides.push({ side: "entity1", thisAttr: rel.Entity1IntersectAttribute, otherEntity: rel.Entity2LogicalName });
    }
    if (rel.Entity2LogicalName.toLowerCase() === entityLogicalName.toLowerCase()) {
      sides.push({ side: "entity2", thisAttr: rel.Entity2IntersectAttribute, otherEntity: rel.Entity1LogicalName });
    }
    for (const s of sides) {
      jobs.push(async () => {
        try {
          const intersectMeta = await fetchEntityMeta(connectionId, rel.IntersectEntityName);
          const { count, exceedsCap } = await countMatchingCapped(
            connectionId,
            intersectMeta.entitySetName,
            intersectMeta.primaryIdAttribute,
            `${lookupValueKey(s.thisAttr)} eq ${id}`,
          );
          if (count === 0) return null;
          const table: ManyToManyRefTable = {
            kind: "manytomany",
            relationshipSchemaName: rel.SchemaName,
            intersectEntityName: rel.IntersectEntityName,
            otherEntityLogicalName: s.otherEntity,
            count,
            exceedsCap,
            info,
            side: s.side,
          };
          return table;
        } catch (err) {
          failedRelationships.push({ relationship: `${rel.SchemaName} (${s.side})`, error: err instanceof Error ? err.message : String(err) });
          return null;
        }
      });
    }
  }

  const results: (RefTable | null)[] = new Array(jobs.length).fill(null);
  await runConcurrent(
    jobs,
    SCAN_CONCURRENCY,
    async (job, i) => {
      results[i] = await job();
    },
    () => false,
  );
  return { tables: results.filter((r): r is RefTable => r !== null), failedRelationships };
}

/** Follows `@odata.nextLink` to collect every matching row past Dataverse's default page size —
 *  a busy parent (a country, a currency, a default price list…) can easily have more referencing
 *  rows than one page, and migration has to be complete, not just cover the first page. */
async function fetchAllRows(
  connectionId: string,
  entitySetName: string,
  select: string,
  filter: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let path: string | null = `${entitySetName}?$select=${select}&$filter=${filter}`;
  while (path) {
    const res: { value: Record<string, unknown>[]; "@odata.nextLink"?: string } = await fetchDataverse(connectionId, path);
    out.push(...res.value);
    const next = res["@odata.nextLink"];
    const idx = next ? next.indexOf(API_VERSION_SEGMENT) : -1;
    path = idx >= 0 ? next!.slice(idx + API_VERSION_SEGMENT.length) : null;
  }
  return out;
}

async function migrateOneToManyTable(
  connectionId: string,
  entityLogicalName: string,
  targetEntitySetName: string,
  oldId: string,
  newId: string,
  table: OneToManyRefTable,
  concurrency: number,
  onEntry: (entry: MigrationLogEntry) => void,
  shouldStop: () => boolean,
): Promise<void> {
  const [childMeta, navProp] = await Promise.all([
    fetchEntityMeta(connectionId, table.entityLogicalName),
    // The specific relationship this table came from already tells us which target entity a
    // polymorphic referencing attribute (e.g. regardingobjectid) resolves to here — passing it
    // disambiguates in a way buildRowBody's generic single-candidate check can't.
    getBindNavigationProperty(connectionId, table.entityLogicalName, table.referencingAttribute, entityLogicalName),
  ]);
  const rows = await fetchAllRows(
    connectionId,
    childMeta.entitySetName,
    childMeta.primaryIdAttribute,
    `${lookupValueKey(table.referencingAttribute)} eq ${oldId}`,
  );
  const ids = rows.map((r) => String(r[childMeta.primaryIdAttribute]));

  await runConcurrent(
    ids,
    concurrency,
    async (childId) => {
      try {
        await withRetryOn429(() =>
          callNative("dataverse.request", {
            connectionId,
            method: "PATCH",
            path: `${childMeta.entitySetName}(${childId})`,
            body: { [`${navProp}@odata.bind`]: `/${targetEntitySetName}(${newId})` },
          }),
        );
        onEntry({ table: table.entityLogicalName, key: childId, action: "更新查找字段", state: "success" });
      } catch (err) {
        onEntry({ table: table.entityLogicalName, key: childId, action: "更新查找字段", state: "error", error: err instanceof Error ? err.message : String(err) });
      }
    },
    shouldStop,
  );
}

async function migrateManyToManyTable(
  connectionId: string,
  environmentUrl: string,
  oldId: string,
  newId: string,
  table: ManyToManyRefTable,
  concurrency: number,
  onEntry: (entry: MigrationLogEntry) => void,
  shouldStop: () => boolean,
): Promise<void> {
  const intersectMeta = await fetchEntityMeta(connectionId, table.intersectEntityName);
  const thisAttr = table.side === "entity1" ? table.info.entity1IntersectAttribute : table.info.entity2IntersectAttribute;
  const otherAttr = table.side === "entity1" ? table.info.entity2IntersectAttribute : table.info.entity1IntersectAttribute;

  const otherAttrKey = lookupValueKey(otherAttr);
  const [oldRows, newRows] = await Promise.all([
    fetchAllRows(connectionId, intersectMeta.entitySetName, otherAttrKey, `${lookupValueKey(thisAttr)} eq ${oldId}`),
    fetchAllRows(connectionId, intersectMeta.entitySetName, otherAttrKey, `${lookupValueKey(thisAttr)} eq ${newId}`),
  ]);
  const otherIdsForOld = oldRows.map((r) => String(r[otherAttrKey]));
  // Records already associated with the new target must not be re-associated — Dataverse 400s on
  // a duplicate (entity1, entity2) pair, and this is a real scenario, not just a theoretical edge
  // case, whenever the old and new target already share a common related record.
  const alreadyOnNew = new Set(newRows.map((r) => String(r[otherAttrKey])));

  function values(thisValue: string, otherId: string): IntersectRowValues {
    return table.side === "entity1" ? { entity1Value: thisValue, entity2Value: otherId } : { entity1Value: otherId, entity2Value: thisValue };
  }

  await runConcurrent(
    otherIdsForOld,
    concurrency,
    async (otherId) => {
      const alreadyAssociated = alreadyOnNew.has(otherId);
      try {
        if (!alreadyAssociated) {
          await insertIntersectRow(connectionId, environmentUrl, table.info, values(newId, otherId));
        }
        await deleteIntersectRow(connectionId, table.info, values(oldId, otherId));
        onEntry({
          table: table.otherEntityLogicalName,
          key: otherId,
          action: alreadyAssociated ? "取消旧关联（新关联已存在）" : "新增新关联 + 取消旧关联",
          state: "success",
        });
      } catch (err) {
        onEntry({
          table: table.otherEntityLogicalName,
          key: otherId,
          action: "重新关联",
          state: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    shouldStop,
  );
}

/** Migrates every referencing/associated record found by `scanReferences` from `oldId` to
 *  `newId`, table by table (each table's own rows run up to `concurrency` at a time). Continues
 *  past a per-row failure — logged as an error entry rather than aborting the run — since a
 *  handful of rows failing on a permission or business-rule error shouldn't block the rest from
 *  migrating. */
export async function migrateReferences(
  connectionId: string,
  environmentUrl: string,
  entityLogicalName: string,
  targetEntitySetName: string,
  oldId: string,
  newId: string,
  tables: RefTable[],
  concurrency: number,
  onEntry: (entry: MigrationLogEntry) => void,
  shouldStop: () => boolean,
): Promise<void> {
  for (const table of tables) {
    if (shouldStop()) return;
    if (table.kind === "onetomany") {
      await migrateOneToManyTable(connectionId, entityLogicalName, targetEntitySetName, oldId, newId, table, concurrency, onEntry, shouldStop);
    } else {
      await migrateManyToManyTable(connectionId, environmentUrl, oldId, newId, table, concurrency, onEntry, shouldStop);
    }
  }
}
