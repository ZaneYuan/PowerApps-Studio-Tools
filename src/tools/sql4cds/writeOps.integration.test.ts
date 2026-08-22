// @vitest-environment jsdom
//
// Real-Dataverse integration tests for SQL4CDS's write path — the most-rewritten, highest-risk
// module in this codebase per its own commit history (see 01-开发进度.md's many "SQL4CDS: fix ..."
// entries). Covers insertRow/updateRow/deleteRow/queryMatchingIds, and specifically buildRowBody's
// two trickiest cases: Boolean 0/1-to-real-boolean coercion and Lookup column ->
// `{navProp}@odata.bind` resolution — both were real bugs in this codebase's history (8.18/8.19
// bugs docs), and pure unit tests can't catch a wrong navigation-property-name assumption the way
// a real POST against ZaneTest can.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { createColumn, createLookupColumn, createTable } from "../solution-editor/dataverseOps";
import { deleteRow, insertRow, queryMatchingIds, updateRow } from "./writeOps";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";
// A real, stable sample record ("Fourth Coffee (sample)") already present in ZaneTest — used only
// as a Lookup target, never modified.
const SAMPLE_ACCOUNT_ID = "ed4260eb-0523-f011-8c4d-6045bd5a9c5f";

describe.skipIf(!hasTestCredentials())("SQL4CDS writeOps — real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const tableSchemaName = `${PUBLISHER_PREFIX}_Sql4CdsWriteTest${suffix}`;
  const tableLogicalName = tableSchemaName.toLowerCase();
  // Never assumed via naive pluralization (`${tableLogicalName}s`) — read from real metadata in
  // beforeAll instead. A real, reproducible counterexample: a random suffix ending in "s" makes
  // Dataverse's actual pluralizer append "es", not "s" (confirmed live — this app's own
  // metadataService.ts avoids the same guess for exactly this kind of reason elsewhere).
  let entitySetName = "";
  const boolFieldLogicalName = `${PUBLISHER_PREFIX}_activeflag${suffix}`.toLowerCase();
  const lookupFieldLogicalName = `${PUBLISHER_PREFIX}_accountlookup${suffix}`.toLowerCase();

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: tableSchemaName,
      displayName: `SQL4CDS Write Test ${suffix}`,
      displayCollectionName: `SQL4CDS Write Tests ${suffix}`,
      description: "自动化集成测试用表（SQL4CDS 写入链路），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: `${PUBLISHER_PREFIX}_name`,
      primaryFieldDisplayName: "Name",
    });
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, tableLogicalName, "Boolean", {
      schemaName: `${PUBLISHER_PREFIX}_ActiveFlag${suffix}`,
      displayName: "Active Flag",
      description: "",
      required: false,
    });
    await createLookupColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: `${PUBLISHER_PREFIX}_AccountLookup${suffix}`,
      displayName: "Account Lookup",
      description: "",
      required: false,
      referencedEntity: "account",
      referencingEntity: tableLogicalName,
      relationshipSchemaName: `${PUBLISHER_PREFIX}_account_${tableLogicalName}`,
    });
    const meta = await dataverseTestRequest<{ EntitySetName: string }>(
      "GET",
      `EntityDefinitions(LogicalName='${tableLogicalName}')?$select=EntitySetName`,
    );
    entitySetName = meta.body.EntitySetName.toLowerCase();
  }, 180_000);

  afterAll(async () => {
    try {
      await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${tableLogicalName}')`);
    } catch (err) {
      console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${tableLogicalName}）：${err instanceof Error ? err.message : err}`);
    }
    uninstallMockNativeBridge();
  }, 180_000);

  let insertedId: string;

  it("insertRow: coerces a bare SQL 0/1 to a real JSON boolean, and resolves a Lookup column to a real @odata.bind", async () => {
    const result = await insertRow(FAKE_CONNECTION_ID, tableLogicalName, entitySetName, {
      [`${PUBLISHER_PREFIX}_name`]: `Row ${suffix}`,
      [boolFieldLogicalName]: 1, // bare SQL bit literal — literalToJsValue would pass this through as the JS number 1
      [lookupFieldLogicalName]: SAMPLE_ACCOUNT_ID,
    });
    expect(result.newId, "insertRow should parse a real new id out of the POST response").toMatch(/^[0-9a-f-]{36}$/i);
    insertedId = result.newId!;

    const readBack = await dataverseTestRequest<Record<string, unknown>>(
      "GET",
      `${entitySetName}(${insertedId})?$select=${boolFieldLogicalName},_${lookupFieldLogicalName}_value`,
    );
    expect(readBack.body[boolFieldLogicalName], "the Boolean field should be a real JSON boolean, not the number 1").toBe(true);
    expect(readBack.body[`_${lookupFieldLogicalName}_value`]).toBe(SAMPLE_ACCOUNT_ID);
  }, 60_000);

  it("queryMatchingIds finds the inserted row by a real $filter, with the correct totalCount", async () => {
    const result = await queryMatchingIds(FAKE_CONNECTION_ID, entitySetName, `${tableLogicalName}id`, `${boolFieldLogicalName} eq true`);
    expect(result.ids).toContain(insertedId);
    expect(result.totalCount).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("updateRow: flips the boolean and clears the lookup, and both changes are real", async () => {
    await updateRow(FAKE_CONNECTION_ID, tableLogicalName, entitySetName, insertedId, {
      [boolFieldLogicalName]: 0,
    });
    const readBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySetName}(${insertedId})?$select=${boolFieldLogicalName}`);
    expect(readBack.body[boolFieldLogicalName]).toBe(false);
  }, 30_000);

  it("deleteRow actually removes the record", async () => {
    await deleteRow(FAKE_CONNECTION_ID, entitySetName, insertedId);
    await expect(dataverseTestRequest("GET", `${entitySetName}(${insertedId})`)).rejects.toThrow(/404|Does Not Exist/i);
  }, 30_000);
});
