// @vitest-environment jsdom
//
// Real-Dataverse integration test for BPF Viewer's read path — pure GET, no write, so no
// throwaway fixtures needed: runs against whatever real, already-existing Business Process Flows
// ZaneTest happens to have (every Dataverse org ships several out-of-box ones, e.g. "Update
// Contact" on contact). Also exercises parseBpfClientData against real `clientdata` — that
// parser's own doc comment already claims to be "confirmed live against a real org", but that
// verification had never been captured as an actual regression-proof test before this file.
import { describe, expect, it } from "vitest";
import { hasTestCredentials } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { fetchBpfDefinition, fetchBusinessProcessFlows } from "./dataverseOps";
import { parseBpfClientData } from "./bpfParser";

const FAKE_CONNECTION_ID = "integration-test";

describe.skipIf(!hasTestCredentials())("BPF Viewer — real Dataverse integration (ZaneTest)", () => {
  it("fetchBusinessProcessFlows lists real, existing BPFs with the expected shape", async () => {
    installMockNativeBridge();
    try {
      const bpfs = await fetchBusinessProcessFlows(FAKE_CONNECTION_ID);
      expect(bpfs.length, "ZaneTest should have at least the standard out-of-box BPFs").toBeGreaterThan(0);
      for (const bpf of bpfs) {
        expect(bpf.workflowId).toMatch(/^[0-9a-f-]{36}$/i);
        expect(typeof bpf.name).toBe("string");
        expect(typeof bpf.primaryEntity).toBe("string");
      }
    } finally {
      uninstallMockNativeBridge();
    }
  }, 30_000);

  it("fetchBpfDefinition + parseBpfClientData handle every real category-4 process in ZaneTest without crashing", async () => {
    installMockNativeBridge();
    try {
      const bpfs = await fetchBusinessProcessFlows(FAKE_CONNECTION_ID);
      expect(bpfs.length).toBeGreaterThan(0);

      // Discovered running this test against ZaneTest: every category-4 "workflow" here (e.g.
      // "Update Contact") turns out to be a Task Flow — clientdata built from PageStep/EntityStep
      // nodes, not the StageStep nodes a real multi-stage BPF uses — even though
      // fetchBusinessProcessFlows' own BPF_CATEGORY=4 filter can't tell the two apart. Not a
      // parser bug: parseBpfClientData's job here is to degrade gracefully (0 stages +
      // unsupportedNotes explaining why) rather than crash or misparse, which is exactly what it
      // does. ZaneTest has no genuine multi-stage BPF to test the actual stage-graph output
      // against, so this asserts the graceful-degradation contract instead of stage count.
      let sawAnyRealStages = false;
      for (const bpf of bpfs) {
        const clientdata = await fetchBpfDefinition(FAKE_CONNECTION_ID, bpf.workflowId);
        expect(typeof clientdata).toBe("string");
        expect(clientdata.length).toBeGreaterThan(0);

        const graph = parseBpfClientData(clientdata);
        if (graph.stages.length > 0) {
          sawAnyRealStages = true;
          for (const stage of graph.stages) expect(stage.id.length).toBeGreaterThan(0);
        } else {
          expect(graph.unsupportedNotes.length, `"${bpf.name}" parsed to 0 stages but didn't explain why`).toBeGreaterThan(0);
        }
      }
      if (!sawAnyRealStages) {
        console.warn("[integration test] ZaneTest has no genuine multi-stage BPF (StageStep-based) — the real stage-graph parsing path is untested here.");
      }
    } finally {
      uninstallMockNativeBridge();
    }
  }, 60_000);
});
