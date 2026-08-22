// @vitest-environment jsdom
//
// Real-Dataverse integration test for SQL4CDS's N:N intersect write path
// (fetchManyToManyInfo/resolveIntersectRowValues/insertIntersectRow/deleteIntersectRow) — the one
// sub-feature writeOps.integration.test.ts couldn't cover, since ZaneTest had no existing safe
// custom N:N relationship to test against (checked: no self-referential account<->account
// relationship, and a broader RelationshipDefinitions query 400'd — metadata endpoints only
// support `eq` in $filter, not `or`/combined conditions).
//
// So this builds its own throwaway N:N relationship as test scaffolding: two fresh tables plus a
// ManyToManyRelationshipMetadata POST between them. That POST body is NOT app code under test —
// this app has no "create an N:N relationship" feature (Solution Editor v2 only does lookups/
// 1:N) — it's copied field-for-field from Microsoft's own worked Web API sample ("Web API table
// schema operations sample", Section 7: sample_BankAccount <-> Contact), not guessed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, TEST_ORG_URL, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { createTable } from "../solution-editor/dataverseOps";
import { fetchEntityMeta, fetchManyToManyInfo, type ManyToManyInfo } from "../../native/metadataService";
import { deleteIntersectRow, insertIntersectRow, insertRow, resolveIntersectRowValues } from "./writeOps";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";

describe.skipIf(!hasTestCredentials())("SQL4CDS writeOps — N:N intersect real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const table1Schema = `${PUBLISHER_PREFIX}_NnEntity1${suffix}`;
  const table1Logical = table1Schema.toLowerCase();
  const table2Schema = `${PUBLISHER_PREFIX}_NnEntity2${suffix}`;
  const table2Logical = table2Schema.toLowerCase();
  const relationshipSchemaName = `${PUBLISHER_PREFIX}_nnrel${suffix}`;
  const intersectEntityName = relationshipSchemaName.toLowerCase();

  // Never assumed via naive pluralization — a random suffix ending in "s" makes Dataverse's real
  // pluralizer append "es", not "s" (confirmed live via writeOps.integration.test.ts hitting this
  // exact case). Read from real metadata in beforeAll instead.
  let table1EntitySet = "";
  let table2EntitySet = "";
  let rel: ManyToManyInfo;
  let e1Id: string;
  let e2Id: string;

  beforeAll(async () => {
    installMockNativeBridge();
    // Sequential, not Promise.all: Dataverse's EntityCustomization lock is org-wide (same
    // constraint vitest.integration.config.ts's fileParallelism:false works around across files —
    // this is the same thing within a single file's beforeAll).
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: table1Schema,
      displayName: `NN Entity1 ${suffix}`,
      displayCollectionName: `NN Entity1s ${suffix}`,
      description: "自动化集成测试用表（SQL4CDS N:N 关联链路），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: `${PUBLISHER_PREFIX}_name`,
      primaryFieldDisplayName: "Name",
    });
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: table2Schema,
      displayName: `NN Entity2 ${suffix}`,
      displayCollectionName: `NN Entity2s ${suffix}`,
      description: "自动化集成测试用表（SQL4CDS N:N 关联链路），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: `${PUBLISHER_PREFIX}_name`,
      primaryFieldDisplayName: "Name",
    });

    // Field-for-field copy of Microsoft's own documented Web API sample request body (see this
    // file's header comment) — only the entity/schema names are substituted for this run's
    // throwaway tables.
    await dataverseTestRequest(
      "POST",
      "RelationshipDefinitions",
      {
        "@odata.type": "Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata",
        SchemaName: relationshipSchemaName,
        Entity1LogicalName: table1Logical,
        Entity2LogicalName: table2Logical,
        IntersectEntityName: intersectEntityName,
      },
      { "MSCRM.SolutionUniqueName": SOLUTION_UNIQUE_NAME },
    );

    // fetchManyToManyInfo (the real production function every other assertion below depends on)
    // is how this test discovers the relationship's own real navigation property / intersect
    // attribute names — not re-derived or assumed, exactly the way SQL4CDS's own INSERT/DELETE
    // handling for an intersect entity does it.
    const info = await fetchManyToManyInfo(FAKE_CONNECTION_ID, intersectEntityName);
    expect(info, "fetchManyToManyInfo should recognize the freshly created intersect entity").not.toBeNull();
    rel = info!;

    const [meta1, meta2] = await Promise.all([fetchEntityMeta(FAKE_CONNECTION_ID, table1Logical), fetchEntityMeta(FAKE_CONNECTION_ID, table2Logical)]);
    table1EntitySet = meta1.entitySetName;
    table2EntitySet = meta2.entitySetName;

    const [r1, r2] = await Promise.all([
      insertRow(FAKE_CONNECTION_ID, table1Logical, table1EntitySet, { [`${PUBLISHER_PREFIX}_name`]: `E1 ${suffix}` }),
      insertRow(FAKE_CONNECTION_ID, table2Logical, table2EntitySet, { [`${PUBLISHER_PREFIX}_name`]: `E2 ${suffix}` }),
    ]);
    e1Id = r1.newId!;
    e2Id = r2.newId!;
  }, 180_000);

  afterAll(async () => {
    // Deleting either side of an N:N relationship's table cascades to the relationship and its
    // intersect entity too (same cascade this suite already relies on for the 1:N Lookup case in
    // writeOps.integration.test.ts / dataverseOps.integration.test.ts) — no separate
    // RelationshipDefinitions DELETE needed.
    for (const logical of [table1Logical, table2Logical]) {
      try {
        await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${logical}')`);
      } catch (err) {
        console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${logical}）：${err instanceof Error ? err.message : err}`);
      }
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("resolveIntersectRowValues maps real column values to the relationship's two real sides", () => {
    const values = resolveIntersectRowValues(rel, {
      [rel.entity1IntersectAttribute]: e1Id,
      [rel.entity2IntersectAttribute]: e2Id,
    });
    expect(values).toEqual({ entity1Value: e1Id, entity2Value: e2Id });
  });

  it("insertIntersectRow really associates the two records via the relationship's $ref endpoint", async () => {
    await insertIntersectRow(FAKE_CONNECTION_ID, TEST_ORG_URL, rel, { entity1Value: e1Id, entity2Value: e2Id });

    const readBack = await dataverseTestRequest<{ value: { [key: string]: string }[] }>(
      "GET",
      `${table1EntitySet}(${e1Id})/${rel.entity1NavigationPropertyName}?$select=${table2Logical}id`,
    );
    expect(readBack.body.value.map((r) => r[`${table2Logical}id`])).toContain(e2Id);
  }, 30_000);

  it("deleteIntersectRow really disassociates the two records", async () => {
    await deleteIntersectRow(FAKE_CONNECTION_ID, rel, { entity1Value: e1Id, entity2Value: e2Id });

    const readBack = await dataverseTestRequest<{ value: { [key: string]: string }[] }>(
      "GET",
      `${table1EntitySet}(${e1Id})/${rel.entity1NavigationPropertyName}?$select=${table2Logical}id`,
    );
    expect(readBack.body.value.map((r) => r[`${table2Logical}id`])).not.toContain(e2Id);
  }, 30_000);
});
