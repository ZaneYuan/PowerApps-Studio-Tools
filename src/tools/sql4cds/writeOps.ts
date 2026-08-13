import { callNative } from "../../native/bridge";
import { fetchAttributes, fetchEntityMeta, type ManyToManyInfo } from "../../native/metadataService";
import { buildLookupRelationshipMap } from "../../native/navProperty";

/** Now that Sql4Cds.tsx fires several row writes concurrently instead of one at a time (see
 *  concurrency.ts's runConcurrent), hitting Dataverse's service protection limit (HTTP 429) on an
 *  occasional request is an expected outcome, not a bug — retrying with backoff belongs here
 *  rather than in every caller, since it's a property of "writing one row", not of the loop that
 *  drives it. A 429 means the request was rejected *before* it took effect, so retrying never
 *  risks a duplicate write. DataverseApiClient.cs's error message is the literal string
 *  `Dataverse 请求失败 (429): ...` — that's the only signal available here (no structured status
 *  code or Retry-After header crosses the native bridge), so this uses a fixed exponential
 *  backoff instead of honoring a real Retry-After. */
async function withRetryOn429<T>(fn: () => Promise<T>): Promise<T> {
  const delaysMs = [1000, 2000, 4000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= delaysMs.length || !message.includes("请求失败 (429)")) throw err;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}

/** Builds one write payload from a plain column→value map, resolving Lookup-typed columns to
 *  `{navProp}@odata.bind` — same approach as data-migration's `importRow`
 *  (src/tools/data-migration/dataverseOps.ts), generalized to take an explicit value map instead
 *  of a queried source row, since SQL4CDS's columns come from the parsed INSERT/UPDATE statement.
 *  A Lookup column with zero or multiple relationship candidates (unresolvable/polymorphic, e.g.
 *  `customerid`) is rejected rather than silently written as a raw field, since Dataverse always
 *  400s on that — better to fail with a clear reason up front. */
export async function buildRowBody(
  connectionId: string,
  entityLogicalName: string,
  columnValues: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const [attrTypes, lookupMap] = await Promise.all([
    fetchAttributes(connectionId, entityLogicalName),
    buildLookupRelationshipMap(connectionId, entityLogicalName),
  ]);
  const typeByName = new Map(attrTypes.map((a) => [a.logicalName.toLowerCase(), a.attributeType]));

  const body: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(columnValues)) {
    const attrType = typeByName.get(col.toLowerCase());

    // T-SQL has no boolean literal distinct from BIT's 0/1, so a value written as bare 0/1
    // parses as a plain SQL number — literalToJsValue faithfully passes that through as a JS
    // number, which JSON-serializes as 1/0. Dataverse's actual Boolean (two-option) fields
    // reject that outright ("Cannot convert the literal '1' to the expected type
    // 'Edm.Boolean'"), confirmed against a live org — coerce to a real JSON boolean here instead.
    if (attrType === "Boolean") {
      if (value === null || value === undefined || typeof value === "boolean") {
        body[col] = value;
      } else if (typeof value === "number") {
        body[col] = value !== 0;
      } else {
        throw new Error(`字段 "${col}" 是布尔类型，请写 0/1（不要加引号）或 NULL，收到的值是: ${JSON.stringify(value)}`);
      }
      continue;
    }

    const isLookup = attrType === "Lookup";
    if (!isLookup) {
      body[col] = value;
      continue;
    }
    if (value === null || value === undefined) continue; // nothing to bind — omit rather than error
    const candidates = lookupMap.get(col.toLowerCase());
    if (!candidates || candidates.length !== 1) {
      throw new Error(`字段 "${col}" 是一个 Lookup，但无法唯一确定它指向哪个实体（可能是多态查找字段），暂不支持写入。`);
    }
    const targetMeta = await fetchEntityMeta(connectionId, candidates[0].ReferencedEntity);
    body[`${candidates[0].ReferencingEntityNavigationPropertyName}@odata.bind`] = `/${targetMeta.entitySetName}(${value})`;
  }
  return body;
}

