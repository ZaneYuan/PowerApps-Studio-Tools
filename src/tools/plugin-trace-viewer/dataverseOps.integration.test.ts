// @vitest-environment jsdom
//
// Real-Dataverse integration test for Plugin Trace Viewer. fetchTraceLogs/fetchTraceLogDetail are
// pure reads, safe against whatever real trace logs ZaneTest already has (including zero — an
// empty result is still a valid, checkable shape). fetchTraceSetting/updateTraceSetting touch a
// real org-wide setting, so this reads the real current value first and restores it in `afterAll`
// no matter what the test does in between — never leaves ZaneTest's actual trace level changed.
import { afterAll, describe, expect, it } from "vitest";
import { hasTestCredentials } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { fetchTraceLogs, fetchTraceSetting, updateTraceSetting } from "./dataverseOps";

const FAKE_CONNECTION_ID = "integration-test";

describe.skipIf(!hasTestCredentials())("Plugin Trace Viewer — real Dataverse integration (ZaneTest)", () => {
  let originalSetting: { organizationId: string; value: number } | null = null;

  afterAll(async () => {
    if (originalSetting) {
      installMockNativeBridge();
      try {
        await updateTraceSetting(FAKE_CONNECTION_ID, originalSetting.organizationId, originalSetting.value);
      } finally {
        uninstallMockNativeBridge();
      }
    }
  }, 30_000);

  it("fetchTraceLogs queries real plugintracelogs with filters and returns a well-shaped (possibly empty) list", async () => {
    installMockNativeBridge();
    try {
      const logs = await fetchTraceLogs(FAKE_CONNECTION_ID, {
        typeName: "",
        messageName: "",
        primaryEntity: "",
        onlyErrors: false,
        from: "",
        to: "",
        top: 10,
      });
      expect(Array.isArray(logs)).toBe(true);
      for (const log of logs) {
        expect(log.plugintracelogid).toMatch(/^[0-9a-f-]{36}$/i);
      }

      // A real contains()-based filter combination — proves the OData query itself is well-formed
      // against the real API, whether or not it happens to match anything right now.
      const filtered = await fetchTraceLogs(FAKE_CONNECTION_ID, {
        typeName: "NoSuchPluginType_ClaudeIntegrationTest",
        messageName: "",
        primaryEntity: "",
        onlyErrors: true,
        from: "",
        to: "",
        top: 5,
      });
      expect(filtered).toEqual([]);
    } finally {
      uninstallMockNativeBridge();
    }
  }, 30_000);

  it("fetchTraceSetting reads the real org setting, and updateTraceSetting really changes then restores it", async () => {
    installMockNativeBridge();
    try {
      const before = await fetchTraceSetting(FAKE_CONNECTION_ID);
      originalSetting = { organizationId: before.organizationid, value: before.plugintracelogsetting };

      // 0 = Off, 1 = Exception, 2 = All — pick whichever isn't the current value so the write is
      // provably real, not a no-op PATCH of the same number.
      const differentValue = before.plugintracelogsetting === 0 ? 1 : 0;
      await updateTraceSetting(FAKE_CONNECTION_ID, before.organizationid, differentValue);

      const after = await fetchTraceSetting(FAKE_CONNECTION_ID);
      expect(after.plugintracelogsetting).toBe(differentValue);

      await updateTraceSetting(FAKE_CONNECTION_ID, before.organizationid, before.plugintracelogsetting);
      const restored = await fetchTraceSetting(FAKE_CONNECTION_ID);
      expect(restored.plugintracelogsetting).toBe(before.plugintracelogsetting);
      originalSetting = null; // already restored inline — afterAll doesn't need to do it again
    } finally {
      uninstallMockNativeBridge();
    }
  }, 30_000);
});
