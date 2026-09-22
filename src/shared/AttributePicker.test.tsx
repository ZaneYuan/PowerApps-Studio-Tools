// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AttributePicker from "./AttributePicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderPicker(initiallyShowUnchecked?: boolean) {
  act(() =>
    root.render(
      <AttributePicker
        label="Attributes"
        options={["name", "revenue", "statecode"]}
        selected={new Set(["name"])}
        onToggle={() => {}}
        onToggleAll={() => {}}
        initiallyShowUnchecked={initiallyShowUnchecked}
      />,
    ),
  );
}

function listedAttributes(): string[] {
  const list = container.querySelector(".overflow-y-auto");
  return Array.from(list?.querySelectorAll("label") ?? []).map((l) => l.textContent ?? "");
}

function filterCheckbox(text: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll("label")).find((l) => l.textContent === text);
  const input = label?.querySelector("input");
  if (!input) throw new Error(`no ${text} checkbox`);
  return input;
}

describe("AttributePicker initial filter", () => {
  it("lists every attribute by default", () => {
    renderPicker();
    expect(listedAttributes()).toEqual(["name", "revenue", "statecode"]);
  });

  it("lists only checked attributes when mounted with initiallyShowUnchecked=false (Bugs/9.9 #6)", () => {
    renderPicker(false);
    expect(filterCheckbox("未勾选").checked).toBe(false);
    expect(listedAttributes()).toEqual(["name"]);
  });

  it("still lets the user switch the unchecked attributes back on", () => {
    renderPicker(false);
    act(() => filterCheckbox("未勾选").click());
    expect(listedAttributes()).toEqual(["name", "revenue", "statecode"]);
  });
});