/** Prefer: return=representation is already sent unconditionally by the C# layer
 *  (DataverseApiClient.cs), so the POST response already carries the created record — including
 *  its new id under `{entityLogicalName}id`, per Dataverse's standard primary-id-attribute naming
 *  convention (same guess used for COUNT(*) in translate.ts). Purely cosmetic if wrong (the
 *  insert still succeeds; only the displayed new-id is blank). */
export async function insertRow(
  connectionId: string,
  entityLogicalName: string,
  entitySetName: string,
  columnValues: Record<string, unknown>,
): Promise<{ newId: string | null }> {
  const body = await buildRowBody(connectionId, entityLogicalName, columnValues);
  const created = await withRetryOn429(() =>
    callNative<Record<string, unknown>>("dataverse.request", {
      connectionId,
      method: "POST",
      path: entitySetName,
      body,
    }),
  );
  const idField = `${entityLogicalName}id`;
  const newId = typeof created[idField] === "string" ? (created[idField] as string) : null;
  return { newId };
}

export async function updateRow(
  connectionId: string,
  entityLogicalName: string,
  entitySetName: string,
  id: string,
  columnValues: Record<string, unknown>,
): Promise<void> {
  const body = await buildRowBody(connectionId, entityLogicalName, columnValues);
  await withRetryOn429(() =>
    callNative("dataverse.request", {
      connectionId,
      method: "PATCH",
      path: `${entitySetName}(${id})`,
      body,
    }),
  );
}

export async function deleteRow(connectionId: string, entitySetName: string, id: string): Promise<void> {
  await withRetryOn429(() =>
    callNative("dataverse.request", {
      connectionId,
      method: "DELETE",
      path: `${entitySetName}(${id})`,
    }),
  );
}

/** Dataverse attribute logical names are conventionally all-lowercase with underscores, but a
 *  user writing INSERT/DELETE against an intersect entity by hand often uses a display-ish
 *  PascalCase name instead — normalize before comparing so "ProductId" still matches "productid".
 *  Deliberately doesn't try to guess across an actually-missing prefix (e.g. "PaymentFrequencyId"
 *  for the real "contoso_paymentfrequencyid" won't match) — resolveIntersectRowValues's error names
 *  the real attribute instead of silently associating the wrong pair. */
function normalizeColumnName(name: string): string {
  return name.toLowerCase().replace(/_/g, "");
}

export interface IntersectRowValues {
  entity1Value: string;
  entity2Value: string;
}

/** Resolves one row's column→value map (an INSERT VALUES row, or a DELETE's matched-record
 *  column values) to the two relationship-side values association/disassociation needs. Throws a
 *  clear, actionable error naming the real attribute names if a column doesn't match either side
 *  of the relationship — silently ignoring an unrecognized column would associate/disassociate
 *  the wrong pair instead of failing loudly. */
export function resolveIntersectRowValues(rel: ManyToManyInfo, columnValues: Record<string, unknown>): IntersectRowValues {
  const target1 = normalizeColumnName(rel.entity1IntersectAttribute);
  const target2 = normalizeColumnName(rel.entity2IntersectAttribute);
  let entity1Value: string | undefined;
  let entity2Value: string | undefined;

  for (const [col, value] of Object.entries(columnValues)) {
    const norm = normalizeColumnName(col);
    if (norm === target1) entity1Value = String(value);
    else if (norm === target2) entity2Value = String(value);
  }

  if (entity1Value === undefined || entity2Value === undefined) {
    throw new Error(
      `"${rel.intersectEntityName}" 是一个多对多关联表（${rel.entity1LogicalName} ↔ ${rel.entity2LogicalName}），` +
        `不是普通实体，只认这两个字段名：${rel.entity1IntersectAttribute}（对应 ${rel.entity1LogicalName} 的记录 id）、` +
        `${rel.entity2IntersectAttribute}（对应 ${rel.entity2LogicalName} 的记录 id），请照着这两个名字改列名。`,
    );
  }
  return { entity1Value, entity2Value };
}

