// @vitest-environment jsdom
//
// Real-Dataverse integration tests for Solution Editor v1+v2 — every dataverseOps.ts function
// under test here runs completely unmodified (see testSupport/mockNativeBridge.ts's own doc
// comment for why this is a stronger guarantee than a hand-rolled HTTP test would be). Creates one
// fresh table (with a random suffix, so repeated runs never collide with each other) inside the
// existing `ClaudeSmokeTest` solution left in ZaneTest from 2026-08-21's manual verification
// session, builds every column type + a Lookup + a global-choice-backed column on it, creates and
// updates a throwaway Publisher, and exercises the per-solution publish path — then deletes
// everything it created in afterAll so ZaneTest doesn't accumulate test debris across runs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import {
  createColumn,
  createColumnWithGlobalChoice,
  createGlobalOptionSet,
  createLookupColumn,
  createPublisher,
  createTable,
  fetchEntityFields,
  fetchGlobalOptionSets,
  publishSolutionEntities,
  updatePublisher,
  type NewColumnParams,
} from "./dataverseOps";
import type { BasicColumnType } from "./types";

const FAKE_CONNECTION_ID = "integration-test"; // ignored by the mock bridge — see its own doc comment
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";

describe.skipIf(!hasTestCredentials())("Solution Editor — real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const tableSchemaName = `${PUBLISHER_PREFIX}_IntegrationTest${suffix}`;
  const tableLogicalName = tableSchemaName.toLowerCase();
  let createdGlobalOptionSetName: string | null = null;
  let createdPublisherId: string | null = null;

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: tableSchemaName,
      displayName: `Integration Test ${suffix}`,
      displayCollectionName: `Integration Tests ${suffix}`,
      description: "自动化集成测试用表——由 dataverseOps.integration.test.ts 创建，测试结束后应已自动删除；如果还在，说明上次测试运行的清理步骤失败了，可以手动删除。",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: `${PUBLISHER_PREFIX}_name`,
      primaryFieldDisplayName: "Name",
    });
  }, 180_000);

  afterAll(async () => {
    // Best-effort cleanup — a failure here shouldn't fail the whole suite (it just leaves an
    // artifact behind, same tolerance this app's other manual test data already has in ZaneTest).
    const cleanup = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`[integration test cleanup] ${label} 失败（可能需要手动清理）：${err instanceof Error ? err.message : err}`);
      }
    };
    await cleanup("删除测试表", () => dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${tableLogicalName}')`));
    if (createdGlobalOptionSetName) {
      await cleanup("删除全局选项集", () => dataverseTestRequest("DELETE", `GlobalOptionSetDefinitions(Name='${createdGlobalOptionSetName}')`));
    }
    if (createdPublisherId) {
      await cleanup("删除测试 publisher", () => dataverseTestRequest("DELETE", `publishers(${createdPublisherId})`));
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("creates every basic column type, and each one round-trips with the correct real AttributeType", async () => {
    const cases: { type: BasicColumnType; extra?: Partial<NewColumnParams> }[] = [
      { type: "String" },
      { type: "Memo" },
      { type: "Integer" },
      { type: "Decimal" },
      { type: "Money" },
      { type: "Boolean" },
      { type: "DateTime" },
      { type: "Picklist", extra: { options: ["Red", "Green", "Blue"] } },
      { type: "MultiSelectPicklist", extra: { options: ["Alpha", "Beta"] } },
      { type: "BigInt" },
    ];

    for (const { type, extra } of cases) {
      await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, tableLogicalName, type, {
        schemaName: `${PUBLISHER_PREFIX}_Field${type}${suffix}`,
        displayName: `Field ${type} ${suffix}`,
        description: "",
        required: false,
        ...extra,
      });
    }

    const fields = await fetchEntityFields(FAKE_CONNECTION_ID, tableLogicalName);
    for (const { type } of cases) {
      const logicalName = `${PUBLISHER_PREFIX}_field${type.toLowerCase()}${suffix}`.toLowerCase();
      const field = fields.find((f) => f.logicalName === logicalName);
      expect(field, `field for type ${type} (${logicalName}) should have been created`).toBeDefined();
      // fetchEntityFields normalizes MultiSelectPicklist's real wire AttributeType ("Virtual",
      // per buildAttributeBody's own doc comment) back to "MultiSelectPicklist" for display — so
      // every type, including this one, is expected to round-trip as its own name here.
      expect(field!.attributeType, `field for type ${type} should report AttributeType=${type}`).toBe(type);
    }
  }, 120_000);

  it("creates a Lookup field pointing at account, and the relationship + lookup attribute are real", async () => {
    const schemaName = `${PUBLISHER_PREFIX}_LookupField${suffix}`;
    await createLookupColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName,
      displayName: `Lookup Field ${suffix}`,
      description: "",
      required: false,
      referencedEntity: "account",
      referencingEntity: tableLogicalName,
      relationshipSchemaName: `${PUBLISHER_PREFIX}_account_${tableLogicalName}`,
    });

    const fields = await fetchEntityFields(FAKE_CONNECTION_ID, tableLogicalName);
    const lookupField = fields.find((f) => f.logicalName === schemaName.toLowerCase());
    expect(lookupField, "the lookup column should exist on the child table").toBeDefined();
    expect(lookupField!.attributeType).toBe("Lookup");
  }, 60_000);

  it("creates a global option set, then a Picklist column bound to it via GlobalOptionSet@odata.bind", async () => {
    createdGlobalOptionSetName = `${PUBLISHER_PREFIX}_integrationtest${suffix}`;
    await createGlobalOptionSet(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      name: createdGlobalOptionSetName,
      displayName: `Integration Test Choice ${suffix}`,
      description: "",
      options: ["Option One", "Option Two"],
    });

    const sets = await fetchGlobalOptionSets(FAKE_CONNECTION_ID);
    const created = sets.find((s) => s.name === createdGlobalOptionSetName);
    expect(created, "the newly created global option set should show up in fetchGlobalOptionSets").toBeDefined();

    const schemaName = `${PUBLISHER_PREFIX}_GlobalChoiceField${suffix}`;
    await createColumnWithGlobalChoice(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, tableLogicalName, created!.metadataId, {
      schemaName,
      displayName: `Global Choice Field ${suffix}`,
      description: "",
      required: false,
    });

    const fields = await fetchEntityFields(FAKE_CONNECTION_ID, tableLogicalName);
    const field = fields.find((f) => f.logicalName === schemaName.toLowerCase());
    expect(field, "the global-choice-backed column should exist").toBeDefined();
    expect(field!.attributeType).toBe("Picklist");
  }, 60_000);

  it("creates a publisher, updates its friendly name, and both changes are real", async () => {
    const uniqueName = `IntegrationTestPublisher${suffix}`;
    const prefix = `it${suffix}`.slice(0, 8);
    const optionValuePrefix = 10000 + Math.floor(Math.random() * 89000);

    await createPublisher(FAKE_CONNECTION_ID, {
      uniqueName,
      friendlyName: `Integration Test Publisher ${suffix}`,
      customizationPrefix: prefix,
      customizationOptionValuePrefix: optionValuePrefix,
      description: "自动化集成测试创建，测试结束后应已自动删除",
    });

    const lookup = await dataverseTestRequest<{ value: { publisherid: string; friendlyname: string }[] }>(
      "GET",
      `publishers?$select=publisherid,friendlyname&$filter=uniquename eq '${uniqueName}'`,
    );
    expect(lookup.body.value, "the newly created publisher should be findable by its unique name").toHaveLength(1);
    createdPublisherId = lookup.body.value[0].publisherid;
    expect(lookup.body.value[0].friendlyname).toBe(`Integration Test Publisher ${suffix}`);

    await updatePublisher(FAKE_CONNECTION_ID, createdPublisherId, { friendlyName: "Renamed Publisher", description: "updated by integration test" });
    const afterUpdate = await dataverseTestRequest<{ friendlyname: string; description: string }>(
      "GET",
      `publishers(${createdPublisherId})?$select=friendlyname,description`,
    );
    expect(afterUpdate.body.friendlyname).toBe("Renamed Publisher");
    expect(afterUpdate.body.description).toBe("updated by integration test");
  }, 60_000);

  it("rejects an out-of-range customizationOptionValuePrefix client-side, before ever calling Dataverse", async () => {
    await expect(
      createPublisher(FAKE_CONNECTION_ID, {
        uniqueName: `ShouldNeverBeCreated${suffix}`,
        friendlyName: "Should Never Be Created",
        customizationPrefix: "bad",
        customizationOptionValuePrefix: 5, // well outside the documented 10000-99999 range
        description: "",
      }),
    ).rejects.toThrow(/10000/);
  });

  it("publishSolutionEntities succeeds against the real solution's table", async () => {
    await expect(publishSolutionEntities(FAKE_CONNECTION_ID, [tableLogicalName])).resolves.toBeUndefined();
  }, 60_000);
});
