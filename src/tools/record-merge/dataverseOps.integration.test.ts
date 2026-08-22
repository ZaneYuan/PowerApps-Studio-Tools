// @vitest-environment jsdom
//
// Real-Dataverse integration test for Record Merge's reference-migration write path — the
// highest-risk module in this tool set (it re-points other real records' Lookup fields and
// N:N associations from an old record to a new one). Builds a fresh throwaway schema — a Parent
// table, a Child table with a Lookup to Parent (1:N), and an Other table N:N-related to Parent —
// so the actual migration runs against real, disposable data rather than mocking any part of
// scanReferences/migrateReferences themselves.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, TEST_ORG_URL, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { createLookupColumn, createTable } from "../solution-editor/dataverseOps";
import { fetchEntityMeta, fetchManyToManyInfo } from "../../native/metadataService";
import { insertIntersectRow, insertRow, updateRow } from "../sql4cds/writeOps";
import { lookupRecord, migrateReferences, scanReferences } from "./dataverseOps";
import type { ManyToManyRefTable, MigrationLogEntry, OneToManyRefTable } from "./types";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";

describe.skipIf(!hasTestCredentials())("Record Merge — real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const parentSchema = `${PUBLISHER_PREFIX}_MergeParent${suffix}`;
  const parentLogical = parentSchema.toLowerCase();
  const childSchema = `${PUBLISHER_PREFIX}_MergeChild${suffix}`;
  const childLogical = childSchema.toLowerCase();
  const otherSchema = `${PUBLISHER_PREFIX}_MergeOther${suffix}`;
  const otherLogical = otherSchema.toLowerCase();
  const lookupFieldLogical = `${PUBLISHER_PREFIX}_parentlookup${suffix}`.toLowerCase();
  const nnRelationshipSchema = `${PUBLISHER_PREFIX}_mrgnn${suffix}`;
  const nnIntersectEntity = nnRelationshipSchema.toLowerCase();

  // Never assumed via naive pluralization — a random suffix ending in "s" makes Dataverse's real
  // pluralizer append "es", not "s" (confirmed live via writeOps.integration.test.ts hitting this
  // exact case). Read from real metadata in beforeAll instead.
  let parentEntitySet = "";
  let childEntitySet = "";
  let otherEntitySet = "";
  let oldId: string;
  let newId: string;
  let child1Id: string;
  let child2Id: string;
  let other1Id: string;
  let other2Id: string;

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: parentSchema,
      displayName: `Merge Parent ${suffix}`,
      displayCollectionName: `Merge Parents ${suffix}`,
      description: "自动化集成测试用表（Record Merge 引用迁移链路），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: `${PUBLISHER_PREFIX}_name`,
      primaryFieldDisplayName: "Name",
    });
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: childSchema,
      displayName: `Merge Child ${suffix}`,
      displayCollectionName: `Merge Children ${suffix}`,
      description: "自动化集成测试用表（Record Merge 引用迁移链路），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: `${PUBLISHER_PREFIX}_name`,
      primaryFieldDisplayName: "Name",
    });
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: otherSchema,
      displayName: `Merge Other ${suffix}`,
      displayCollectionName: `Merge Others ${suffix}`,
      description: "自动化集成测试用表（Record Merge 引用迁移链路），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: `${PUBLISHER_PREFIX}_name`,
      primaryFieldDisplayName: "Name",
    });
    await createLookupColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: `${PUBLISHER_PREFIX}_ParentLookup${suffix}`,
      displayName: "Parent Lookup",
      description: "",
      required: false,
      referencedEntity: parentLogical,
      referencingEntity: childLogical,
      relationshipSchemaName: `${PUBLISHER_PREFIX}_parent_child_${suffix}`,
    });
    await dataverseTestRequest(
      "POST",
      "RelationshipDefinitions",
      {
        "@odata.type": "Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata",
        SchemaName: nnRelationshipSchema,
        Entity1LogicalName: parentLogical,
        Entity2LogicalName: otherLogical,
        IntersectEntityName: nnIntersectEntity,
      },
      { "MSCRM.SolutionUniqueName": SOLUTION_UNIQUE_NAME },
    );

    const [parentMeta, childMeta, otherMeta] = await Promise.all([
      fetchEntityMeta(FAKE_CONNECTION_ID, parentLogical),
      fetchEntityMeta(FAKE_CONNECTION_ID, childLogical),
      fetchEntityMeta(FAKE_CONNECTION_ID, otherLogical),
    ]);
    parentEntitySet = parentMeta.entitySetName;
    childEntitySet = childMeta.entitySetName;
    otherEntitySet = otherMeta.entitySetName;

    const [oldRow, newRow, c1, c2, o1, o2] = await Promise.all([
      insertRow(FAKE_CONNECTION_ID, parentLogical, parentEntitySet, { [`${PUBLISHER_PREFIX}_name`]: `Old ${suffix}` }),
      insertRow(FAKE_CONNECTION_ID, parentLogical, parentEntitySet, { [`${PUBLISHER_PREFIX}_name`]: `New ${suffix}` }),
      insertRow(FAKE_CONNECTION_ID, childLogical, childEntitySet, { [`${PUBLISHER_PREFIX}_name`]: `Child1 ${suffix}` }),
      insertRow(FAKE_CONNECTION_ID, childLogical, childEntitySet, { [`${PUBLISHER_PREFIX}_name`]: `Child2 ${suffix}` }),
      insertRow(FAKE_CONNECTION_ID, otherLogical, otherEntitySet, { [`${PUBLISHER_PREFIX}_name`]: `Other1 ${suffix}` }),
      insertRow(FAKE_CONNECTION_ID, otherLogical, otherEntitySet, { [`${PUBLISHER_PREFIX}_name`]: `Other2 ${suffix}` }),
    ]);
    oldId = oldRow.newId!;
    newId = newRow.newId!;
    child1Id = c1.newId!;
    child2Id = c2.newId!;
    other1Id = o1.newId!;
    other2Id = o2.newId!;

    await updateRow(FAKE_CONNECTION_ID, childLogical, childEntitySet, child1Id, { [lookupFieldLogical]: oldId });
    await updateRow(FAKE_CONNECTION_ID, childLogical, childEntitySet, child2Id, { [lookupFieldLogical]: oldId });

    const info = await fetchManyToManyInfo(FAKE_CONNECTION_ID, nnIntersectEntity);
    expect(info, "fetchManyToManyInfo should recognize the freshly created intersect entity").not.toBeNull();
    // Both Other records start associated with the OLD parent record...
    await insertIntersectRow(FAKE_CONNECTION_ID, TEST_ORG_URL, info!, { entity1Value: oldId, entity2Value: other1Id });
    await insertIntersectRow(FAKE_CONNECTION_ID, TEST_ORG_URL, info!, { entity1Value: oldId, entity2Value: other2Id });
    // ...and Other1 is ALSO already associated with the NEW parent record, to exercise
    // migrateManyToManyTable's "already associated — skip the duplicate insert" branch.
    await insertIntersectRow(FAKE_CONNECTION_ID, TEST_ORG_URL, info!, { entity1Value: newId, entity2Value: other1Id });
  }, 180_000);

  afterAll(async () => {
    for (const logical of [childLogical, otherLogical, parentLogical]) {
      try {
        await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${logical}')`);
      } catch (err) {
        console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${logical}）：${err instanceof Error ? err.message : err}`);
      }
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("lookupRecord finds the real old/new records by id with their real primary names", async () => {
    const oldLookup = await lookupRecord(FAKE_CONNECTION_ID, parentLogical, oldId);
    expect(oldLookup).toEqual({ exists: true, primaryName: `Old ${suffix}` });
    const newLookup = await lookupRecord(FAKE_CONNECTION_ID, parentLogical, newId);
    expect(newLookup).toEqual({ exists: true, primaryName: `New ${suffix}` });
    const missing = await lookupRecord(FAKE_CONNECTION_ID, parentLogical, "00000000-0000-0000-0000-000000000000");
    expect(missing.exists).toBe(false);
  }, 30_000);

  it("scanReferences finds the real 1:N child table and N:N other table with correct counts", async () => {
    const result = await scanReferences(FAKE_CONNECTION_ID, parentLogical, oldId);
    expect(result.failedRelationships).toEqual([]);

    const oneToMany = result.tables.find((t): t is OneToManyRefTable => t.kind === "onetomany" && t.entityLogicalName === childLogical);
    expect(oneToMany, "should find the Child table as a real 1:N reference").toBeDefined();
    expect(oneToMany!.count).toBe(2);

    const manyToMany = result.tables.find((t): t is ManyToManyRefTable => t.kind === "manytomany" && t.otherEntityLogicalName === otherLogical);
    expect(manyToMany, "should find the Other table as a real N:N reference").toBeDefined();
    expect(manyToMany!.count).toBe(2);
  }, 60_000);

  it("migrateReferences really re-points the 1:N lookups and N:N associations from old to new", async () => {
    const scan = await scanReferences(FAKE_CONNECTION_ID, parentLogical, oldId);
    const entries: MigrationLogEntry[] = [];
    await migrateReferences(
      FAKE_CONNECTION_ID,
      TEST_ORG_URL,
      parentLogical,
      parentEntitySet,
      oldId,
      newId,
      scan.tables,
      4,
      (entry) => entries.push(entry),
      () => false,
    );
    expect(entries.every((e) => e.state === "success"), `every migration entry should succeed: ${JSON.stringify(entries.filter((e) => e.state === "error"))}`).toBe(
      true,
    );

    const child1 = await dataverseTestRequest<Record<string, unknown>>("GET", `${childEntitySet}(${child1Id})?$select=_${lookupFieldLogical}_value`);
    const child2 = await dataverseTestRequest<Record<string, unknown>>("GET", `${childEntitySet}(${child2Id})?$select=_${lookupFieldLogical}_value`);
    expect(child1.body[`_${lookupFieldLogical}_value`]).toBe(newId);
    expect(child2.body[`_${lookupFieldLogical}_value`]).toBe(newId);

    const info = await fetchManyToManyInfo(FAKE_CONNECTION_ID, nnIntersectEntity);
    const newAssociated = await dataverseTestRequest<{ value: Record<string, unknown>[] }>(
      "GET",
      `${parentEntitySet}(${newId})/${info!.entity1NavigationPropertyName}?$select=${otherLogical}id`,
    );
    const newOtherIds = newAssociated.body.value.map((r) => r[`${otherLogical}id`]);
    expect(newOtherIds).toEqual(expect.arrayContaining([other1Id, other2Id]));
    expect(newOtherIds).toHaveLength(2); // other1's pre-existing association wasn't duplicated

    const oldAssociated = await dataverseTestRequest<{ value: Record<string, unknown>[] }>(
      "GET",
      `${parentEntitySet}(${oldId})/${info!.entity1NavigationPropertyName}?$select=${otherLogical}id`,
    );
    expect(oldAssociated.body.value).toEqual([]);
  }, 120_000);
});
