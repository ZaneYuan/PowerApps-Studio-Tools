// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowListItem } from "./types";

function fixture(name: string): string {
  return readFileSync(resolve(process.cwd(), "src/tools/workflow-viewer/testFixtures", name), "utf8");
}

const base: Omit<WorkflowListItem, "workflowId" | "name" | "category"> = {
  uniqueName: "",
  primaryEntity: "contoso_enrollment",
  primaryEntityLabel: "Enrollment",
  stateCode: 1,
  stateLabel: "Activated",
  mode: 0,
  ownerName: "SYSTEM",
  modifiedOn: "2026-09-01T00:00:00Z",
  description: "",
  triggerOnCreate: false,
  triggerOnDelete: false,
  triggerOnUpdateAttributeList: "statuscode",
  createStage: null,
  updateStage: null,
  deleteStage: null,
  onDemand: false,
  subprocess: false,
  scopeLabel: "Organization",
  runAsLabel: "Calling User",
};

const workflows: WorkflowListItem[] = [
  { ...base, workflowId: "w1", name: "Auto Send Request Reminder Email", category: 0 },
  { ...base, workflowId: "f1", name: "Transfer Direction", category: 5, primaryEntity: "none", triggerOnUpdateAttributeList: null },
];

vi.mock("../../native/bridge", () => ({ isNativeBridgeAvailable: () => true }));
vi.mock("../../native/activeConnection", () => ({ useActiveConnection: () => ({ activeConnectionId: "c1" }) }));
vi.mock("./dataverseOps", () => ({
  fetchWorkflows: vi.fn(async () => workflows),
  fetchWorkflowDefinition: vi.fn(async (_c: string, id: string) =>
    id === "w1"
      ? { xaml: fixture("reminder-email.workflow.xaml"), clientData: null }
      : { xaml: null, clientData: fixture("transfer-direction.flow.json") },
  ),
}));

const { default: WorkflowViewer } = await import("./WorkflowViewer");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<WorkflowViewer />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function select(name: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(name))!;
  await act(async () => button.click());
}

describe("WorkflowViewer", () => {
  it("filters the list by category", async () => {
    const flowChip = [...container.querySelectorAll("button")].find((b) => b.textContent === "云端流 1")!;
    await act(async () => flowChip.click());
    expect(container.textContent).toContain("Transfer Direction");
    expect(container.textContent).not.toContain("Auto Send Request Reminder Email");
  });

  it("shows a classic workflow's trigger and step tree", async () => {
    await select("Auto Send Request Reminder Email");
    expect(container.textContent).toContain("字段更新时：statuscode");
    expect(container.textContent).toContain("后台（异步）");
    expect(container.textContent).toContain("If new flow and status is Request Sent");
    expect(container.textContent).toContain("Contoso.Crm.Plugins.WorkflowActivities.CallWebApiAction");
  });

  it("shows a cloud flow's trigger and nested actions", async () => {
    await select("Transfer Direction");
    expect(container.textContent).toContain("Request / Button");
    expect(container.textContent).toContain("Apply to each 2");
    expect(container.textContent).toContain("shared_commondataserviceforapps · ListRecords");
  });
});
