// @vitest-environment jsdom
//
// Real-Dataverse integration test for FetchXML Builder — this tool had zero dedicated tests
// before this file. serialize.ts's XML shape is now exhaustively unit-tested (serialize.test.ts),
// but that only proves the generated text is well-formed; it never proved the generated FetchXML
// is *semantically correct* against a real FetchXML endpoint. This file builds real FetchXmlQuery
// objects, serializes them with the real serializeFetchXml, and executes them the exact way
// FetchXmlBuilder.tsx's own handleRun does — `GET <entitySet>?fetchXml=<encoded xml>` — against a
// throwaway Parent/Child schema with controlled rows, covering every condition-operator category,
// order+top, distinct-vs-fan-out, and both inner and outer link-entity (including a link's own
// nested filter acting as a semi-join, and an outer link's aliased attribute appearing/nulling out).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { createColumn, createLookupColumn, createTable } from "../solution-editor/dataverseOps";
import { insertRow } from "../sql4cds/writeOps";
import { fetchEntityMeta } from "../../native/metadataService";
import { unwrapODataRow } from "../../native/odata";
import { serializeFetchXml } from "./serialize";
import { newCondition, newFilterGroup, newLinkEntity, newOrderClause, newQuery, type FetchXmlQuery, type LinkEntity } from "./types";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";

async function runFetchXml(entitySet: string, query: FetchXmlQuery): Promise<Record<string, unknown>[]> {
  const { xml, error } = serializeFetchXml(query);
  expect(error, "serializeFetchXml unexpectedly failed").toBeNull();
  const res = await dataverseTestRequest<{ value: Record<string, unknown>[] }>(
    "GET",
    `${entitySet}?fetchXml=${encodeURIComponent(xml!)}`,
  );
  return res.body.value.map(unwrapODataRow);
}

