// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createColumn = vi.fn(async () => {});
vi.mock("./dataverseOps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./dataverseOps")>()),
  createColumn,
}));

const { default: NewColumnDialog } = await import("./NewColumnDialog");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  createColumn.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <NewColumnDialog
        connectionId="c1"
        solutionUniqueName="sol"
        entityLogicalName="bupa_offer"
        publisherPrefix="bupa"
        onClose={() => {}}
        onCreated={() => {}}
      />,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function textInputs() {
  return [...document.body.querySelectorAll<HTMLInputElement>("input:not([type])")];
}

function lowercaseCheckbox() {
  const label = [...document.body.querySelectorAll("label")].find((l) => l.textContent?.trim() === "转小写");
  return label!.querySelector<HTMLInputElement>("input[type=checkbox]")!;
}

describe("NewColumnDialog lowercase SchemaName", () => {
  it("keeps the typed case by default", () => {
    const [displayName, schemaName] = textInputs();
    typeInto(displayName, "Room Type");
    expect(schemaName.value).toBe("bupa_RoomType");
  });

  it("lowercases the SchemaName shown and submitted when ticked, and restores it when unticked", async () => {
    const [displayName, schemaName] = textInputs();
    typeInto(displayName, "Room Type");
    act(() => lowercaseCheckbox().click());
    expect(schemaName.value).toBe("bupa_roomtype");

    const submit = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "创建")!;
    await act(async () => submit.click());
    expect(createColumn).toHaveBeenCalledWith("c1", "sol", "bupa_offer", "String", expect.objectContaining({ schemaName: "bupa_roomtype" }));

    act(() => lowercaseCheckbox().click());
    expect(schemaName.value).toBe("bupa_RoomType");
  });
});
