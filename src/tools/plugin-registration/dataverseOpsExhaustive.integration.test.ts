// @vitest-environment jsdom
//
// Exhaustive real-Dataverse integration tests for Plugin Registration, filling in the branches
// dataverseOps.integration.test.ts (续15) didn't reach: Stage x Mode combinations, multiple
// images of different types coexisting on one step, org-level (no primaryEntity) message steps,
// real filteringAttributes, every Deployment value, deleteTypeCascade in isolation, and
// registering more than one type in a single registerAssembly call. Reuses the same real,
// strong-named, IPlugin-implementing fixture DLL as dataverseOps.integration.test.ts (two real
// types: NoOpPlugin, SecondPlugin) — see that file's header comment and
// testFixtures/ClaudeIntegrationTestPlugin.source.cs for why a fake assembly won't survive
// contact with the real API.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { createTable, publishAll } from "../solution-editor/dataverseOps";
import {
  deleteAssemblyCascade,
  deleteTypeCascade,
  fetchAllPluginTypes,
  fetchAllSteps,
  fetchImages,
  fetchMessageFilters,
  fetchMessages,
  fetchPluginTypes,
  fetchSteps,
  fetchStepDetail,
  registerAssembly,
  registerImage,
  registerStep,
  type AssemblyInspectionResult,
} from "./dataverseOps";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";
const DLL_PATH = resolve(process.cwd(), "src/tools/plugin-registration/testFixtures/ClaudeIntegrationTestPlugin.dll");
const TYPE_NAME_1 = "ClaudeIntegrationTestPlugin.NoOpPlugin";
const TYPE_NAME_2 = "ClaudeIntegrationTestPlugin.SecondPlugin";

