// @vitest-environment jsdom
//
// Real-Dataverse integration test for Plugin Trace Viewer. fetchTraceLogs/fetchTraceLogDetail are
// pure reads, safe against whatever real trace logs ZaneTest already has (including zero — an
// empty result is still a valid, checkable shape). fetchTraceSetting/updateTraceSetting touch a
// real org-wide setting, so this reads the real current value first and restores it in `afterAll`
// no matter what the test does in between — never leaves ZaneTest's actual trace level changed.
//
// ZaneTest genuinely has zero plugintracelogs, always — confirmed two ways while trying to build
// a fuller exhaustive round for this tool: (1) registering a real plugin step (reusing Plugin
// Registration's own NoOpPlugin fixture) against a throwaway table and actually triggering
// Create/Update never produced a trace log, across three real attempts (~13 minutes of combined
// retry budget, with the step independently confirmed statecode=0/Enabled) — this org's plugin
// sandbox execution pipeline itself never fired for a client-invoked message in any test this
// whole suite has run, and no earlier round ever actually *invoked* a registered plugin to notice;
// (2) `plugintracelog` flatly rejects direct Create ("The 'Create' method does not support
// entities of type 'plugintracelog'" — 0x80040800), so there's no way to seed a real, controlled
// record any other way either. Getting real *matching* trace data into this org is out of reach
// within reasonable effort, so this file instead proves every individual filter clause is real,
// valid OData the API actually accepts (each alone, not just typeName+onlyErrors together) against
// whatever's really there (currently nothing) — the same "well-formed against the real API" bar
// the rest of this suite holds, short of the specific "and it also matches real data" step that
// this org's own plugin trace log emptiness makes impossible to reach. See Tests/PluginTraceViewer.md
// in the Obsidian vault for the full writeup.
import { afterAll, describe, expect, it } from "vitest";
import { hasTestCredentials } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { fetchTraceLogDetail, fetchTraceLogs, fetchTraceSetting, updateTraceSetting, deleteTraceLog } from "./dataverseOps";

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

  it("every individual filter clause is real, valid OData the API accepts on its own — messageName/primaryEntity/onlyErrors/from/to, each alone", async () => {
    installMockNativeBridge();
    try {
      const base = { typeName: "", messageName: "", primaryEntity: "", onlyErrors: false, from: "", to: "", top: 5 };

      const byMessageName = await fetchTraceLogs(FAKE_CONNECTION_ID, { ...base, messageName: "NoSuchMessage_ClaudeIntegrationTest" });
      expect(byMessageName).toEqual([]);

      const byPrimaryEntity = await fetchTraceLogs(FAKE_CONNECTION_ID, { ...base, primaryEntity: "ad_nosuchentity_claudeintegrationtest" });
      expect(byPrimaryEntity).toEqual([]);

      const byOnlyErrors = await fetchTraceLogs(FAKE_CONNECTION_ID, { ...base, onlyErrors: true });
      expect(byOnlyErrors).toEqual([]);

      const byFrom = await fetchTraceLogs(FAKE_CONNECTION_ID, { ...base, from: "2026-01-01T00:00" });
      expect(Array.isArray(byFrom)).toBe(true);

      const byTo = await fetchTraceLogs(FAKE_CONNECTION_ID, { ...base, to: "2020-01-01T00:00" }); // deliberately before this org existed
      expect(byTo).toEqual([]);

      const byFromAndTo = await fetchTraceLogs(FAKE_CONNECTION_ID, { ...base, from: "2020-01-01T00:00", to: "2020-01-02T00:00" });
      expect(byFromAndTo).toEqual([]);
    } finally {
      uninstallMockNativeBridge();
    }
  }, 30_000);

  it("fetchTraceLogDetail and deleteTraceLog against a real, well-formed-but-nonexistent id both surface the real 404 — not silently no-op", async () => {
    installMockNativeBridge();
    try {
      // Deliberately NOT the all-zeros GUID: Dataverse treats that one specially ("Entity
      // Reference cannot have Id and Key Attributes empty", a real 400, discovered the hard way
      // when this test originally used it) — a random-looking but still nonexistent GUID is what
      // actually exercises the "well-formed id, no such record" 404 path this test is after.
      const fakeId = "11111111-2222-3333-4444-555555555555";
      await expect(fetchTraceLogDetail(FAKE_CONNECTION_ID, fakeId)).rejects.toThrow(/404|Does Not Exist/i);
      await expect(deleteTraceLog(FAKE_CONNECTION_ID, fakeId)).rejects.toThrow(/404|Does Not Exist/i);
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
