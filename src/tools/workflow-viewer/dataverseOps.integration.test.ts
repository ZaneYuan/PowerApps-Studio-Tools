// @vitest-environment jsdom
//
// Read-only: lists ZaneTest's real processes and runs every definition through the parsers.
// Zero steps is a valid result — system Actions only define a message and some drafts are empty.
import { describe, expect, it } from "vitest";
import { hasTestCredentials } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { fetchWorkflowDefinition, fetchWorkflows } from "./dataverseOps";
import { parseWorkflowXaml } from "./xamlParser";
import { parseFlowClientData } from "./flowParser";

const FAKE_CONNECTION_ID = "integration-test";

describe.skipIf(!hasTestCredentials())("Workflow Viewer — real Dataverse integration (ZaneTest)", () => {
  it("lists processes with formatted labels and parses every definition", async () => {
    installMockNativeBridge();
    try {
      const workflows = await fetchWorkflows(FAKE_CONNECTION_ID);
      expect(workflows.length).toBeGreaterThan(0);
      for (const w of workflows) {
        expect([0, 2, 3, 5]).toContain(w.category);
        expect(w.stateLabel).not.toBe("");
      }

      const failures: string[] = [];
      for (const w of workflows) {
        const definition = await fetchWorkflowDefinition(FAKE_CONNECTION_ID, w.workflowId);
        try {
          if (w.category === 5) {
            if (definition.clientData) parseFlowClientData(definition.clientData);
          } else if (definition.xaml) {
            parseWorkflowXaml(definition.xaml);
          }
        } catch (err) {
          failures.push(`${w.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      expect(failures).toEqual([]);
    } finally {
      uninstallMockNativeBridge();
    }
  }, 300_000);
});
