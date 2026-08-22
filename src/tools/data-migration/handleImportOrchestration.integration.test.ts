// @vitest-environment jsdom
//
// Real-Dataverse integration test for DataMigration.tsx's handleImport — the full 3-phase write
// orchestration (create non-deferred fields -> backfill same-batch cross-references -> N:N
// associate) had never been run end-to-end against real Dataverse before this file. The upsert
// mechanism it depends on was already confirmed (dataMigrationUpsert.integration.test.ts) and
// planDeferredWrite/phase1Body/phase2Body's pure logic was already unit-tested
// (deferredWrite.test.ts), but the actual orchestration sequence — exactly mirroring
// handleImport's own code (not reinvented) — never had a real network round-trip through it.
//
// Builds one mixed multi-table batch in a single simulated handleImport run, since that's the
// realistic case this feature exists for: a self-referencing table (row B's lookup points at row
// A's own not-yet-created id, in the same batch), two tables with a genuine cyclic reference
// (A -> B and B -> A), and an N:N intersect table — all imported together, same as a real user's
// multi-tab batch.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, TEST_ORG_URL, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { fetchEntityMeta, fetchManyToManyInfo } from "../../native/metadataService";
import { createLookupColumn, createTable } from "../solution-editor/dataverseOps";
import { runConcurrent } from "../sql4cds/concurrency";
import { insertIntersectRow, resolveIntersectRowValues, updateRow } from "../sql4cds/writeOps";
import { phase1Body, phase2Body, planDeferredWrite } from "./deferredWrite";
import type { ImportTable } from "./types";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";
const nameField = `${PUBLISHER_PREFIX}_name`;

function randomGuid(): string {
  return crypto.randomUUID();
}

