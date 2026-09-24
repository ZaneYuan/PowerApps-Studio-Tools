import { useContext, useEffect, useRef, useState } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { TabKeyContext } from "../../native/tabs";
import ErrorMessage from "../../shared/ErrorMessage";

const RWB_SOLUTION = "RibbonWorkbench2016";
const RWB_PAGE = "WebResources/rwb_/html/EditCommandBar.htm";

type InstallState = { status: "checking" } | { status: "installed"; version: string } | { status: "missing" } | { status: "error"; error: string };

/** Hosts Develop1's Ribbon Workbench 2016 — the managed solution's own web resource UI, loaded
 *  from the tab's environment in a native WebView2 that the desktop shell lays over this
 *  component's placeholder (see EmbeddedBrowserHandlers.cs). The placeholder's on-screen rect is
 *  re-sent whenever it moves or resizes; a zero-size rect (tab hidden via display:none) hides the
 *  native view, and unmounting (tab closed or connection switched) disposes it. */
export default function RibbonWorkbenchEmbedded() {
  const { activeConnectionId, connections } = useActiveConnection();
  const tabKey = useContext(TabKeyContext);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [install, setInstall] = useState<InstallState>({ status: "checking" });
  const [embedError, setEmbedError] = useState<string | null>(null);

  const connection = connections.find((c) => c.id === activeConnectionId);
  const canEmbed = install.status === "installed" && !!connection?.allowWrite;

  useEffect(() => {
    if (!activeConnectionId || !isNativeBridgeAvailable()) return;
    let cancelled = false;
    setInstall({ status: "checking" });
    callNative<{ value: { version: string }[] }>("dataverse.request", {
      connectionId: activeConnectionId,
      method: "GET",
      path: `solutions?$select=version&$filter=uniquename eq '${RWB_SOLUTION}'`,
    })
      .then((res) => {
        if (!cancelled) setInstall(res.value.length > 0 ? { status: "installed", version: res.value[0].version } : { status: "missing" });
      })
      .catch((err) => {
        if (!cancelled) setInstall({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!canEmbed || !host || !activeConnectionId || !tabKey) return;
    setEmbedError(null);
    let lastSent = "";
    let frame = 0;

    const report = (err: unknown) => setEmbedError(err instanceof Error ? err.message : String(err));
    const sync = () => {
      frame = 0;
      const r = host.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0;
      const signature = visible ? `${r.left},${r.top},${r.width},${r.height}` : "hidden";
      if (signature === lastSent) return;
      lastSent = signature;
      if (visible) {
        callNative("embeddedBrowser.show", {
          key: tabKey,
          connectionId: activeConnectionId,
          path: RWB_PAGE,
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
        }).catch(report);
      } else {
        callNative("embeddedBrowser.hide", { key: tabKey }).catch(report);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    observer.observe(document.body);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      callNative("embeddedBrowser.close", { key: tabKey }).catch(() => {
        // The tab is going away; there's nowhere left to show a failure.
      });
    };
  }, [canEmbed, activeConnectionId, tabKey]);

  if (!isNativeBridgeAvailable()) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用。
      </div>
    );
  }
  if (!activeConnectionId) {
    return <p className="text-sm text-gray-400">请在上方“当前标签连接”中选择连接。</p>;
  }
  if (install.status === "checking") {
    return <p className="text-sm text-gray-400">正在检查环境是否安装了 Ribbon Workbench…</p>;
  }
  if (install.status === "error") {
    return <ErrorMessage error={install.error} />;
  }
  if (install.status === "missing") {
    return (
      <div className="max-w-2xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        当前环境没有安装 Ribbon Workbench 2016（solution <span className="font-mono">{RWB_SOLUTION}</span>）。请先导入它的 managed solution：可以从 develop1.net
        下载，装过 XrmToolBox 的话插件目录里也有一份 <span className="font-mono">RibbonWorkbench\RibbonWorkbench2016_managed.zip</span>。
      </div>
    );
  }
  if (!connection?.allowWrite) {
    return (
      <div className="max-w-2xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        这个连接已关闭“允许写入”。Ribbon Workbench 通过嵌入页面自己的登录会话直接发布修改，本应用的只读保护拦不住它，所以只读连接下不打开。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        版本 {install.version}。首次打开需要在下方登录这个环境的 Dynamics 账号，之后会记住。页面由环境里安装的 Ribbon Workbench 提供，修改直接在其中发布。
      </p>
      {embedError && <ErrorMessage error={embedError} />}
      <div
        ref={hostRef}
        className="rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
        style={{ height: "calc(100vh - 250px)", minHeight: 480 }}
      />
    </div>
  );
}
