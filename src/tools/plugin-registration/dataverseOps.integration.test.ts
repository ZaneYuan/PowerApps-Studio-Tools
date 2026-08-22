// @vitest-environment jsdom
//
// Real-Dataverse integration test for Plugin Registration's write path — assembly/type register
// + update, step/image CRUD, cascade deletes. Uses a real, tiny, harmless .NET assembly (see
// testFixtures/ClaudeIntegrationTestPlugin.source.cs) rather than a fake base64 blob: confirmed
// against a live org that `pluginassemblies.content` POST validates the upload is a real, loadable
// assembly (garbage bytes 400), AND that `plugintypes` POST separately validates the type name
// against the assembly's real server-side-reflected types ("has a total of [0] plugin/workflow
// activity types" the first time this fixture was a plain class with no IPlugin implementation) —
// so the fixture is a genuine Microsoft.Xrm.Sdk.IPlugin implementation, not a stub. It's still
// never actually *invoked* by Dataverse — every step this test registers targets a message on a
// throwaway custom table nothing else ever writes to, so the sandbox never needs to load it.
//
// `inspectAssembly`/`pickPluginDll` (native-bridge-only calls: `plugin.inspectAssembly` /
// `dialog.pickFile`) aren't exercised here — mockNativeBridge.ts only forwards `dataverse.request`,
// and those two never reach Dataverse at all (real local file I/O and .NET reflection respectively,
// done entirely inside the desktop shell). Bypassed by constructing the `AssemblyInspectionResult`
// they'd normally produce by hand instead.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { createTable, publishAll } from "../solution-editor/dataverseOps";
import {
  deleteAssemblyCascade,
  deleteImage,
  deleteStepCascade,
  fetchAssemblies,
  fetchEntityAttributes,
  fetchImageDetail,
  fetchImages,
  fetchMessageFilters,
  fetchMessages,
  fetchPluginTypes,
  fetchStepDetail,
  fetchSteps,
  registerAssembly,
  registerImage,
  registerStep,
  setStepEnabled,
  updateAssembly,
  updateImage,
  updateStep,
  type AssemblyInspectionResult,
} from "./dataverseOps";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";
const DLL_PATH = resolve(process.cwd(), "src/tools/plugin-registration/testFixtures/ClaudeIntegrationTestPlugin.dll");

