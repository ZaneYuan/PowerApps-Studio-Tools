// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dialog from "./Dialog";

describe("Dialog", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    document.body.replaceChildren();
  });

  it("focuses its primary action, closes on Escape, and restores prior focus", () => {
    const opener = document.createElement("button");
    document.body.prepend(opener);
    opener.focus();
    const onClose = vi.fn();
    const root = createRoot(host);

    act(() => {
      root.render(
        <Dialog ariaLabel="测试弹窗" onClose={onClose} panelClassName="dialog-panel">
          <button autoFocus>主要操作</button>
        </Dialog>,
      );
    });

    expect(document.activeElement?.textContent).toBe("主要操作");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledOnce();

    act(() => root.unmount());
    expect(document.activeElement).toBe(opener);
  });
});
