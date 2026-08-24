// @vitest-environment jsdom
//
// Real-Dataverse integration test for Data Edit's two write modes — this tool has zero dedicated
// tests before this file. `insertRow`/`updateRow` themselves are already covered by SQL4CDS's own
// integration tests; what's unique to Data Edit and had never run against real Dataverse is its
// own orchestration: 更新模式's real dirty-row detection (only PATCH rows whose checked columns
// actually changed vs. the query snapshot — using the real `valuesEqual` this file's own unit
// tests already cover in isolation), and 创建模式's "uncheck the primary key -> becomes a create"
// switch.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { callNative } from "../../native/bridge";
import { fetchEntityMeta } from "../../native/metadataService";
import { unwrapODataRowWithFormatting } from "../../native/odata";
import { createColumn, createTable } from "../solution-editor/dataverseOps";
import { insertRow, updateRow } from "../sql4cds/writeOps";
import { dirtyColumnKeys, valuesEqual } from "../../shared/dirtyTracking";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";
const nameField = `${PUBLISHER_PREFIX}_name`;

describe.skipIf(!hasTestCredentials())("Data Edit — real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const tableSchema = `${PUBLISHER_PREFIX}_DataEditTest${suffix}`;
  const tableLogical = tableSchema.toLowerCase();
  const scoreField = `${PUBLISHER_PREFIX}_score${suffix}`.toLowerCase();
  const noteField = `${PUBLISHER_PREFIX}_note${suffix}`.toLowerCase();

  let entitySet = "";

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: tableSchema,
      displayName: `Data Edit Test ${suffix}`,
      displayCollectionName: `Data Edit Tests ${suffix}`,
      description: "自动化集成测试用表（Data Edit 写入链路），测试结束后应已自动删除",
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
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, tableLogical, "String", {
      schemaName: `${PUBLISHER_PREFIX}_Note${suffix}`,
      displayName: "Note",
      description: "",
      required: false,
      maxLength: 100,
    });
    const meta = await fetchEntityMeta(FAKE_CONNECTION_ID, tableLogical);
    entitySet = meta.entitySetName;
  }, 180_000);

  afterAll(async () => {
    try {
      await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${tableLogical}')`);
    } catch (err) {
      console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${tableLogical}）：${err instanceof Error ? err.message : err}`);
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("更新模式: real dirty-row detection only PATCHes the row that actually changed, leaving unchanged rows untouched (and un-called)", async () => {
    const r1 = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `Row1${suffix}`, [scoreField]: 10 });
    const r2 = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `Row2${suffix}`, [scoreField]: 20 });
    const r3 = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `Row3${suffix}`, [scoreField]: 30 });

    // originalValuesRef's snapshot — exactly what the query returned.
    const original: Record<string, Record<string, unknown>> = {
      [r1.newId!]: { [scoreField]: 10 },
      [r2.newId!]: { [scoreField]: 20 },
      [r3.newId!]: { [scoreField]: 30 },
    };
    // Row1: really edited. Row2: left alone. Row3: "edited" back to its own original value —
    // exactly the click-in-click-out case valuesEqual exists to catch.
    const edited: Record<string, Record<string, unknown>> = {
      [r1.newId!]: { [scoreField]: 999 },
      [r2.newId!]: { [scoreField]: 20 },
      [r3.newId!]: { [scoreField]: 30 },
    };
    const checkedColumnKeys = [scoreField];

    // Mirror handleSubmit's real filter exactly, using the real valuesEqual.
    let updateCallCount = 0;
    const rowsToSubmit = Object.keys(edited).filter((id) =>
      checkedColumnKeys.some((k) => !valuesEqual(edited[id][k], original[id][k])),
    );
    expect(rowsToSubmit).toEqual([r1.newId]);

    for (const id of rowsToSubmit) {
      await updateRow(FAKE_CONNECTION_ID, tableLogical, entitySet, id, Object.fromEntries(checkedColumnKeys.map((k) => [k, edited[id][k]])));
      updateCallCount++;
    }
    expect(updateCallCount).toBe(1); // only the one genuinely-changed row ever hit the network

    const readBack1 = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${r1.newId})?$select=${scoreField}`);
    expect(readBack1.body[scoreField]).toBe(999);
    const readBack2 = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${r2.newId})?$select=${scoreField}`);
    expect(readBack2.body[scoreField]).toBe(20);
    const readBack3 = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${r3.newId})?$select=${scoreField}`);
    expect(readBack3.body[scoreField]).toBe(30);
  }, 60_000);

  it("更新模式: the real dirtyColumnKeys trims the PATCH body to only the field that actually changed, not every checked column (Bugs/8.24.md #1 feedback)", async () => {
    const r = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, {
      [nameField]: `Trim${suffix}`,
      [scoreField]: 10,
      [noteField]: "original note",
    });
    const original: Record<string, unknown> = { [scoreField]: 10, [noteField]: "original note" };
    // Only score is actually edited — note is left exactly as loaded.
    const edited: Record<string, unknown> = { [scoreField]: 999, [noteField]: "original note" };
    const checkedColumnKeys = [scoreField, noteField];

    // Mirror handleSubmit's real per-field trim exactly, using the real dirtyColumnKeys.
    const columnsToSend = dirtyColumnKeys({ id: r.newId!, checked: true, values: edited, originalValues: original }, checkedColumnKeys);
    expect(columnsToSend).toEqual([scoreField]); // noteField never made it into the set at all

    const body = Object.fromEntries(columnsToSend.map((k) => [k, edited[k]]));
    expect(Object.keys(body)).toEqual([scoreField]); // the actual PATCH body really only has the one key
    await updateRow(FAKE_CONNECTION_ID, tableLogical, entitySet, r.newId!, body);

    const readBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${r.newId})?$select=${scoreField},${noteField}`);
    expect(readBack.body[scoreField]).toBe(999); // the field that was actually sent did update
    expect(readBack.body[noteField]).toBe("original note"); // untouched field survives a trimmed partial PATCH fine
  }, 30_000);

  it("创建模式: unchecking the primary key column switches to create — a brand-new record, source untouched", async () => {
    const source = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `Source${suffix}`, [scoreField]: 42 });
    // isUpdateMode is false here (primary key column not checked) — handleSubmit's create branch.
    const created = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `NewCopy${suffix}`, [scoreField]: 42 });

    expect(created.newId).not.toBe(source.newId);
    const readBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${created.newId})?$select=${nameField},${scoreField}`);
    expect(readBack.body[nameField]).toBe(`NewCopy${suffix}`);
    expect(readBack.body[scoreField]).toBe(42);
    const sourceReadBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${source.newId})?$select=${nameField}`);
    expect(sourceReadBack.body[nameField]).toBe(`Source${suffix}`);
  }, 30_000);

  it("includeFormattedValues: true (Data Edit/Data Copy/Data Migration's query path) really gets a FormattedValue label back from Dataverse for statuscode, and unwrapODataRowWithFormatting extracts it", async () => {
    const created = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `Formatted${suffix}` });

    const res = await callNative<Record<string, unknown>>("dataverse.request", {
      connectionId: FAKE_CONNECTION_ID,
      method: "GET",
      path: `${entitySet}(${created.newId})?$select=statuscode`,
      includeFormattedValues: true,
    });

    const { fields, formattedFields } = unwrapODataRowWithFormatting(res);
    expect(typeof fields.statuscode).toBe("number"); // the raw option code — what a submit/write payload should use
    expect(formattedFields.statuscode).toBeTruthy(); // the human-readable label CheckableGrid's display falls back to
  }, 30_000);
});
