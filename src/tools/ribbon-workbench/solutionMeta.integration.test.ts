// @vitest-environment jsdom
//
// Real-Dataverse integration test for the one pair of Ribbon Workbench dataverseOps.ts functions
// no existing test ever exercised against a real org: fetchUnmanagedSolutions (the top "pick a
// solution" dropdown) and fetchSolutionEntities (the "pick a table already in that solution"
// dropdown it gates). Both are plain reads, but fetchSolutionEntities' own real shape (an
// EntityDefinitions round-trip keyed off solutioncomponents.objectid, sorted by displayName) had
// never been proven against a real solution.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { createTable, publishAll } from "../solution-editor/dataverseOps";
import { fetchSolutionEntities, fetchUnmanagedSolutions } from "./dataverseOps";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";

describe.skipIf(!hasTestCredentials())("Ribbon Workbench — solution/entity metadata reads (real ZaneTest)", () => {
  const suffix = testRunSuffix();
  const tableSchema = `${PUBLISHER_PREFIX}_RibbonSolMetaTest${suffix}`;
  const tableLogical = tableSchema.toLowerCase();
  let solutionId = "";

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: tableSchema,
      displayName: `Ribbon Sol Meta Test ${suffix}`,
      displayCollectionName: `Ribbon Sol Meta Tests ${suffix}`,
      description: "自动化集成测试用表（Ribbon Workbench 的 solution/entity 元数据读取），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: `${PUBLISHER_PREFIX}_name`,
      primaryFieldDisplayName: "Name",
    });
    await publishAll(FAKE_CONNECTION_ID);
    const sol = await dataverseTestRequest<{ value: { solutionid: string }[] }>(
      "GET",
      `solutions?$select=solutionid&$filter=uniquename eq '${SOLUTION_UNIQUE_NAME}'`,
    );
    solutionId = sol.body.value[0].solutionid;
  }, 180_000);

  afterAll(async () => {
    try {
      await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${tableLogical}')`);
    } catch (err) {
      console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${tableLogical}）：${err instanceof Error ? err.message : err}`);
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("fetchUnmanagedSolutions includes the real, already-known-good ad_ClaudeSmokeTest solution", async () => {
    const solutions = await fetchUnmanagedSolutions(FAKE_CONNECTION_ID);
    expect(solutions.some((s) => s.uniquename === SOLUTION_UNIQUE_NAME)).toBe(true);
    const match = solutions.find((s) => s.uniquename === SOLUTION_UNIQUE_NAME)!;
    expect(match.solutionid).toBe(solutionId);
    expect(match.friendlyname.length).toBeGreaterThan(0);
  }, 30_000);

  it("fetchSolutionEntities resolves the real, freshly-created table's logical/display name from real solutioncomponents + EntityDefinitions", async () => {
    const entities = await fetchSolutionEntities(FAKE_CONNECTION_ID, solutionId);
    const match = entities.find((e) => e.logicalName === tableLogical);
    expect(match, `expected ${tableLogical} to be a real solution component of ${SOLUTION_UNIQUE_NAME}`).toBeDefined();
    expect(match!.displayName).toBe(`Ribbon Sol Meta Test ${suffix}`);

    // Sorted by displayName — verify against the real result, not just a same-order assumption.
    const sorted = [...entities].sort((a, b) => a.displayName.localeCompare(b.displayName));
    expect(entities.map((e) => e.logicalName)).toEqual(sorted.map((e) => e.logicalName));
  }, 30_000);
});
