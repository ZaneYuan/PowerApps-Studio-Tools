// @vitest-environment jsdom
import { act, forwardRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfirmOptions } from "../../shared/ConfirmDialog";

const ops = vi.hoisted(() => ({
  deleteAssemblyCascade: vi.fn(),
  deleteImage: vi.fn(),
  deleteStepCascade: vi.fn(),
  deleteTypeCascade: vi.fn(),
  fetchImageDetail: vi.fn(),
  fetchPluginTypes: vi.fn(),
  fetchRecordDetail: vi.fn(),
  fetchStepDetail: vi.fn(),
  fetchSteps: vi.fn(),
  setStepEnabled: vi.fn(),
}));
const confirm = vi.hoisted(() => vi.fn<(options: ConfirmOptions) => Promise<boolean>>());
const reloadRoot = vi.hoisted(() => vi.fn());

vi.mock("./dataverseOps", () => ops);
vi.mock("../../native/bridge", () => ({ isNativeBridgeAvailable: () => true }));
vi.mock("../../native/activeConnection", () => ({ useActiveConnection: () => ({ activeConnectionId: "c1" }) }));
vi.mock("../../shared/ConfirmDialog", () => ({ useConfirmDialog: () => confirm }));
vi.mock("./TreePanel", () => ({
  default: forwardRef(function TreePanel(props: { onSelect: (kind: string, id: string) => void }, ref) {
    useImperativeHandle(ref, () => ({ reloadRoot, invalidateChildrenOf: vi.fn() }));
    return <button onClick={() => props.onSelect("assembly", "asm-1")}>select-assembly</button>;
  }),
}));

const { default: PluginRegistration } = await import("./PluginRegistration");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
}

async function selectAssembly(detail: Record<string, unknown>) {
  ops.fetchRecordDetail.mockResolvedValue(detail);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<PluginRegistration />));
  await act(async () => button("select-assembly")!.click());
}

beforeEach(() => {
  for (const fn of Object.values(ops)) fn.mockReset();
  confirm.mockReset();
  reloadRoot.mockReset();
  ops.fetchPluginTypes.mockResolvedValue([
    { plugintypeid: "t1", typename: "Demo.PluginA", friendlyname: null, name: null },
    { plugintypeid: "t2", typename: "Demo.PluginB", friendlyname: null, name: null },
  ]);
  ops.fetchSteps.mockImplementation(async (_c: string, typeId: string) =>
    typeId === "t1" ? [{ sdkmessageprocessingstepid: "s1", name: "Create of contact" }] : [],
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Plugin Registration — unregister assembly", () => {
  it("lists every affected type and step, then deletes the assembly and reloads the tree", async () => {
    confirm.mockResolvedValue(true);
    await selectAssembly({ name: "Demo.Plugins", ismanaged: false });

    await act(async () => button("注销程序集（Unregister）")!.click());

    const options = confirm.mock.calls[0][0];
    expect(options.danger).toBe(true);
    expect(options.message).toContain("Demo.Plugins");
    expect(options.message).toContain("2 个插件类型、1 个 Step");
    expect(options.detail).toEqual(["插件类型  Demo.PluginA", "    Step  Create of contact", "插件类型  Demo.PluginB"]);
    expect(ops.deleteAssemblyCascade).toHaveBeenCalledWith("c1", "asm-1");
    expect(reloadRoot).toHaveBeenCalled();
  });

  it("does nothing when the confirmation is cancelled", async () => {
    confirm.mockResolvedValue(false);
    await selectAssembly({ name: "Demo.Plugins", ismanaged: false });

    await act(async () => button("注销程序集（Unregister）")!.click());

    expect(ops.deleteAssemblyCascade).not.toHaveBeenCalled();
    expect(reloadRoot).not.toHaveBeenCalled();
  });

  it("is disabled for a managed assembly", async () => {
    await selectAssembly({ name: "Microsoft.Something", ismanaged: true });

    expect(button("注销程序集（Unregister）")!.disabled).toBe(true);
  });
});
