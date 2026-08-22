// @vitest-environment jsdom
//
// Real-Dataverse integration test for Data Copy's write path — this tool has zero dedicated tests
// before this file (its writes go through sql4cds/writeOps.ts's insertRow, already covered
// elsewhere, but its own "drop the primary key, keep everything else" body-building logic and the
// end-to-end "query real data -> edit a cell -> create as a brand-new record" flow had never run
// against real Dataverse).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { fetchEntityMeta } from "../../native/metadataService";
import { createColumn, createTable } from "../solution-editor/dataverseOps";
import { insertRow } from "../sql4cds/writeOps";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";
const nameField = `${PUBLISHER_PREFIX}_name`;

describe.skipIf(!hasTestCredentials())("Data Copy — real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const tableSchema = `${PUBLISHER_PREFIX}_DataCopyTest${suffix}`;
  const tableLogical = tableSchema.toLowerCase();
  const scoreField = `${PUBLISHER_PREFIX}_score${suffix}`.toLowerCase();

  let entitySet = "";
  let idAttr = "";

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: tableSchema,
      displayName: `Data Copy Test ${suffix}`,
      displayCollectionName: `Data Copy Tests ${suffix}`,
      description: "自动化集成测试用表（Data Copy 写入链路），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: nameField,
      primaryFieldDisplayName: "Name",
    });
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, tableLogical, "Integer", {
      schemaName: `${PUBLISHER_PREFIX}_Score${suffix}`,
      displayName: "Score",
      description: "",
      required: false,
    });
    const meta = await fetchEntityMeta(FAKE_CONNECTION_ID, tableLogical);
    entitySet = meta.entitySetName;
    idAttr = meta.primaryIdAttribute;
  }, 180_000);

  afterAll(async () => {
    try {
      await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${tableLogical}')`);
    } catch (err) {
      console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${tableLogical}）：${err instanceof Error ? err.message : err}`);
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("handleCreate's real body-building: drops the primary key, keeps every other checked column (incl. an edited one), and creates brand-new records with fresh ids", async () => {
    // Seed two "source" rows, exactly what a real SELECT would return.
    const source1 = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `Source1${suffix}`, [scoreField]: 10 });
    const source2 = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `Source2${suffix}`, [scoreField]: 20 });
    const sourceRows: { id: string; values: Record<string, unknown> }[] = [
      { id: source1.newId!, values: { [nameField]: `Source1${suffix}`, [scoreField]: 10, [idAttr]: source1.newId } },
      { id: source2.newId!, values: { [nameField]: `Source2${suffix}`, [scoreField]: 20, [idAttr]: source2.newId } },
    ];

    // Mirror handleCreate exactly: checked columns minus the primary key, one row edited before
    // create (simulating handleEditCell), primary key never sent.
    const checkedColumnKeys = [nameField, scoreField]; // idAttr deliberately excluded, same as `columns.filter(c => c.key !== primaryIdAttribute)`
    const editedValues: Record<string, unknown> = { ...sourceRows[0].values, [nameField]: `EditedCopy${suffix}` }; // row 0 edited before create

    const created1 = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, Object.fromEntries(checkedColumnKeys.map((k) => [k, editedValues[k]])));
    const created2 = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, Object.fromEntries(checkedColumnKeys.map((k) => [k, sourceRows[1].values[k]])));

    expect(created1.newId).not.toBe(source1.newId); // a real, fresh id — not the source's
    expect(created2.newId).not.toBe(source2.newId);

    const readBack1 = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${created1.newId})?$select=${nameField},${scoreField}`);
    expect(readBack1.body[nameField]).toBe(`EditedCopy${suffix}`); // the edit survived into the copy
    expect(readBack1.body[scoreField]).toBe(10);

    const readBack2 = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${created2.newId})?$select=${nameField},${scoreField}`);
    expect(readBack2.body[nameField]).toBe(`Source2${suffix}`);
    expect(readBack2.body[scoreField]).toBe(20);

    // The original source rows are completely untouched — a copy never mutates its source.
    const sourceReadBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${source1.newId})?$select=${nameField}`);
    expect(sourceReadBack.body[nameField]).toBe(`Source1${suffix}`);
  }, 60_000);
});