describe.skipIf(!hasTestCredentials())("Plugin Registration — exhaustive real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const tableSchema = `${PUBLISHER_PREFIX}_PluginRegExhTest${suffix}`;
  const tableLogical = tableSchema.toLowerCase();
  const dllBase64 = readFileSync(DLL_PATH).toString("base64");

  let assemblyId: string;
  let typeId1: string;
  let typeId2: string;
  let updateMessageId: string;
  let updateFilterId: string;

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: tableSchema,
      displayName: `Plugin Reg Exh Test ${suffix}`,
      displayCollectionName: `Plugin Reg Exh Tests ${suffix}`,
      description: "自动化集成测试用表（Plugin Registration 穷尽测试），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: `${PUBLISHER_PREFIX}_name`,
      primaryFieldDisplayName: "Name",
    });
    await publishAll(FAKE_CONNECTION_ID);

    // registerAssembly with BOTH real types selected in one call — 续15 only ever selected one
    // type at registration time (the second type was added later via updateAssembly).
    const inspection: AssemblyInspectionResult = {
      name: `ClaudeIntegrationTestPluginExh${suffix}`,
      version: "1.0.0.0",
      culture: "neutral",
      publicKeyToken: "d6706004015b6e60",
      contentBase64: dllBase64,
      pluginTypes: [
        { typeName: TYPE_NAME_1, friendlyName: "No Op Plugin" },
        { typeName: TYPE_NAME_2, friendlyName: "Second Plugin" },
      ],
    };
    const assembly = await registerAssembly(FAKE_CONNECTION_ID, inspection, new Set([TYPE_NAME_1, TYPE_NAME_2]));
    assemblyId = assembly.pluginassemblyid;

    const types = await fetchPluginTypes(FAKE_CONNECTION_ID, assemblyId);
    expect(types.map((t) => t.typename)).toEqual(expect.arrayContaining([TYPE_NAME_1, TYPE_NAME_2]));
    typeId1 = types.find((t) => t.typename === TYPE_NAME_1)!.plugintypeid;
    typeId2 = types.find((t) => t.typename === TYPE_NAME_2)!.plugintypeid;

    const messages = await fetchMessages(FAKE_CONNECTION_ID);
    const updateMessage = messages.find((m) => m.name === "Update");
    expect(updateMessage).toBeDefined();
    updateMessageId = updateMessage!.sdkmessageid;
    const filters = await fetchMessageFilters(FAKE_CONNECTION_ID, updateMessageId);
    const filter = filters.find((f) => f.primaryobjecttypecode === tableLogical);
    expect(filter).toBeDefined();
    updateFilterId = filter!.sdkmessagefilterid;
  }, 180_000);

  afterAll(async () => {
    // A plain DELETE on pluginassemblies fails outright while any plugintypes (and their own
    // steps/images/secureconfigs) still hang off it — this test registers plenty of those, so
    // cleanup must go through the real cascade, not a bare delete. A silently-swallowed
    // `.catch(() => {})` here (an earlier version of this file's own mistake) hid exactly that
    // failure with zero warning, leaving a real orphaned assembly with no trace in the test
    // output — warn loudly instead so a real leftover is never invisible again.
    if (assemblyId) {
      await deleteAssemblyCascade(FAKE_CONNECTION_ID, assemblyId).catch((err: unknown) => {
        console.warn(`[integration test cleanup] 级联删除测试程序集失败（可能需要手动清理 ${assemblyId}）：${err instanceof Error ? err.message : err}`);
      });
    }
    try {
      await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${tableLogical}')`);
    } catch (err) {
      console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${tableLogical}）：${err instanceof Error ? err.message : err}`);
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("registerAssembly with two selected types in one call creates both real plugintypes rows", async () => {
    const types = await fetchPluginTypes(FAKE_CONNECTION_ID, assemblyId);
    expect(types.map((t) => t.typename).sort()).toEqual([TYPE_NAME_1, TYPE_NAME_2].sort());
  }, 30_000);

  it("Stage x Mode: Pre-validation/Pre-operation/Post-operation all accept Synchronous; Post-operation also accepts Asynchronous", async () => {
    const combos: { stage: number; mode: number; label: string }[] = [
      { stage: 10, mode: 0, label: "PreValidation-Sync" },
      { stage: 20, mode: 0, label: "PreOperation-Sync" },
      { stage: 40, mode: 0, label: "PostOperation-Sync" },
      { stage: 40, mode: 1, label: "PostOperation-Async" },
    ];
    for (const combo of combos) {
      const step = await registerStep(FAKE_CONNECTION_ID, {
        pluginTypeId: typeId1,
        pluginTypeName: TYPE_NAME_1,
        messageId: updateMessageId,
        messageName: "Update",
        filterId: updateFilterId,
        primaryEntity: tableLogical,
        stage: combo.stage,
        mode: combo.mode,
        rank: 1,
        filteringAttributes: "",
        unsecureConfig: "",
        secureConfig: "",
        deployment: 0,
      });
      const detail = await fetchStepDetail(FAKE_CONNECTION_ID, step.sdkmessageprocessingstepid);
      expect(detail.stage, combo.label).toBe(combo.stage);
      expect(detail.mode, combo.label).toBe(combo.mode);
    }
  }, 60_000);

  it("Pre-validation stage rejects Asynchronous mode — a real platform rule, not this app's own validation", async () => {
    await expect(
      registerStep(FAKE_CONNECTION_ID, {
        pluginTypeId: typeId1,
        pluginTypeName: TYPE_NAME_1,
        messageId: updateMessageId,
        messageName: "Update",
        filterId: updateFilterId,
        primaryEntity: tableLogical,
        stage: 10,
        mode: 1,
        rank: 1,
        filteringAttributes: "",
        unsecureConfig: "",
        secureConfig: "",
        deployment: 0,
      }),
    ).rejects.toThrow();
  }, 30_000);

  it("Deployment: ServerOnly(0) round-trips; ClientOnly(1) and Both(2) are both really rejected by this cloud org", async () => {
    const step = await registerStep(FAKE_CONNECTION_ID, {
      pluginTypeId: typeId1,
      pluginTypeName: TYPE_NAME_1,
      messageId: updateMessageId,
      messageName: "Update",
      filterId: updateFilterId,
      primaryEntity: tableLogical,
      stage: 40,
      mode: 0,
      rank: 1,
      filteringAttributes: "",
      unsecureConfig: "",
      secureConfig: "",
      deployment: 0,
    });
    const detail = await fetchStepDetail(FAKE_CONNECTION_ID, step.sdkmessageprocessingstepid);
    expect(detail.supporteddeployment).toBe(0);

    // Confirmed against a live org (isolated with a dedicated probe before writing this
    // assertion — the failure doesn't say which deployment value it's about): ClientOnly(1) AND
    // Both(2) are BOTH rejected here ("Supported deployment does not agree with message
    // availability"), not just the deprecated ClientOnly value — a modern cloud-only Dataverse
    // org's Update message simply has no client-deployment availability at all, so *any*
    // supporteddeployment value that includes the client side (1 and 2 both do) is refused. Not
    // this app's own validation — a real platform rule.
    for (const deployment of [1, 2]) {
      await expect(
        registerStep(FAKE_CONNECTION_ID, {
          pluginTypeId: typeId1,
          pluginTypeName: TYPE_NAME_1,
          messageId: updateMessageId,
          messageName: "Update",
          filterId: updateFilterId,
          primaryEntity: tableLogical,
          stage: 40,
          mode: 0,
          rank: 1,
          filteringAttributes: "",
          unsecureConfig: "",
          secureConfig: "",
          deployment,
        }),
        `deployment=${deployment}`,
      ).rejects.toThrow();
    }
  }, 60_000);

  it("filteringAttributes really limits the step to real field names", async () => {
    const step = await registerStep(FAKE_CONNECTION_ID, {
      pluginTypeId: typeId1,
      pluginTypeName: TYPE_NAME_1,
      messageId: updateMessageId,
      messageName: "Update",
      filterId: updateFilterId,
      primaryEntity: tableLogical,
      stage: 40,
      mode: 0,
      rank: 1,
      filteringAttributes: `${PUBLISHER_PREFIX}_name`,
      unsecureConfig: "",
      secureConfig: "",
      deployment: 0,
    });
    const detail = await fetchStepDetail(FAKE_CONNECTION_ID, step.sdkmessageprocessingstepid);
    expect(detail.filteringattributes).toBe(`${PUBLISHER_PREFIX}_name`);
  }, 30_000);

  it("a step can hold a real Pre Image AND a real Post Image at once (the common Update-message pattern)", async () => {
    const step = await registerStep(FAKE_CONNECTION_ID, {
      pluginTypeId: typeId1,
      pluginTypeName: TYPE_NAME_1,
      messageId: updateMessageId,
      messageName: "Update",
      filterId: updateFilterId,
      primaryEntity: tableLogical,
      stage: 40,
      mode: 0,
      rank: 1,
      filteringAttributes: "",
      unsecureConfig: "",
      secureConfig: "",
      deployment: 0,
    });
    const preImage = await registerImage(FAKE_CONNECTION_ID, {
      stepId: step.sdkmessageprocessingstepid,
      alias: `Pre${suffix}`,
      imageType: 0,
      messagePropertyName: "Target",
      attributes: "",
    });
    const postImage = await registerImage(FAKE_CONNECTION_ID, {
      stepId: step.sdkmessageprocessingstepid,
      alias: `Post${suffix}`,
      imageType: 1,
      messagePropertyName: "Target",
      attributes: "",
    });
    const images = await fetchImages(FAKE_CONNECTION_ID, step.sdkmessageprocessingstepid);
    expect(images.map((i) => i.sdkmessageprocessingstepimageid).sort()).toEqual(
      [preImage.sdkmessageprocessingstepimageid, postImage.sdkmessageprocessingstepimageid].sort(),
    );
    expect(new Set(images.map((i) => i.imagetype))).toEqual(new Set([0, 1]));
  }, 30_000);

  it("imagetype=2 (Pre & Post Image, 'Both') registers on its own step", async () => {
    const step = await registerStep(FAKE_CONNECTION_ID, {
      pluginTypeId: typeId1,
      pluginTypeName: TYPE_NAME_1,
      messageId: updateMessageId,
      messageName: "Update",
      filterId: updateFilterId,
      primaryEntity: tableLogical,
      stage: 40,
      mode: 0,
      rank: 1,
      filteringAttributes: "",
      unsecureConfig: "",
      secureConfig: "",
      deployment: 0,
    });
    const bothImage = await registerImage(FAKE_CONNECTION_ID, {
      stepId: step.sdkmessageprocessingstepid,
      alias: `Both${suffix}`,
      imageType: 2,
      messagePropertyName: "Target",
      attributes: "",
    });
    const images = await fetchImages(FAKE_CONNECTION_ID, step.sdkmessageprocessingstepid);
    expect(images).toHaveLength(1);
    expect(images[0].sdkmessageprocessingstepimageid).toBe(bothImage.sdkmessageprocessingstepimageid);
    expect(images[0].imagetype).toBe(2);
  }, 30_000);

  it("org-level (no primaryEntity) messages: fetchMessageFilters shape, and system-protected messages really reject custom steps", async () => {
    const messages = await fetchMessages(FAKE_CONNECTION_ID);
    const whoAmI = messages.find((m) => m.name === "WhoAmI");
    expect(whoAmI, "WhoAmI should exist as a real org-wide SDK message").toBeDefined();

    // Confirms/clarifies a real behavior this app's own doc comment guesses at ("empty result
    // means an org-level message"): in this org, WhoAmI's own sdkmessagefilters row exists with
    // primaryobjecttypecode "none" rather than the filter list being empty — not a bug, just the
    // real shape, worth locking in since registerStep's own primaryEntity/filterId handling
    // depends on the caller (the UI layer) recognizing this correctly.
    const filters = await fetchMessageFilters(FAKE_CONNECTION_ID, whoAmI!.sdkmessageid);
    expect(filters.some((f) => f.primaryobjecttypecode === "none")).toBe(true);

    // Confirmed against a live org: WhoAmI is a system-protected message and really rejects a
    // custom step ("Custom SdkMessageProcessingStep ... is not allowed on the message with
    // SdkMessageId ...") — a real platform rule, not something reachable/testable through this
    // app's own code path with a throwaway org-level message (custom org-level "no primaryEntity"
    // messages in Dataverse are user-defined Actions, out of scope for a metadata-only test
    // fixture here).
    await expect(
      registerStep(FAKE_CONNECTION_ID, {
        pluginTypeId: typeId1,
        pluginTypeName: TYPE_NAME_1,
        messageId: whoAmI!.sdkmessageid,
        messageName: "WhoAmI",
        filterId: null,
        primaryEntity: null,
        stage: 20,
        mode: 0,
        rank: 1,
        filteringAttributes: "",
        unsecureConfig: "",
        secureConfig: "",
        deployment: 0,
      }),
    ).rejects.toThrow(/not allowed/i);
  }, 30_000);

  it("fetchAllPluginTypes and fetchAllSteps (the org-wide search-dropdown queries) include our real records", async () => {
    const allTypes = await fetchAllPluginTypes(FAKE_CONNECTION_ID);
    expect(allTypes.some((t) => t.plugintypeid === typeId1)).toBe(true);
    expect(allTypes.find((t) => t.plugintypeid === typeId1)?._pluginassemblyid_value).toBe(assemblyId);

    const allSteps = await fetchAllSteps(FAKE_CONNECTION_ID);
    const stepsForType1 = await fetchSteps(FAKE_CONNECTION_ID, typeId1);
    expect(stepsForType1.length).toBeGreaterThan(0);
    const oneStepId = stepsForType1[0].sdkmessageprocessingstepid;
    expect(allSteps.some((s) => s.sdkmessageprocessingstepid === oneStepId)).toBe(true);
    expect(allSteps.find((s) => s.sdkmessageprocessingstepid === oneStepId)?._eventhandler_value).toBe(typeId1);
  }, 60_000);

  it("deleteTypeCascade removes only its own type's steps, leaving the sibling type and the assembly intact", async () => {
    // type2 has no steps registered yet in this file — give it one so the cascade has something
    // real to remove.
    const step = await registerStep(FAKE_CONNECTION_ID, {
      pluginTypeId: typeId2,
      pluginTypeName: TYPE_NAME_2,
      messageId: updateMessageId,
      messageName: "Update",
      filterId: updateFilterId,
      primaryEntity: tableLogical,
      stage: 40,
      mode: 0,
      rank: 1,
      filteringAttributes: "",
      unsecureConfig: "",
      secureConfig: "",
      deployment: 0,
    });

    await deleteTypeCascade(FAKE_CONNECTION_ID, typeId2);

    await expect(dataverseTestRequest("GET", `plugintypes(${typeId2})`)).rejects.toThrow(/404|Does Not Exist/i);
    await expect(dataverseTestRequest("GET", `sdkmessageprocessingsteps(${step.sdkmessageprocessingstepid})`)).rejects.toThrow(/404|Does Not Exist/i);

    // type1 and the assembly itself must survive — deleteTypeCascade is scoped to one type only.
    const type1ReadBack = await dataverseTestRequest("GET", `plugintypes(${typeId1})`);
    expect(type1ReadBack.status).toBe(200);
    const assemblyReadBack = await dataverseTestRequest("GET", `pluginassemblies(${assemblyId})`);
    expect(assemblyReadBack.status).toBe(200);
  }, 60_000);
});
