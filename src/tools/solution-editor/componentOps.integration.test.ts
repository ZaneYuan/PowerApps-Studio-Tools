// @vitest-environment jsdom
//
// Real-Dataverse integration tests for the Solution Editor's "New / Add existing" component flows,
// run against ZaneTest's `ad_ClaudeSmokeTest` solution through the unmodified dataverseOps.ts
// functions (see testSupport/mockNativeBridge.ts). Every web resource created here is deleted in
// afterAll.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { addSolutionComponent, createWebResource, fetchSolutionComponents, publishSolutionComponents, searchComponentRecords } from "./dataverseOps";
import { ADD_EXISTING_KINDS } from "./componentCatalog";
import { WEB_RESOURCE_COMPONENT_TYPE } from "./types";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const SCRIPT_CONTENT = btoa("// created by componentOps.integration.test.ts\n");

describe.skipIf(!hasTestCredentials())("Solution Editor components — real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const createdWebResourceIds: string[] = [];
  let solutionId = "";

  beforeAll(async () => {
    installMockNativeBridge();
    const res = await dataverseTestRequest<{ value: { solutionid: string }[] }>(
      "GET",
      `solutions?$select=solutionid&$filter=uniquename eq '${SOLUTION_UNIQUE_NAME}'`,
    );
    solutionId = res.body.value[0].solutionid;
  });

  afterAll(async () => {
    for (const id of createdWebResourceIds) {
      try {
        await dataverseTestRequest("DELETE", `webresourceset(${id})`);
      } catch (err) {
        console.warn(`[integration test cleanup] 删除 web resource ${id} 失败（可能需要手动清理）：${err instanceof Error ? err.message : err}`);
      }
    }
    uninstallMockNativeBridge();
  });

  it.each(ADD_EXISTING_KINDS.map((k) => [k.key, k] as const))("Add existing picker query works for %s", async (_key, kind) => {
    const items =
      kind.source.kind === "metadata" ? await kind.source.load(FAKE_CONNECTION_ID) : await searchComponentRecords(FAKE_CONNECTION_ID, kind.source, "a");
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) expect(item.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("creates a web resource inside the solution and publishes it", async () => {
    const { webResourceId } = await createWebResource(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      name: `ad_/integrationtest/new${suffix}.js`,
      displayName: `Integration Test New ${suffix}`,
      webResourceType: 3,
      content: SCRIPT_CONTENT,
    });
    createdWebResourceIds.push(webResourceId);
    expect(webResourceId).toMatch(/^[0-9a-f-]{36}$/i);

    const components = await fetchSolutionComponents(FAKE_CONNECTION_ID, solutionId);
    const row = components.find((c) => c.componenttype === WEB_RESOURCE_COMPONENT_TYPE && c.objectid === webResourceId);
    expect(row, "the new web resource should be a component of the solution").toBeDefined();
    expect(row!.name).toBe(`ad_/integrationtest/new${suffix}.js`);

    await expect(publishSolutionComponents(FAKE_CONNECTION_ID, [], [webResourceId])).resolves.toBeUndefined();
  }, 60_000);

  it("adds an existing web resource to the solution and finds it via the picker search", async () => {
    const name = `ad_/integrationtest/existing${suffix}.js`;
    const created = await dataverseTestRequest<{ webresourceid: string }>(
      "POST",
      "webresourceset?$select=webresourceid",
      { name, displayname: name, webresourcetype: 3, content: SCRIPT_CONTENT },
      { Prefer: "return=representation" },
    );
    const webResourceId = created.body.webresourceid;
    createdWebResourceIds.push(webResourceId);

    const kind = ADD_EXISTING_KINDS.find((k) => k.key === "webresource")!;
    if (kind.source.kind !== "records") throw new Error("web resource kind should be record-backed");
    const found = await searchComponentRecords(FAKE_CONNECTION_ID, kind.source, `existing${suffix}`);
    expect(found.map((f) => f.id)).toContain(webResourceId);

    const before = await fetchSolutionComponents(FAKE_CONNECTION_ID, solutionId);
    expect(before.some((c) => c.objectid === webResourceId)).toBe(false);

    await addSolutionComponent(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, WEB_RESOURCE_COMPONENT_TYPE, webResourceId);

    const after = await fetchSolutionComponents(FAKE_CONNECTION_ID, solutionId);
    expect(after.some((c) => c.componenttype === WEB_RESOURCE_COMPONENT_TYPE && c.objectid === webResourceId)).toBe(true);
  }, 60_000);

  it("publishes tables and web resources together in one PublishXml call", async () => {
    const components = await fetchSolutionComponents(FAKE_CONNECTION_ID, solutionId);
    const tables = components.filter((c) => c.componenttype === 1 && c.logicalName).map((c) => c.logicalName!);
    await expect(publishSolutionComponents(FAKE_CONNECTION_ID, tables, createdWebResourceIds)).resolves.toBeUndefined();
  }, 120_000);
});