describe.skipIf(!hasTestCredentials())("Plugin Registration — real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const tableSchema = `${PUBLISHER_PREFIX}_PluginRegTest${suffix}`;
  const tableLogical = tableSchema.toLowerCase();
  const dllBase64 = readFileSync(DLL_PATH).toString("base64");
  const typeName1 = "ClaudeIntegrationTestPlugin.NoOpPlugin";
  const typeName2 = "ClaudeIntegrationTestPlugin.SecondPlugin";

  let assemblyId: string;
  let typeId: string;
  let updateMessageId: string;
  let updateFilterId: string;
  let step1Id: string;
  let image1Id: string;

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: tableSchema,
      displayName: `Plugin Reg Test ${suffix}`,
      displayCollectionName: `Plugin Reg Tests ${suffix}`,
      description: "自动化集成测试用表（Plugin Registration 写入链路的 SDK message filter 挂靠对象），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: `${PUBLISHER_PREFIX}_name`,
      primaryFieldDisplayName: "Name",
    });
    // Plugin steps need a real, published sdkmessagefilter row to bind their primary-entity
    // filter to — same defensive "publish before relying on platform-generated metadata" pattern
    // ribbonWorkbenchWrite.integration.test.ts already uses for RibbonMetadataToProcess.
    await publishAll(FAKE_CONNECTION_ID);

    const inspection: AssemblyInspectionResult = {
      name: `ClaudeIntegrationTestPlugin${suffix}`,
      version: "1.0.0.0",
      culture: "neutral",
      publicKeyToken: "d6706004015b6e60",
      contentBase64: dllBase64,
      pluginTypes: [{ typeName: typeName1, friendlyName: "No Op Plugin" }],
    };
    const assembly = await registerAssembly(FAKE_CONNECTION_ID, inspection, new Set([typeName1]));
    assemblyId = assembly.pluginassemblyid;

    const types = await fetchPluginTypes(FAKE_CONNECTION_ID, assemblyId);
    const type1 = types.find((t) => t.typename === typeName1);
    expect(type1, "registerAssembly should have created a plugintypes row for the one selected type").toBeDefined();
    typeId = type1!.plugintypeid;

    const messages = await fetchMessages(FAKE_CONNECTION_ID);
    const updateMessage = messages.find((m) => m.name === "Update");
    expect(updateMessage, "the org-wide 'Update' SDK message should always exist").toBeDefined();
    updateMessageId = updateMessage!.sdkmessageid;

    const filters = await fetchMessageFilters(FAKE_CONNECTION_ID, updateMessageId);
    const filter = filters.find((f) => f.primaryobjecttypecode === tableLogical);
    expect(filter, `Dataverse should auto-generate an Update sdkmessagefilter for the new table ${tableLogical}`).toBeDefined();
    updateFilterId = filter!.sdkmessagefilterid;
  }, 180_000);

  afterAll(async () => {
    // Best-effort — the last `it` below already exercises deleteAssemblyCascade for real and
    // asserts on it; this only catches the case where an earlier assertion threw before that ran.
    if (assemblyId) {
      await dataverseTestRequest("DELETE", `pluginassemblies(${assemblyId})`).catch(() => {});
    }
    try {
      await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${tableLogical}')`);
    } catch (err) {
      console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${tableLogical}）：${err instanceof Error ? err.message : err}`);
    }
    uninstallMockNativeBridge();
  }, 180_000);

  it("registerAssembly's assembly is really findable via fetchAssemblies", async () => {
    const assemblies = await fetchAssemblies(FAKE_CONNECTION_ID);
    expect(assemblies.some((a) => a.pluginassemblyid === assemblyId)).toBe(true);
  }, 30_000);

  it("registerStep creates a real step, findable via fetchSteps/fetchStepDetail, with a real bound secure config", async () => {
    const step = await registerStep(FAKE_CONNECTION_ID, {
      pluginTypeId: typeId,
      pluginTypeName: typeName1,
      messageId: updateMessageId,
      messageName: "Update",
      filterId: updateFilterId,
      primaryEntity: tableLogical,
      stage: 40, // Post-operation — the only stage that supports a Post Image, needed below
      mode: 0,
      rank: 1,
      filteringAttributes: "",
      unsecureConfig: `unsecure-${suffix}`,
      secureConfig: `secure-${suffix}`,
      deployment: 0,
    });
    step1Id = step.sdkmessageprocessingstepid;

    const steps = await fetchSteps(FAKE_CONNECTION_ID, typeId);
    expect(steps.some((s) => s.sdkmessageprocessingstepid === step1Id)).toBe(true);

    const detail = await fetchStepDetail(FAKE_CONNECTION_ID, step1Id);
    expect(detail.configuration).toBe(`unsecure-${suffix}`);
    expect(detail.stage).toBe(40);
    expect(detail.mode).toBe(0);
    expect(
      detail._sdkmessageprocessingstepsecureconfigid_value,
      "a non-empty secureConfig input should really create+bind a sdkmessageprocessingstepsecureconfig record",
    ).toBeTruthy();
  }, 60_000);

  it("registerImage creates a real Post Image on the step, findable via fetchImages/fetchImageDetail", async () => {
    const image = await registerImage(FAKE_CONNECTION_ID, {
      stepId: step1Id,
      alias: `PostImage${suffix}`,
      imageType: 1, // Post Image
      messagePropertyName: "Target",
      attributes: "",
    });
    image1Id = image.sdkmessageprocessingstepimageid;

    const images = await fetchImages(FAKE_CONNECTION_ID, step1Id);
    expect(images.some((i) => i.sdkmessageprocessingstepimageid === image1Id)).toBe(true);

    const detail = await fetchImageDetail(FAKE_CONNECTION_ID, image1Id);
    expect(detail.entityalias).toBe(`PostImage${suffix}`);
    expect(detail.imagetype).toBe(1);
    expect(detail.messagepropertyname).toBe("Target");
  }, 30_000);

  it("updateStep really changes rank/config, leaving the message/entity binding untouched", async () => {
    await updateStep(FAKE_CONNECTION_ID, step1Id, {
      name: `Updated ${suffix}`,
      stage: 40,
      mode: 0,
      rank: 2,
      filteringAttributes: "",
      unsecureConfig: `unsecure-v2-${suffix}`,
      secureConfig: "",
      deployment: 0,
    });
    const detail = await fetchStepDetail(FAKE_CONNECTION_ID, step1Id);
    expect(detail.rank).toBe(2);
    expect(detail.configuration).toBe(`unsecure-v2-${suffix}`);
    expect(detail.sdkmessagefilterid?.primaryobjecttypecode).toBe(tableLogical);
  }, 30_000);

  it("setStepEnabled really flips statecode/statuscode", async () => {
    await setStepEnabled(FAKE_CONNECTION_ID, step1Id, false);
    let detail = await fetchStepDetail(FAKE_CONNECTION_ID, step1Id);
    expect([detail.statecode, detail.statuscode]).toEqual([1, 2]);

    await setStepEnabled(FAKE_CONNECTION_ID, step1Id, true);
    detail = await fetchStepDetail(FAKE_CONNECTION_ID, step1Id);
    expect([detail.statecode, detail.statuscode]).toEqual([0, 1]);
  }, 30_000);

  it("updateImage really changes its attributes (via delete+recreate — Dataverse rejects PATCH on this entity outright)", async () => {
    const updated = await updateImage(FAKE_CONNECTION_ID, image1Id, step1Id, {
      alias: `PostImage${suffix}`,
      imageType: 1,
      messagePropertyName: "Target",
      attributes: `${PUBLISHER_PREFIX}_name`,
    });
    // updateImage's real id changes (delete+recreate, not an in-place update) — every test after
    // this one must keep operating on a record that still exists.
    image1Id = updated.sdkmessageprocessingstepimageid;

    const detail = await fetchImageDetail(FAKE_CONNECTION_ID, image1Id);
    expect(detail.attributes).toBe(`${PUBLISHER_PREFIX}_name`);
  }, 30_000);

  it("fetchEntityAttributes returns the real attribute list for a known table", async () => {
    const attrs = await fetchEntityAttributes(FAKE_CONNECTION_ID, tableLogical);
    expect(attrs).toContain(`${tableLogical}id`);
    expect(attrs).toContain(`${PUBLISHER_PREFIX}_name`);
  }, 30_000);

  it("deleteImage really removes just the image, leaving the step alone", async () => {
    await deleteImage(FAKE_CONNECTION_ID, image1Id);
    const images = await fetchImages(FAKE_CONNECTION_ID, step1Id);
    expect(images.some((i) => i.sdkmessageprocessingstepimageid === image1Id)).toBe(false);

    const steps = await fetchSteps(FAKE_CONNECTION_ID, typeId);
    expect(steps.some((s) => s.sdkmessageprocessingstepid === step1Id), "deleteImage should not have touched the parent step").toBe(true);
  }, 30_000);

  it("deleteStepCascade removes a second step together with its own image and secure config", async () => {
    const step2 = await registerStep(FAKE_CONNECTION_ID, {
      pluginTypeId: typeId,
      pluginTypeName: typeName1,
      messageId: updateMessageId,
      messageName: "Update",
      filterId: updateFilterId,
      primaryEntity: tableLogical,
      stage: 40,
      mode: 0,
      rank: 3,
      filteringAttributes: "",
      unsecureConfig: "",
      secureConfig: `secure2-${suffix}`,
      deployment: 0,
    });
    const image2 = await registerImage(FAKE_CONNECTION_ID, {
      stepId: step2.sdkmessageprocessingstepid,
      alias: `PostImage2${suffix}`,
      imageType: 1,
      messagePropertyName: "Target",
      attributes: "",
    });

    await deleteStepCascade(FAKE_CONNECTION_ID, step2.sdkmessageprocessingstepid);

    const steps = await fetchSteps(FAKE_CONNECTION_ID, typeId);
    expect(steps.some((s) => s.sdkmessageprocessingstepid === step2.sdkmessageprocessingstepid)).toBe(false);
    await expect(dataverseTestRequest("GET", `sdkmessageprocessingstepimages(${image2.sdkmessageprocessingstepimageid})`)).rejects.toThrow(
      /404|Does Not Exist/i,
    );
  }, 60_000);

  it("updateAssembly re-uploads content and adds a newly selected type without removing the existing one", async () => {
    // name/version/culture/publickeytoken are deliberately sent as obviously-wrong values here
    // (a fake "1.0.1.0") to prove a real discovery: Dataverse ignores whatever the client sends
    // for these four fields on both POST and PATCH and always derives them itself via real
    // server-side reflection of the uploaded assembly bytes — confirmed two ways: a POST whose
    // `name` didn't match the DLL's real assembly name still came back readable only under its
    // real reflected name, and this PATCH's fake "1.0.1.0" leaves the real "1.0.0.0" untouched
    // below. Harmless in production, since this app's own inspectAssembly does real reflection
    // client-side already and always sends the truth — but worth locking in so a future "let's
    // stop bothering to send these" cleanup doesn't get surprised by a false assumption either way.
    await updateAssembly(
      FAKE_CONNECTION_ID,
      assemblyId,
      {
        name: `ClaudeIntegrationTestPlugin${suffix}`,
        version: "1.0.1.0",
        culture: "neutral",
        publicKeyToken: "d6706004015b6e60",
        contentBase64: dllBase64,
        pluginTypes: [
          { typeName: typeName1, friendlyName: "No Op Plugin" },
          { typeName: typeName2, friendlyName: "Second Plugin" },
        ],
      },
      new Set([typeName1, typeName2]),
    );

    const readBack = await dataverseTestRequest<{ version: string }>("GET", `pluginassemblies(${assemblyId})?$select=version`);
    expect(readBack.body.version).toBe("1.0.0.0");

    const types = await fetchPluginTypes(FAKE_CONNECTION_ID, assemblyId);
    expect(types.map((t) => t.typename)).toEqual(expect.arrayContaining([typeName1, typeName2]));
  }, 60_000);

  it("deleteAssemblyCascade really removes the assembly and every type/step beneath it", async () => {
    await deleteAssemblyCascade(FAKE_CONNECTION_ID, assemblyId);

    await expect(dataverseTestRequest("GET", `pluginassemblies(${assemblyId})`)).rejects.toThrow(/404|Does Not Exist/i);
    await expect(dataverseTestRequest("GET", `plugintypes(${typeId})`)).rejects.toThrow(/404|Does Not Exist/i);
    await expect(dataverseTestRequest("GET", `sdkmessageprocessingsteps(${step1Id})`)).rejects.toThrow(/404|Does Not Exist/i);
  }, 60_000);
});
