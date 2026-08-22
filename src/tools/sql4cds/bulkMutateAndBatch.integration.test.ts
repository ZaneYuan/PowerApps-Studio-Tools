// @vitest-environment jsdom
//
// Real-Dataverse integration tests for SQL4CDS's bulk UPDATE/DELETE (WHERE matching more than one
// row) and multi-statement batch execution (`;`-separated INSERT/UPDATE/DELETE). Every prior
// integration test in this suite only ever UPDATE/DELETE'd a single, already-known row id —
// this file exercises the real production pattern instead: parseSql -> fetchEntityMeta ->
// queryMatchingIds -> runConcurrent(updateRow/deleteRow), the exact sequence Sql4Cds.tsx's
// handleMutate/handleRunBatch use (mirrored here, not reinvented).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { fetchEntityMeta } from "../../native/metadataService";
import { createColumn, createTable } from "../solution-editor/dataverseOps";
import { deleteRow, insertRow, queryMatchingIds, updateRow } from "./writeOps";
import { literalToJsValue, parseSql, type InsertResult, type MutateResult } from "./translate";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";

/** Mirrors Sql4Cds.tsx's handleMutate exactly: resolve matching ids, build the SET body once, then
 *  PATCH/DELETE every matching row. */
async function runMutate(entitySetName: string, primaryIdAttr: string, stmt: MutateResult): Promise<string[]> {
  const { ids } = await queryMatchingIds(FAKE_CONNECTION_ID, entitySetName, primaryIdAttr, stmt.filter);
  const columnValues = stmt.action === "update" && stmt.setClauses ? Object.fromEntries(stmt.setClauses.map((s) => [s.column, literalToJsValue(s.value)])) : null;
  for (const id of ids) {
    if (stmt.action === "update") await updateRow(FAKE_CONNECTION_ID, stmt.entityLogicalName, entitySetName, id, columnValues!);
    else await deleteRow(FAKE_CONNECTION_ID, entitySetName, id);
  }
  return ids;
}

describe.skipIf(!hasTestCredentials())("SQL4CDS bulk UPDATE/DELETE + batch execution — real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const tableSchema = `${PUBLISHER_PREFIX}_Sql4CdsBulkTest${suffix}`;
  const tableLogical = tableSchema.toLowerCase();
  const scoreField = `${PUBLISHER_PREFIX}_score${suffix}`.toLowerCase();
  const nameField = `${PUBLISHER_PREFIX}_name`;

  let entitySet = "";
  let idAttr = "";

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: tableSchema,
      displayName: `SQL4CDS Bulk Test ${suffix}`,
      displayCollectionName: `SQL4CDS Bulk Tests ${suffix}`,
      description: "自动化集成测试用表（SQL4CDS 批量 UPDATE/DELETE + 批量执行），测试结束后应已自动删除",
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

  it("bulk UPDATE: a WHERE matching 3 of 5 rows updates exactly those 3, leaving the rest untouched", async () => {
    const rows = await Promise.all(
      [10, 20, 30, 40, 50].map((score) => insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `BulkUpdate${score}${suffix}`, [scoreField]: score })),
    );
    const ids = rows.map((r) => r.newId!);

    const parsed = parseSql(`UPDATE ${tableLogical} SET ${scoreField} = 999 WHERE ${scoreField} >= 20 AND ${scoreField} <= 40`);
    expect(parsed.kind).toBe("mutate");
    const updatedIds = await runMutate(entitySet, idAttr, parsed as MutateResult);
    expect(updatedIds).toHaveLength(3);

    const readBack = await Promise.all(ids.map((id) => dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${id})?$select=${scoreField}`)));
    const scores = readBack.map((r) => r.body[scoreField]);
    expect(scores).toEqual([10, 999, 999, 999, 50]);
  }, 60_000);

  it("bulk DELETE: a WHERE matching multiple rows deletes exactly those, leaving the rest", async () => {
    const rows = await Promise.all(
      [1, 2, 3].map((n) => insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `BulkDelete${n}${suffix}`, [scoreField]: 777 })),
    );
    const keeper = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `BulkDeleteKeep${suffix}`, [scoreField]: 111 });

    const parsed = parseSql(`DELETE FROM ${tableLogical} WHERE ${scoreField} = 777`);
    expect(parsed.kind).toBe("mutate");
    const deletedIds = await runMutate(entitySet, idAttr, parsed as MutateResult);
    expect(deletedIds).toHaveLength(3);

    for (const r of rows) {
      await expect(dataverseTestRequest("GET", `${entitySet}(${r.newId})`)).rejects.toThrow(/404|Does Not Exist/i);
    }
    const keeperReadBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${keeper.newId})?$select=${scoreField}`);
    expect(keeperReadBack.body[scoreField]).toBe(111);
  }, 60_000);

  it("a `;`-separated batch of INSERT/UPDATE/DELETE parses to kind:\"batch\" and executes every statement in order against real data", async () => {
    const seed = await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, { [nameField]: `BatchSeed${suffix}`, [scoreField]: 1 });

    const sql =
      `INSERT INTO ${tableLogical} (${nameField}, ${scoreField}) VALUES ('BatchInserted${suffix}', 5);` +
      `UPDATE ${tableLogical} SET ${scoreField} = 2 WHERE ${idAttr} = '${seed.newId}';` +
      `DELETE FROM ${tableLogical} WHERE ${nameField} = 'BatchInserted${suffix}';`;

    const parsed = parseSql(sql);
    expect(parsed.kind).toBe("batch");
    const statements = (parsed as { kind: "batch"; statements: (InsertResult | MutateResult)[] }).statements;
    expect(statements.map((s) => s.kind)).toEqual(["insert", "mutate", "mutate"]);

    for (const stmt of statements) {
      if (stmt.kind === "insert") {
        for (const row of stmt.rows) {
          const columnValues: Record<string, unknown> = {};
          stmt.columns.forEach((col, i) => (columnValues[col] = literalToJsValue(row[i])));
          await insertRow(FAKE_CONNECTION_ID, tableLogical, entitySet, columnValues);
        }
      } else {
        await runMutate(entitySet, idAttr, stmt);
      }
    }

    const seedReadBack = await dataverseTestRequest<Record<string, unknown>>("GET", `${entitySet}(${seed.newId})?$select=${scoreField}`);
    expect(seedReadBack.body[scoreField]).toBe(2);

    const stillThere = await dataverseTestRequest<{ value: unknown[] }>("GET", `${entitySet}?$filter=${nameField} eq 'BatchInserted${suffix}'`);
    expect(stillThere.body.value).toEqual([]); // inserted by statement 1, deleted by statement 3
  }, 60_000);

  it("a batch containing a SELECT is rejected at parse time (read+write mix has no single result shape)", () => {
    const parsed = parseSql(`INSERT INTO ${tableLogical} (${nameField}) VALUES ('x'); SELECT ${nameField} FROM ${tableLogical};`);
    expect(parsed.kind).toBe("error");
  });

  it("a batch where one statement itself fails to parse reports which statement number", () => {
    const parsed = parseSql(`INSERT INTO ${tableLogical} (${nameField}) VALUES ('x'); THIS IS NOT VALID SQL;`);
    expect(parsed.kind).toBe("error");
    expect((parsed as { error: string }).error).toContain("第 2 条");
  });
});