describe.skipIf(!hasTestCredentials())("Data Migration — handleImport 3-phase orchestration, real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();

  // Table 1: self-referencing (cross-row reference within the same table)
  const selfRefSchema = `${PUBLISHER_PREFIX}_MigrationSelfRef${suffix}`;
  const selfRefLogical = selfRefSchema.toLowerCase();
  const selfRefLookupField = `${PUBLISHER_PREFIX}_parentlookup${suffix}`.toLowerCase();

  // Tables 2+3: a genuine cyclic reference (A -> B, B -> A)
  const cycleASchema = `${PUBLISHER_PREFIX}_MigrationCycleA${suffix}`;
  const cycleALogical = cycleASchema.toLowerCase();
  const cycleBLookupField = `${PUBLISHER_PREFIX}_blookup${suffix}`.toLowerCase();
  const cycleBSchema = `${PUBLISHER_PREFIX}_MigrationCycleB${suffix}`;
  const cycleBLogical = cycleBSchema.toLowerCase();
  const cycleALookupField = `${PUBLISHER_PREFIX}_alookup${suffix}`.toLowerCase();

  // Tables 4+5: N:N (phase 3)
  const nnParentSchema = `${PUBLISHER_PREFIX}_MigrationNnParent${suffix}`;
  const nnParentLogical = nnParentSchema.toLowerCase();
  const nnOtherSchema = `${PUBLISHER_PREFIX}_MigrationNnOther${suffix}`;
  const nnOtherLogical = nnOtherSchema.toLowerCase();
  const nnRelationshipSchema = `${PUBLISHER_PREFIX}_mignn${suffix}`;
  const nnIntersectEntity = nnRelationshipSchema.toLowerCase();

  let selfRefEntitySet = "";
  let cycleAEntitySet = "";
  let cycleBEntitySet = "";
  let nnParentEntitySet = "";
  let nnOtherEntitySet = "";

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: selfRefSchema,
      displayName: `Migration SelfRef ${suffix}`,
      displayCollectionName: `Migration SelfRefs ${suffix}`,
      description: "自动化集成测试用表（Data Migration 三阶段编排——跨行引用），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: nameField,
      primaryFieldDisplayName: "Name",
    });
    await createLookupColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: `${PUBLISHER_PREFIX}_ParentLookup${suffix}`,
      displayName: "Parent Lookup",
      description: "",
      required: false,
      referencedEntity: selfRefLogical,
      referencingEntity: selfRefLogical,
      relationshipSchemaName: `${PUBLISHER_PREFIX}_selfref_${suffix}`,
    });

    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: cycleASchema,
      displayName: `Migration CycleA ${suffix}`,
      displayCollectionName: `Migration CycleAs ${suffix}`,
      description: "自动化集成测试用表（Data Migration 三阶段编排——循环依赖），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: nameField,
      primaryFieldDisplayName: "Name",
    });
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: cycleBSchema,
      displayName: `Migration CycleB ${suffix}`,
      displayCollectionName: `Migration CycleBs ${suffix}`,
      description: "自动化集成测试用表（Data Migration 三阶段编排——循环依赖），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: nameField,
      primaryFieldDisplayName: "Name",
    });
    await createLookupColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: `${PUBLISHER_PREFIX}_BLookup${suffix}`,
      displayName: "B Lookup",
      description: "",
      required: false,
      referencedEntity: cycleBLogical,
      referencingEntity: cycleALogical,
      relationshipSchemaName: `${PUBLISHER_PREFIX}_a_to_b_${suffix}`,
    });
    await createLookupColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: `${PUBLISHER_PREFIX}_ALookup${suffix}`,
      displayName: "A Lookup",
      description: "",
      required: false,
      referencedEntity: cycleALogical,
      referencingEntity: cycleBLogical,
      relationshipSchemaName: `${PUBLISHER_PREFIX}_b_to_a_${suffix}`,
    });

    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: nnParentSchema,
      displayName: `Migration NnParent ${suffix}`,
      displayCollectionName: `Migration NnParents ${suffix}`,
      description: "自动化集成测试用表（Data Migration 三阶段编排——N:N 关联），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: nameField,
      primaryFieldDisplayName: "Name",
    });
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: nnOtherSchema,
      displayName: `Migration NnOther ${suffix}`,
      displayCollectionName: `Migration NnOthers ${suffix}`,
      description: "自动化集成测试用表（Data Migration 三阶段编排——N:N 关联），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: nameField,
      primaryFieldDisplayName: "Name",
    });
    await dataverseTestRequest(
      "POST",
      "RelationshipDefinitions",
      {
        "@odata.type": "Microsoft.Dynamics.CRM.ManyToManyRelationshipMetadata",
        SchemaName: nnRelationshipSchema,
        Entity1LogicalName: nnParentLogical,
        Entity2LogicalName: nnOtherLogical,
        IntersectEntityName: nnIntersectEntity,
      },
      { "MSCRM.SolutionUniqueName": SOLUTION_UNIQUE_NAME },
    );

    const [selfRefMeta, cycleAMeta, cycleBMeta, nnParentMeta, nnOtherMeta] = await Promise.all([
      fetchEntityMeta(FAKE_CONNECTION_ID, selfRefLogical),
      fetchEntityMeta(FAKE_CONNECTION_ID, cycleALogical),
      fetchEntityMeta(FAKE_CONNECTION_ID, cycleBLogical),
      fetchEntityMeta(FAKE_CONNECTION_ID, nnParentLogical),
      fetchEntityMeta(FAKE_CONNECTION_ID, nnOtherLogical),
    ]);
    selfRefEntitySet = selfRefMeta.entitySetName;
    cycleAEntitySet = cycleAMeta.entitySetName;
    cycleBEntitySet = cycleBMeta.entitySetName;
    nnParentEntitySet = nnParentMeta.entitySetName;
    nnOtherEntitySet = nnOtherMeta.entitySetName;
  }, 300_000);

  afterAll(async () => {
    for (const logical of [selfRefLogical, cycleALogical, cycleBLogical, nnParentLogical, nnOtherLogical]) {
      try {
        await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${logical}')`);
      } catch (err) {
        console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${logical}）：${err instanceof Error ? err.message : err}`);
      }
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("handleImport's real 3-phase sequence: cross-row self-reference, a genuine A<->B cycle, and N:N association, all in one mixed batch", async () => {
    const parentId = randomGuid();
    const childId = randomGuid();
    const aId = randomGuid();
    const bId = randomGuid();

    const selfRefTable: ImportTable = {
      tabId: "t-selfref",
      entityLogicalName: selfRefLogical,
      entitySetName: selfRefEntitySet,
      primaryIdAttribute: `${selfRefLogical}id`,
      source: "query",
      isIntersect: false,
      columns: [
        { key: nameField, checked: true, attributeType: "String" },
        { key: selfRefLookupField, checked: true, attributeType: "Lookup" },
      ],
      rows: [
        { id: parentId, checked: true, values: { [nameField]: `Parent ${suffix}`, [selfRefLookupField]: null } },
        // childId's lookup points at parentId — parentId is itself a checked row's own primary
        // key in this same batch, so planDeferredWrite must defer it to phase 2.
        { id: childId, checked: true, values: { [nameField]: `Child ${suffix}`, [selfRefLookupField]: parentId } },
      ],
    };

    const cycleATable: ImportTable = {
      tabId: "t-cyclea",
      entityLogicalName: cycleALogical,
      entitySetName: cycleAEntitySet,
      primaryIdAttribute: `${cycleALogical}id`,
      source: "query",
      isIntersect: false,
      columns: [
        { key: nameField, checked: true, attributeType: "String" },
        { key: cycleBLookupField, checked: true, attributeType: "Lookup" },
      ],
      // A's row references B's not-yet-created id, and vice versa below — a real cyclic pair.
      rows: [{ id: aId, checked: true, values: { [nameField]: `A ${suffix}`, [cycleBLookupField]: bId } }],
    };
    const cycleBTable: ImportTable = {
      tabId: "t-cycleb",
      entityLogicalName: cycleBLogical,
      entitySetName: cycleBEntitySet,
      primaryIdAttribute: `${cycleBLogical}id`,
      source: "query",
      isIntersect: false,
      columns: [
        { key: nameField, checked: true, attributeType: "String" },
        { key: cycleALookupField, checked: true, attributeType: "Lookup" },
      ],
      rows: [{ id: bId, checked: true, values: { [nameField]: `B ${suffix}`, [cycleALookupField]: aId } }],
    };

    const nnParentId = randomGuid();
    const nnOtherId = randomGuid();
    const nnInfo = await fetchManyToManyInfo(FAKE_CONNECTION_ID, nnIntersectEntity);
    expect(nnInfo, "fetchManyToManyInfo should recognize the freshly created intersect entity").not.toBeNull();

    const nnParentTable: ImportTable = {
      tabId: "t-nnparent",
      entityLogicalName: nnParentLogical,
      entitySetName: nnParentEntitySet,
      primaryIdAttribute: `${nnParentLogical}id`,
      source: "query",
      isIntersect: false,
      columns: [{ key: nameField, checked: true, attributeType: "String" }],
      rows: [{ id: nnParentId, checked: true, values: { [nameField]: `NnParent ${suffix}` } }],
    };
    const nnOtherTable: ImportTable = {
      tabId: "t-nnother",
      entityLogicalName: nnOtherLogical,
      entitySetName: nnOtherEntitySet,
      primaryIdAttribute: `${nnOtherLogical}id`,
      source: "query",
      isIntersect: false,
      columns: [{ key: nameField, checked: true, attributeType: "String" }],
      rows: [{ id: nnOtherId, checked: true, values: { [nameField]: `NnOther ${suffix}` } }],
    };
    // The intersect table row itself, addressed by the two ManyToManyInfo attribute names — this
    // is exactly the shape a real SELECT against the intersect entity's own EntitySet returns.
    const nnIntersectTable: ImportTable = {
      tabId: "t-nnintersect",
      entityLogicalName: nnIntersectEntity,
      entitySetName: (await fetchEntityMeta(FAKE_CONNECTION_ID, nnIntersectEntity)).entitySetName,
      primaryIdAttribute: `${nnIntersectEntity}id`,
      source: "query",
      isIntersect: true,
      manyToManyInfo: nnInfo!,
      columns: [
        { key: nnInfo!.entity1IntersectAttribute, checked: true, attributeType: "Uniqueidentifier" },
        { key: nnInfo!.entity2IntersectAttribute, checked: true, attributeType: "Uniqueidentifier" },
      ],
      rows: [
        {
          id: randomGuid(),
          checked: true,
          values: { [nnInfo!.entity1IntersectAttribute]: nnParentId, [nnInfo!.entity2IntersectAttribute]: nnOtherId },
        },
      ],
    };

    const tables: ImportTable[] = [selfRefTable, cycleATable, cycleBTable, nnParentTable, nnOtherTable, nnIntersectTable];

    // ---- Exactly handleImport's own sequence, real functions, real network ----
    const plan = planDeferredWrite(tables);
    // Confirms planDeferredWrite really detected both deferred cases before spending a real
    // network round-trip proving it — 3 deferred rows: the self-ref child, and both cyclic rows.
    expect(plan.deferredRowCount).toBe(3);

    await runConcurrent(
      plan.rows,
      4,
      async (rowPlan) => {
        await updateRow(FAKE_CONNECTION_ID, rowPlan.table.entityLogicalName, rowPlan.table.entitySetName, rowPlan.row.id, phase1Body(rowPlan));
      },
      () => false,
    );

    const toBackfill = plan.rows.filter((p) => p.deferredColumns.length > 0);
    expect(toBackfill).toHaveLength(3);
    await runConcurrent(
      toBackfill,
      4,
      async (rowPlan) => {
        await updateRow(FAKE_CONNECTION_ID, rowPlan.table.entityLogicalName, rowPlan.table.entitySetName, rowPlan.row.id, phase2Body(rowPlan));
      },
      () => false,
    );

    const intersectTables = tables.filter((t) => t.isIntersect);
    for (const table of intersectTables) {
      const checkedRows = table.rows.filter((r) => r.checked);
      await runConcurrent(
        checkedRows,
        4,
        async (row) => {
          const values = resolveIntersectRowValues(table.manyToManyInfo!, row.values);
          await insertIntersectRow(FAKE_CONNECTION_ID, TEST_ORG_URL, table.manyToManyInfo!, values);
        },
        () => false,
      );
    }

    // ---- Verify every real effect ----
    const selfRefChild = await dataverseTestRequest<Record<string, unknown>>("GET", `${selfRefEntitySet}(${childId})?$select=_${selfRefLookupField}_value`);
    expect(selfRefChild.body[`_${selfRefLookupField}_value`]).toBe(parentId);
    const selfRefParent = await dataverseTestRequest<Record<string, unknown>>("GET", `${selfRefEntitySet}(${parentId})?$select=${nameField}`);
    expect(selfRefParent.body[nameField]).toBe(`Parent ${suffix}`);

    const cycleA = await dataverseTestRequest<Record<string, unknown>>("GET", `${cycleAEntitySet}(${aId})?$select=_${cycleBLookupField}_value`);
    expect(cycleA.body[`_${cycleBLookupField}_value`]).toBe(bId);
    const cycleB = await dataverseTestRequest<Record<string, unknown>>("GET", `${cycleBEntitySet}(${bId})?$select=_${cycleALookupField}_value`);
    expect(cycleB.body[`_${cycleALookupField}_value`]).toBe(aId);

    const associated = await dataverseTestRequest<{ value: Record<string, unknown>[] }>(
      "GET",
      `${nnParentEntitySet}(${nnParentId})/${nnInfo!.entity1NavigationPropertyName}?$select=${nnOtherLogical}id`,
    );
    expect(associated.body.value.map((r) => r[`${nnOtherLogical}id`])).toContain(nnOtherId);
  }, 180_000);
});
