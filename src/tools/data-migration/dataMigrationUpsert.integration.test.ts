// @vitest-environment jsdom
//
// Real-Dataverse integration test for the one assumption Data Migration's entire cross-connection
// copy strategy depends on, and that nothing else in this test suite has verified yet: handleImport
// (DataMigration.tsx) writes phase-1 data by PATCHing `updateRow(..., rowPlan.row.id, ...)` using
// each *source* row's own id as the target URL's primary key — even though that id has never
// existed in the target environment. This only works at all if Dataverse's Web API supports
// upsert-via-PATCH (create a new record at a client-chosen GUID when PATCHing an id that doesn't
// exist), which is documented Dataverse behavior but had never been exercised against a real org
// by this test suite — every other `updateRow` integration test so far PATCHed a record that
// insertRow had already created. `updateRow` itself (Boolean coercion, Lookup @odata.bind
// resolution) is already covered by sql4cds/writeOps.integration.test.ts; this file exists purely
// to confirm the upsert path specifically.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { createTable } from "../solution-editor/dataverseOps";
import { updateRow } from "../sql4cds/writeOps";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";

function randomGuid(): string {
  return crypto.randomUUID();
}

describe.skipIf(!hasTestCredentials())("Data Migration — upsert-via-PATCH real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const tableSchema = `${PUBLISHER_PREFIX}_MigrationUpsertTest${suffix}`;
  const tableLogical = tableSchema.toLowerCase();
  const entitySetName = `${tableLogical}s`;

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: tableSchema,
      displayName: `Migration Upsert Test ${suffix}`,
      displayCollectionName: `Migration Upsert Tests ${suffix}`,
      description: "自动化集成测试用表（Data Migration 的 PATCH-upsert 假设），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: `${PUBLISHER_PREFIX}_name`,
      primaryFieldDisplayName: "Name",
    });

    // A freshly created custom table's Web API route can transiently 404 ("Resource not found
    // for the segment") for a few seconds under sustained back-to-back schema-change load —
    // reproduced running this file as part of the full integration suite (many tables created/
    // deleted in the preceding ~8 minutes), never in isolation. Real, if narrow, production
    // implication: a user who creates a table and immediately migrates data into it within the
    // same minute could hit this too. Poll until the entity set actually answers before this
    // file's own tests start, rather than let that environmental timing gap fail them.
    for (let attempt = 0; ; attempt++) {
      try {
        await dataverseTestRequest("GET", `${entitySetName}?$top=1`);
        break;
      } catch (err) {
        if (attempt >= 5 || !(err instanceof Error) || !err.message.includes("Resource not found")) throw err;
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
  }, 180_000);

  afterAll(async () => {
    try {
      await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${tableLogical}')`);
    } catch (err) {
      console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${tableLogical}）：${err instanceof Error ? err.message : err}`);
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("PATCHing a client-generated GUID that has never existed really creates a new record there, not a 404", async () => {
    const clientGeneratedId = randomGuid();

    await updateRow(FAKE_CONNECTION_ID, tableLogical, entitySetName, clientGeneratedId, {
      [`${PUBLISHER_PREFIX}_name`]: `Upserted ${suffix}`,
    });

    const readBack = await dataverseTestRequest<Record<string, unknown>>(
      "GET",
      `${entitySetName}(${clientGeneratedId})?$select=${PUBLISHER_PREFIX}_name`,
    );
    expect(readBack.body[`${PUBLISHER_PREFIX}_name`]).toBe(`Upserted ${suffix}`);
    expect(readBack.body[`${tableLogical}id`]).toBe(clientGeneratedId);
  }, 30_000);

  it("a second PATCH to the same id updates the existing record instead of creating another one", async () => {
    const clientGeneratedId = randomGuid();
    await updateRow(FAKE_CONNECTION_ID, tableLogical, entitySetName, clientGeneratedId, {
      [`${PUBLISHER_PREFIX}_name`]: `First ${suffix}`,
    });
    await updateRow(FAKE_CONNECTION_ID, tableLogical, entitySetName, clientGeneratedId, {
      [`${PUBLISHER_PREFIX}_name`]: `Second ${suffix}`,
    });

    const readBack = await dataverseTestRequest<Record<string, unknown>>(
      "GET",
      `${entitySetName}(${clientGeneratedId})?$select=${PUBLISHER_PREFIX}_name`,
    );
    expect(readBack.body[`${PUBLISHER_PREFIX}_name`]).toBe(`Second ${suffix}`);

    const count = await dataverseTestRequest<{ "@odata.count"?: number }>("GET", `${entitySetName}?$filter=${tableLogical}id eq ${clientGeneratedId}&$count=true&$top=1`);
    expect(count.body["@odata.count"]).toBe(1);
  }, 30_000);
});