describe.skipIf(!hasTestCredentials())("FetchXML Builder — real Dataverse execution (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const parentSchema = `${PUBLISHER_PREFIX}_FetchXmlParent${suffix}`;
  const parentLogical = parentSchema.toLowerCase();
  const childSchema = `${PUBLISHER_PREFIX}_FetchXmlChild${suffix}`;
  const childLogical = childSchema.toLowerCase();
  const nameField = `${PUBLISHER_PREFIX}_name`;
  const scoreField = `${PUBLISHER_PREFIX}_score${suffix}`.toLowerCase();
  const childLookupField = `${PUBLISHER_PREFIX}_parentlookup${suffix}`.toLowerCase();

  let parentEntitySet = "";
  let childEntitySet = "";
  let parentIdAttr = "";
  let p1 = "", p2 = "";

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: parentSchema,
      displayName: `FetchXml Parent ${suffix}`,
      displayCollectionName: `FetchXml Parents ${suffix}`,
      description: "自动化集成测试用表（FetchXML Builder 穷尽测试 · Parent），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: nameField,
      primaryFieldDisplayName: "Name",
    });
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: childSchema,
      displayName: `FetchXml Child ${suffix}`,
      displayCollectionName: `FetchXml Children ${suffix}`,
      description: "自动化集成测试用表（FetchXML Builder 穷尽测试 · Child），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: nameField,
      primaryFieldDisplayName: "Name",
    });
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, parentLogical, "Integer", {
      schemaName: `${PUBLISHER_PREFIX}_Score${suffix}`,
      displayName: "Score",
      description: "",
      required: false,
    });
    await createLookupColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: `${PUBLISHER_PREFIX}_ParentLookup${suffix}`,
      displayName: "Parent Lookup",
      description: "",
      required: false,
      referencedEntity: parentLogical,
      referencingEntity: childLogical,
      relationshipSchemaName: `${PUBLISHER_PREFIX}_fxparent_fxchild_${suffix}`,
    });

    const [parentMeta, childMeta] = await Promise.all([
      fetchEntityMeta(FAKE_CONNECTION_ID, parentLogical),
      fetchEntityMeta(FAKE_CONNECTION_ID, childLogical),
    ]);
    parentEntitySet = parentMeta.entitySetName;
    childEntitySet = childMeta.entitySetName;
    parentIdAttr = parentMeta.primaryIdAttribute;

    const [r1, r2] = await Promise.all([
      insertRow(FAKE_CONNECTION_ID, parentLogical, parentEntitySet, { [nameField]: `Parent1${suffix}`, [scoreField]: 10 }),
      insertRow(FAKE_CONNECTION_ID, parentLogical, parentEntitySet, { [nameField]: `Parent2${suffix}`, [scoreField]: 20 }),
      insertRow(FAKE_CONNECTION_ID, parentLogical, parentEntitySet, { [nameField]: `Parent3${suffix}` }), // score left null; its own id is never referenced directly
    ]);
    p1 = r1.newId!;
    p2 = r2.newId!;

    // Parent1 gets two children (fan-out target for distinct); Parent2 gets one; Parent3 gets none.
    await Promise.all([
      insertRow(FAKE_CONNECTION_ID, childLogical, childEntitySet, { [nameField]: `Child1${suffix}`, [childLookupField]: p1 }),
      insertRow(FAKE_CONNECTION_ID, childLogical, childEntitySet, { [nameField]: `Child2${suffix}`, [childLookupField]: p1 }),
      insertRow(FAKE_CONNECTION_ID, childLogical, childEntitySet, { [nameField]: `Child3${suffix}`, [childLookupField]: p2 }),
    ]);
  }, 180_000);

  afterAll(async () => {
    for (const logical of [childLogical, parentLogical]) {
      try {
        await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${logical}')`);
      } catch (err) {
        console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${logical}）：${err instanceof Error ? err.message : err}`);
      }
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("explicit attribute list + eq condition returns exactly the one matching real row", async () => {
    const query: FetchXmlQuery = {
      ...newQuery(),
      entityName: parentLogical,
      attributes: nameField,
      filter: { ...newFilterGroup(), conditions: [{ ...newCondition(), attribute: nameField, operator: "eq", value: `Parent1${suffix}` }] },
    };
    const rows = await runFetchXml(parentEntitySet, query);
    expect(rows).toHaveLength(1);
    expect(rows[0][nameField]).toBe(`Parent1${suffix}`);
  }, 30_000);

  it("gt/lt-style comparison operators (ge/le) filter real numeric rows correctly", async () => {
    const geQuery: FetchXmlQuery = {
      ...newQuery(),
      entityName: parentLogical,
      attributes: `${nameField},${scoreField}`,
      filter: { ...newFilterGroup(), conditions: [{ ...newCondition(), attribute: scoreField, operator: "ge", value: "20" }] },
    };
    const geRows = await runFetchXml(parentEntitySet, geQuery);
    expect(new Set(geRows.map((r) => r[nameField]))).toEqual(new Set([`Parent2${suffix}`]));

    const leQuery: FetchXmlQuery = { ...geQuery, filter: { ...newFilterGroup(), conditions: [{ ...newCondition(), attribute: scoreField, operator: "le", value: "10" }] } };
    const leRows = await runFetchXml(parentEntitySet, leQuery);
    expect(new Set(leRows.map((r) => r[nameField]))).toEqual(new Set([`Parent1${suffix}`]));
  }, 30_000);

  it("the multi-value 'in' operator matches a real comma-separated set", async () => {
    const query: FetchXmlQuery = {
      ...newQuery(),
      entityName: parentLogical,
      attributes: nameField,
      filter: {
        ...newFilterGroup(),
        conditions: [{ ...newCondition(), attribute: nameField, operator: "in", value: `Parent1${suffix},Parent3${suffix}` }],
      },
    };
    const rows = await runFetchXml(parentEntitySet, query);
    expect(new Set(rows.map((r) => r[nameField]))).toEqual(new Set([`Parent1${suffix}`, `Parent3${suffix}`]));
  }, 30_000);

  it("the valueless 'null'/'not-null' operators correctly distinguish the one real row with an unset field", async () => {
    const nullQuery: FetchXmlQuery = {
      ...newQuery(),
      entityName: parentLogical,
      attributes: nameField,
      filter: {
        ...newFilterGroup(),
        conditions: [
          { ...newCondition(), attribute: scoreField, operator: "null", value: "" },
          { ...newCondition(), attribute: nameField, operator: "like", value: `%${suffix}` }, // scope to this run's own rows only
        ],
      },
    };
    const nullRows = await runFetchXml(parentEntitySet, nullQuery);
    expect(new Set(nullRows.map((r) => r[nameField]))).toEqual(new Set([`Parent3${suffix}`]));

    const notNullQuery: FetchXmlQuery = {
      ...nullQuery,
      filter: {
        ...newFilterGroup(),
        conditions: [
          { ...newCondition(), attribute: scoreField, operator: "not-null", value: "" },
          { ...newCondition(), attribute: nameField, operator: "like", value: `%${suffix}` },
        ],
      },
    };
    const notNullRows = await runFetchXml(parentEntitySet, notNullQuery);
    expect(new Set(notNullRows.map((r) => r[nameField]))).toEqual(new Set([`Parent1${suffix}`, `Parent2${suffix}`]));
  }, 30_000);

  it("order + top together return exactly the real highest-scoring row", async () => {
    const query: FetchXmlQuery = {
      ...newQuery(),
      entityName: parentLogical,
      attributes: `${nameField},${scoreField}`,
      filter: { ...newFilterGroup(), conditions: [{ ...newCondition(), attribute: nameField, operator: "like", value: `%${suffix}` }] },
      orders: [{ ...newOrderClause(), attribute: scoreField, descending: true }],
      top: "1",
    };
    const rows = await runFetchXml(parentEntitySet, query);
    expect(rows).toHaveLength(1);
    expect(rows[0][nameField]).toBe(`Parent2${suffix}`); // score 20, the real max among this run's rows
  }, 30_000);

  it("an inner link-entity with no output attributes fans a parent row out once per matching child — real join behavior, not a guess", async () => {
    const link = {
      ...newLinkEntity(),
      name: childLogical,
      from: childLookupField,
      to: parentIdAttr,
    };
    const query: FetchXmlQuery = {
      ...newQuery(),
      entityName: parentLogical,
      attributes: nameField,
      filter: { ...newFilterGroup(), conditions: [{ ...newCondition(), attribute: nameField, operator: "eq", value: `Parent1${suffix}` }] },
      links: [link],
    };
    const rows = await runFetchXml(parentEntitySet, query);
    // Parent1 has exactly two real children -> the join produces exactly two real result rows.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r[nameField] === `Parent1${suffix}`)).toBe(true);
  }, 30_000);

  it("distinct=true collapses the real join fan-out back down to one row per parent", async () => {
    const link = { ...newLinkEntity(), name: childLogical, from: childLookupField, to: parentIdAttr };
    const query: FetchXmlQuery = {
      ...newQuery(),
      entityName: parentLogical,
      attributes: nameField,
      distinct: true,
      filter: { ...newFilterGroup(), conditions: [{ ...newCondition(), attribute: nameField, operator: "eq", value: `Parent1${suffix}` }] },
      links: [link],
    };
    const rows = await runFetchXml(parentEntitySet, query);
    expect(rows).toHaveLength(1);
  }, 30_000);

  it("a link-entity's own nested filter acts as a real semi-join, narrowing the parent results by a child field", async () => {
    const link: LinkEntity = {
      ...newLinkEntity(),
      name: childLogical,
      from: childLookupField,
      to: parentIdAttr,
      filter: { ...newFilterGroup(), conditions: [{ ...newCondition(), attribute: nameField, operator: "eq", value: `Child3${suffix}` }] },
    };
    const query: FetchXmlQuery = {
      ...newQuery(),
      entityName: parentLogical,
      attributes: nameField,
      filter: { ...newFilterGroup(), conditions: [{ ...newCondition(), attribute: nameField, operator: "like", value: `%${suffix}` }] },
      links: [link],
    };
    const rows = await runFetchXml(parentEntitySet, query);
    // Only Parent2 has a child named Child3 — Parent1 (different children) and Parent3 (no
    // children) are both real-API-confirmed excluded by the link's own filter.
    expect(rows.map((r) => r[nameField])).toEqual([`Parent2${suffix}`]);
  }, 30_000);

  it("an outer link-entity's aliased attribute appears for a matching row and is real-API-absent (not just falsy) for a childless one", async () => {
    const link: LinkEntity = {
      ...newLinkEntity(),
      name: childLogical,
      from: childLookupField,
      to: parentIdAttr,
      alias: "c",
      linkType: "outer" as const,
      attributes: nameField,
    };
    const query: FetchXmlQuery = {
      ...newQuery(),
      entityName: parentLogical,
      attributes: nameField,
      distinct: true,
      filter: { ...newFilterGroup(), conditions: [{ ...newCondition(), attribute: nameField, operator: "in", value: `Parent2${suffix},Parent3${suffix}` }] },
      links: [link],
    };
    const rows = await runFetchXml(parentEntitySet, query);
    const parent2Row = rows.find((r) => r[nameField] === `Parent2${suffix}`)!;
    const parent3Row = rows.find((r) => r[nameField] === `Parent3${suffix}`)!;
    expect(parent2Row, "Parent2 should survive the outer join with its child attribute present").toBeDefined();
    expect(parent2Row[`c.${nameField}`]).toBe(`Child3${suffix}`);
    expect(parent3Row, "Parent3 (no children) must still be returned by an OUTER join, not dropped").toBeDefined();
    expect(parent3Row[`c.${nameField}`]).toBeUndefined();
  }, 30_000);
});