/** Associates two records via the relationship's $ref endpoint — the only way to write to an
 *  intersect entity's Web API EntitySet (a plain POST 400s, see ManyToManyInfo's doc comment).
 *  `environmentUrl` (from ConnectionDto, already exposed to the JS side) is needed because
 *  `@odata.id` must be an absolute URL per Dataverse's Web API contract for association requests.
 *  Confirmed against contoso-dev: `contoso_paymentfrequency_product` (contoso_paymentfrequency ↔ product,
 *  via contoso_paymentfrequencyid/productid) associates correctly through this endpoint after the
 *  same INSERT that 400'd as a plain POST. */
export async function insertIntersectRow(
  connectionId: string,
  environmentUrl: string,
  rel: ManyToManyInfo,
  values: IntersectRowValues,
): Promise<void> {
  const [meta1, meta2] = await Promise.all([
    fetchEntityMeta(connectionId, rel.entity1LogicalName),
    fetchEntityMeta(connectionId, rel.entity2LogicalName),
  ]);
  await withRetryOn429(() =>
    callNative("dataverse.request", {
      connectionId,
      method: "POST",
      path: `${meta1.entitySetName}(${values.entity1Value})/${rel.entity1NavigationPropertyName}/$ref`,
      body: { "@odata.id": `${environmentUrl.replace(/\/$/, "")}/api/data/v9.2/${meta2.entitySetName}(${values.entity2Value})` },
    }),
  );
}

/** Disassociates two records — the DELETE counterpart of insertIntersectRow. No body/environmentUrl
 *  needed: the second record's id goes directly in the URL, per Dataverse's disassociate contract. */
export async function deleteIntersectRow(connectionId: string, rel: ManyToManyInfo, values: IntersectRowValues): Promise<void> {
  const meta1 = await fetchEntityMeta(connectionId, rel.entity1LogicalName);
  await withRetryOn429(() =>
    callNative("dataverse.request", {
      connectionId,
      method: "DELETE",
      path: `${meta1.entitySetName}(${values.entity1Value})/${rel.entity1NavigationPropertyName}(${values.entity2Value})/$ref`,
    }),
  );
}

export interface MatchingIds {
  /** Capped at 5000 — the actual set of ids UPDATE/DELETE will process this run. */
  ids: string[];
  /** The real total match count (via a separate $count=true&$top=1 call — never
   *  `/$count?$filter=`, per this project's documented OData conventions), which can be larger
   *  than `ids.length` when the WHERE clause matches more than the 5000-row execution cap. */
  totalCount: number;
}

/** Resolves which records an UPDATE/DELETE's WHERE clause matches — Dataverse's Web API has no
 *  bulk "UPDATE/DELETE ... WHERE" endpoint, so every mutate statement must first find the target
 *  ids and then write them one at a time (see updateRow/deleteRow). Capped at 5000 per run to
 *  bound a single execution. */
export async function queryMatchingIds(
  connectionId: string,
  entitySetName: string,
  primaryIdAttribute: string,
  filter: string,
): Promise<MatchingIds> {
  const [listRes, countRes] = await Promise.all([
    callNative<{ value: Record<string, unknown>[] }>("dataverse.request", {
      connectionId,
      method: "GET",
      path: `${entitySetName}?$select=${primaryIdAttribute}&$filter=${filter}&$top=5000`,
    }),
    callNative<{ "@odata.count"?: number }>("dataverse.request", {
      connectionId,
      method: "GET",
      path: `${entitySetName}?$filter=${filter}&$count=true&$top=1`,
    }),
  ]);
  const ids = listRes.value.map((r) => String(r[primaryIdAttribute]));
  return { ids, totalCount: countRes["@odata.count"] ?? ids.length };
}
