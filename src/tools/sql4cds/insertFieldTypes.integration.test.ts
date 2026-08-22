// @vitest-environment jsdom
//
// Real-Dataverse integration tests exhaustively covering SQL4CDS INSERT across every basic
// Dataverse field type — String/Memo and Boolean/Lookup were already covered by
// writeOps.integration.test.ts; this file fills in Integer, Money, DateTime, MultiSelectPicklist,
// BigInt, NULL handling per type, and the Lookup-with-multiple-candidates rejection path
// (buildRowBody's "无法唯一确定它指向哪个实体" branch, never exercised before — needs a genuinely
// polymorphic Lookup, which no throwaway table can produce, so this uses the real OOB
// `annotation.objectid` field, read-only: buildRowBody throws before any network call for this
// case, so nothing is ever written to `annotation`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { fetchEntityMeta } from "../../native/metadataService";
import { createColumn, createTable } from "../solution-editor/dataverseOps";
import { buildRowBody, insertRow } from "./writeOps";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";

describe.skipIf(!hasTestCredentials())("SQL4CDS INSERT — exhaustive field types, real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const tableSchema = `${PUBLISHER_PREFIX}_Sql4CdsInsertTypes${suffix}`;
  const tableLogical = tableSchema.toLowerCase();
  const nameField = `${PUBLISHER_PREFIX}_name`;
  const intField = `${PUBLISHER_PREFIX}_int${suffix}`.toLowerCase();
  const moneyField = `${PUBLISHER_PREFIX}_money${suffix}`.toLowerCase();
  const dateField = `${PUBLISHER_PREFIX}_date${suffix}`.toLowerCase();
  const multiField = `${PUBLISHER_PREFIX}_multi${suffix}`.toLowerCase();
  const bigField = `${PUBLISHER_PREFIX}_big${suffix}`.toLowerCase();

  let entitySet = "";
  let multiOptionX = -1;
  let multiOptionY = -1;

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: tableSchema,
      displayName: `SQL4CDS Insert Types ${suffix}`,
      displayCollectionName: `SQL4CDS Insert Types ${suffix}`,
      description: "自动化集成测试用表（SQL4CDS INSERT 字段类型穷尽），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: nameField,
      primaryFieldDisplayName: "Name",
    });
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, tableLogical, "Integer", {
      schemaName: `${PUBLISHER_PREFIX}_Int${suffix}`,
      displayName: "Int",
      description: "",
      required: false,
    });
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, tableLogical, "Money", {
      schemaName: `${PUBLISHER_PREFIX}_Money${suffix}`,
      displayName: "Money",
      description: "",
      required: false,
    });
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, tableLogical, "DateTime", {
      schemaName: `${PUBLISHER_PREFIX}_Date${suffix}`,
      displayName: "Date",
      description: "",
      required: false,
      dateFormat: "DateOnly",
    });
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, tableLogical, "MultiSelectPicklist", {
      schemaName: `${PUBLISHER_PREFIX}_Multi${suffix}`,
      displayName: "Multi",
      description: "",
      required: false,
      options: ["OptionX", "OptionY"],
    });
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, tableLogical, "BigInt", {
      schemaName: `${PUBLISHER_PREFIX}_Big${suffix}`,
      displayName: "Big",
      description: "",
      required: false,
    });

    const meta = await fetchEntityMeta(FAKE_CONNECTION_ID, tableLogical);
    entitySet = meta.entitySetName;

    const optionSetRes = await dataverseTestRequest<{ OptionSet: { Options: { Value: number; Label: { UserLocalizedLabel: { Label: string } } }[] } }>(
      "GET",
      `EntityDefinitions(LogicalName='${tableLogical}')/Attributes(LogicalName='${multiField}')/Microsoft.Dynamics.CRM.MultiSelectPicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet`,
    );
    const options = optionSetRes.body.OptionSet.Options;
    multiOptionX = options.find((o) => o.Label.UserLocalizedLabel.Label === "OptionX")!.Value;
    multiOptionY = options.find((o) => o.Label.UserLocalizedLabel.Label === "OptionY")!.Value;
  }, 180_000);

  afterAll(async () => {
    try {
      await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${tableLogical}')`);
    } catch (err) {
      console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${tableLogical}）：${err instanceof Error ? err.message : err}`);
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("Integer: writes and reads back a real number, and NULL", async () => {
    const created = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `Int${suffix}`, [intField]: 42 });
    const readBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${created.newId})?$select=${intField}`);
    expect(readBack.body[intField]).toBe(42);

    const nullRow = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `IntNull${suffix}`, [intField]: null });
    const nullReadBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${nullRow.newId})?$select=${intField}`);
    expect(nullReadBack.body[intField]).toBeNull();
  }, 30_000);

  it("Money: writes and reads back a decimal value without losing precision, and NULL", async () => {
    const created = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `Money${suffix}`, [moneyField]: 12699.5 });
    const readBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${created.newId})?$select=${moneyField}`);
    expect(readBack.body[moneyField]).toBeCloseTo(12699.5, 2);

    const nullRow = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `MoneyNull${suffix}`, [moneyField]: null });
    const nullReadBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${nullRow.newId})?$select=${moneyField}`);
    expect(nullReadBack.body[moneyField]).toBeNull();
  }, 30_000);

  it("DateTime (DateOnly): writes and reads back a real date string, and NULL", async () => {
    const created = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `Date${suffix}`, [dateField]: "2026-03-15" });
    const readBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${created.newId})?$select=${dateField}`);
    expect(String(readBack.body[dateField])).toContain("2026-03-15");

    const nullRow = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `DateNull${suffix}`, [dateField]: null });
    const nullReadBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${nullRow.newId})?$select=${dateField}`);
    expect(nullReadBack.body[dateField]).toBeNull();
  }, 30_000);

  it("MultiSelectPicklist: writes a comma-separated option-value string and reads back both selections", async () => {
    const created = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, {
      [nameField]: `Multi${suffix}`,
      [multiField]: `${multiOptionX},${multiOptionY}`,
    });
    const readBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${created.newId})?$select=${multiField}`);
    const values = String(readBack.body[multiField]).split(",").map(Number);
    expect(new Set(values)).toEqual(new Set([multiOptionX, multiOptionY]));
  }, 30_000);

  it("BigInt: writes and reads back a real large integer, and NULL", async () => {
    const created = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `Big${suffix}`, [bigField]: 123456789012345 });
    const readBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${created.newId})?$select=${bigField}`);
    expect(readBack.body[bigField]).toBe(123456789012345);

    const nullRow = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `BigNull${suffix}`, [bigField]: null });
    const nullReadBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${nullRow.newId})?$select=${bigField}`);
    expect(nullReadBack.body[bigField]).toBeNull();
  }, 30_000);

  it("Lookup with more than one relationship candidate is rejected by buildRowBody before any write — never silently guesses", async () => {
    // annotation.objectid is a real, genuinely polymorphic OOB Lookup (40 candidate target
    // entities) — buildRowBody's unresolvable-candidate check throws before ever building a
    // request, so this never touches a real annotation record.
    await expect(buildRowBody(FAKE_CONNECTION_ID, "annotation", { objectid: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(
      /无法唯一确定它指向哪个实体/,
    );
  }, 30_000);
});
