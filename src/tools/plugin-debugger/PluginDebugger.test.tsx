// @vitest-environment jsdom
// decoded-create-task.json is ProfilerHost's real `decode` output for a profile captured in
// ZaneTest (Create of task, post-operation).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecodedProfile } from "./types";

const decoded = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/tools/plugin-debugger/testFixtures/decoded-create-task.json"), "utf8"),
) as DecodedProfile;

const ops = vi.hoisted(() => ({
  fetchProfilerEnvironment: vi.fn(),
  isProfilerInstalled: vi.fn(),
  fetchProfilingSteps: vi.fn(),
  fetchProfiles: vi.fn(),
  fetchProfileContent: vi.fn(),
  decodeProfile: vi.fn(),
  replayProfile: vi.fn(),
  searchCustomSteps: vi.fn(),
  startProfiling: vi.fn(),
  stopProfiling: vi.fn(),
  installProfiler: vi.fn(),
  uninstallProfiler: vi.fn(),
  deleteProfile: vi.fn(),
  pickPluginAssembly: vi.fn(),
}));

vi.mock("./dataverseOps", () => ops);
vi.mock("../../native/bridge", () => ({ isNativeBridgeAvailable: () => true }));
vi.mock("../../native/activeConnection", () => ({ useActiveConnection: () => ({ activeConnectionId: "c1" }) }));
vi.mock("../../shared/ConfirmDialog", () => ({ useConfirmDialog: () => async () => true }));

const { default: PluginDebugger } = await import("./PluginDebugger");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<PluginDebugger />));
}

function button(label: string): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
}

beforeEach(() => {
  for (const fn of Object.values(ops)) fn.mockReset();
  ops.fetchProfilerEnvironment.mockResolvedValue({ prtDirectory: "C:\\prt\\tools", hostAvailable: true });
  ops.fetchProfilingSteps.mockResolvedValue([]);
  ops.fetchProfiles.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PluginDebugger", () => {
  it("offers to install the Profiler when the environment doesn't have it", async () => {
    ops.isProfilerInstalled.mockResolvedValueOnce(false).mockResolvedValue(true);
    await render();
    expect(container.textContent).toContain("当前环境还没有安装 Profiler");
    await act(async () => button("安装 Profiler").click());
    expect(ops.installProfiler).toHaveBeenCalledWith("c1");
    expect(container.textContent).toContain("当前环境已安装 Profiler");
  });

  it("starts profiling a searched custom step", async () => {
    ops.isProfilerInstalled.mockResolvedValue(true);
    ops.searchCustomSteps.mockResolvedValue([
      { stepId: "s1", name: "Contoso.Plugins.OnCreate: Create of account", stage: 40, mode: 0, enabled: true, typeName: "Contoso.Plugins.OnCreate" },
    ]);
    await render();
    const input = container.querySelector<HTMLInputElement>("input[placeholder^='按 Step 名称']")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "OnCreate");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.form!.requestSubmit());
    expect(ops.searchCustomSteps).toHaveBeenCalledWith("c1", "OnCreate");
    await act(async () => button("开始抓取").click());
    expect(ops.startProfiling).toHaveBeenCalledWith("c1", "s1");
  });

  it("decodes a selected profile into the execution context view", async () => {
    ops.isProfilerInstalled.mockResolvedValue(true);
    ops.fetchProfiles.mockResolvedValue([
      {
        profileId: "p1",
        typeName: decoded.typeName,
        messageName: "Create",
        primaryEntity: "task",
        depth: 1,
        executionDurationMs: 0,
        createdOn: "2026-09-22T14:56:47Z",
      },
    ]);
    ops.fetchProfileContent.mockResolvedValue("compressed-profile");
    ops.decodeProfile.mockResolvedValue(decoded);
    await render();
    const row = [...container.querySelectorAll("tr")].find((r) => r.textContent?.includes("ClaudeIntegrationTestPlugin.NoOpPlugin"))!;
    await act(async () => row.click());
    expect(ops.decodeProfile).toHaveBeenCalledWith("compressed-profile");
    expect(container.textContent).toContain("40 Post-operation");
    expect(container.textContent).toContain("InputParameters");
    expect(container.textContent).toContain("safe to delete");
    expect(container.textContent).toContain("ParentContext（Create · Stage 30）");
  });
});
