// @vitest-environment jsdom
//
// Real-Dataverse integration test for Ribbon Workbench's full write path — the one piece flagged
// in 03-Roadmap-待办.md as still uncovered after the read-path test (effectiveRibbon.integration.test.ts).
// Exercises export -> writeRibbonDiffXml -> import -> wait -> publish exactly the way
// RibbonWorkbench.tsx's own handleSave does, using the real customActions.ts builders
// (buildHideCustomAction, buildAddButtonCustomAction) completely unmodified.
//
// Creates a fresh throwaway table for this run rather than reusing Claude Test Table: a
// <HideCustomAction> cannot be cleanly removed once installed in a solution layer (Dataverse's
// own documented limitation — see 03-Roadmap-待办.md), so the only clean way to keep ZaneTest tidy
// across repeated runs is to delete the whole table afterward, which takes the ribbon
// customization with it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { createTable, publishAll } from "../solution-editor/dataverseOps";
import {
  exportSolutionZip,
  fetchEffectiveRibbonCompressed,
  importSolutionZip,
  publishEntity,
  waitForImportJobCompletion,
} from "./dataverseOps";
import { decompressRibbonXml, parseRibbonTree } from "./effectiveRibbon";
import { appendIntoContainer, buildAddButtonCustomAction, buildHideCustomAction } from "./customActions";
import { readRibbonDiffXml, writeRibbonDiffXml } from "./ribbonXml";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";

describe.skipIf(!hasTestCredentials())("Ribbon Workbench — real write path (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const tableSchemaName = `${PUBLISHER_PREFIX}_RibbonWriteTest${suffix}`;
  const tableLogicalName = tableSchemaName.toLowerCase();

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: tableSchemaName,
      displayName: `Ribbon Write Test ${suffix}`,
      displayCollectionName: `Ribbon Write Tests ${suffix}`,
      description: "自动化集成测试用表（Ribbon Workbench 写入链路），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: `${PUBLISHER_PREFIX}_name`,
      primaryFieldDisplayName: "Name",
    });
    // Ribbon processing reads from published state (Dataverse has a whole async
    // "RibbonMetadataToProcess" pipeline behind it) — publish once right after creating the table
    // so RetrieveEntityRibbon has something real to return before this test starts editing it.
    await publishAll(FAKE_CONNECTION_ID);
  }, 180_000);

  afterAll(async () => {
    try {
      await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${tableLogicalName}')`);
    } catch (err) {
      console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${tableLogicalName}）：${err instanceof Error ? err.message : err}`);
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("hides a real inherited button and adds a new JS-function button, then both changes are visible in the real effective ribbon", async () => {
    // 1. Find a real button to hide, from the actual effective (merged template + customization)
    //    ribbon this brand-new table already has via Mscrm.Templates.
    const beforeCompressed = await fetchEffectiveRibbonCompressed(FAKE_CONNECTION_ID, tableLogicalName);
    const beforeXml = await decompressRibbonXml(beforeCompressed);
    const beforeTabs = parseRibbonTree(beforeXml);
    const allControls = beforeTabs.flatMap((t) => t.groups.flatMap((g) => g.controls));
    const targetControl = allControls.find((c) => c.id);
    expect(targetControl, "a brand-new table's inherited ribbon should have at least one real, addressable control to hide").toBeDefined();
    const targetGroup = beforeTabs.flatMap((t) => t.groups).find((g) => g.id && g.controls.length > 0);
    expect(targetGroup, "expected at least one real Group with an id to anchor the new button to").toBeDefined();

    // 2. Build both edits with the real, unmodified customActions.ts builders and stage them into
    //    the table's RibbonDiffXml exactly the way RibbonWorkbench.tsx's guided forms do.
    const zip = await exportSolutionZip(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME);
    const originalRibbonDiffXml = await readRibbonDiffXml(zip, tableLogicalName);

    const hideFragment = buildHideCustomAction({ hideActionId: `${targetControl!.id}.Hide${suffix}`, location: targetControl!.id! });
    const { customAction, commandDefinition } = buildAddButtonCustomAction({
      customActionId: `${PUBLISHER_PREFIX}.${tableLogicalName}.NewButton${suffix}.CustomAction`,
      // A Group's own direct children are <Controls>/<Layout>/<Sizes>, not raw buttons — the
      // real insertion point is the Group's nested <Controls> element (see
      // customActions.ts's own AddButtonParams.location doc comment for the full story).
      location: `${targetGroup!.id}.Controls._children`,
      commandId: `${PUBLISHER_PREFIX}.${tableLogicalName}.NewButton${suffix}.Command`,
      buttonId: `${PUBLISHER_PREFIX}.${tableLogicalName}.NewButton${suffix}.Button`,
      labelText: `Integration Test Button ${suffix}`,
      webResourceName: "ad_integrationtest.js",
      functionName: "IntegrationTest.run",
    });

    let updatedRibbonDiffXml = appendIntoContainer(originalRibbonDiffXml, "CustomActions", [hideFragment, customAction]);
    updatedRibbonDiffXml = appendIntoContainer(updatedRibbonDiffXml, "CommandDefinitions", [commandDefinition]);

    // 3. Save exactly the way handleSave does: re-export fresh (avoid clobbering concurrent
    //    edits), patch, import, wait, publish.
    const freshZip = await exportSolutionZip(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME);
    const patchedZip = await writeRibbonDiffXml(freshZip, tableLogicalName, updatedRibbonDiffXml);
    const importJobId = await importSolutionZip(FAKE_CONNECTION_ID, patchedZip);
    await waitForImportJobCompletion(FAKE_CONNECTION_ID, importJobId);
    await publishEntity(FAKE_CONNECTION_ID, tableLogicalName);

    // 4. Verify both effects against a *fresh* real RetrieveEntityRibbon call — not just that the
    //    RibbonDiffXml text contains what we wrote (that part is already unit-tested), but that
    //    Dataverse actually processed and now serves the changed ribbon.
    const afterCompressed = await fetchEffectiveRibbonCompressed(FAKE_CONNECTION_ID, tableLogicalName);
    const afterXml = await decompressRibbonXml(afterCompressed);
    const afterTabs = parseRibbonTree(afterXml);
    const afterControls = afterTabs.flatMap((t) => t.groups.flatMap((g) => g.controls));

    expect(afterControls.some((c) => c.id === targetControl!.id), `hidden control ${targetControl!.id} should no longer appear in the effective ribbon`).toBe(false);
    const newControl = afterControls.find((c) => c.id === `${PUBLISHER_PREFIX}.${tableLogicalName}.NewButton${suffix}.Button`);
    expect(newControl, "the newly added button should now appear in the effective ribbon").toBeDefined();
    expect(newControl!.labelText).toBe(`Integration Test Button ${suffix}`);
    expect(newControl!.command).toBe(`${PUBLISHER_PREFIX}.${tableLogicalName}.NewButton${suffix}.Command`);
  }, 300_000);
});
