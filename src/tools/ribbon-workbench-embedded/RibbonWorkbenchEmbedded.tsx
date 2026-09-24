import { useEffect, useState } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import ErrorMessage from "../../shared/ErrorMessage";

const RWB_SOLUTION = "RibbonWorkbench2016";

interface OpenResult {
  url: string;
  localPackageVersion: string | null;
  localPackagePath: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; url: string; source: string }
  | { status: "unavailable"; localPackagePath: string }
  | { status: "error"; error: string };

/** Hosts Develop1's Ribbon Workbench 2016 in an iframe on a virtual host the desktop shell
 *  answers itself (RibbonWorkbenchHost.cs): its pages come from the XrmToolBox plugin's local
 *  solution package — or from the environment when only the environment has it installed — and
 *  its Dataverse calls go out with this tab's connection, so nothing has to be installed or signed
 *  into in the environment. */
export default function RibbonWorkbenchEmbedded() {
  const { activeConnectionId, connections } = useActiveConnection();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const connection = connections.find((c) => c.id === activeConnectionId);
  const allowWrite = !!connection?.allowWrite;

  useEffect(() => {
    if (!activeConnectionId || !allowWrite || !isNativeBridgeAvailable()) return;
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      const opened = await callNative<OpenResult>("ribbonWorkbench.open", { connectionId: activeConnectionId });
      if (opened.localPackageVersion) return { status: "ready", url: opened.url, source: `本机 XrmToolBox 插件包 v${opened.localPackageVersion}` } as const;
      const installed = await callNative<{ value: { version: string }[] }>("dataverse.request", {
        connectionId: activeConnectionId,
        method: "GET",
        path: `solutions?$select=version&$filter=uniquename eq '${RWB_SOLUTION}'`,
      });
      return installed.value.length > 0
        ? ({ status: "ready", url: opened.url, source: `环境中已安装的 v${installed.value[0].version}` } as const)
        : ({ status: "unavailable", localPackagePath: opened.localPackagePath } as const);
    })()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId, allowWrite]);

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
  if (!allowWrite) {
    return (
      <div className="max-w-2xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        这个连接已关闭“允许写入”。Ribbon Workbench 需要写入权限才能保存和发布，只读连接下不打开。
      </div>
    );
  }
  if (state.status === "loading") {
    return <p className="text-sm text-gray-400">正在准备 Ribbon Workbench…</p>;
  }
  if (state.status === "error") {
    return <ErrorMessage error={state.error} />;
  }
  if (state.status === "unavailable") {
    return (
      <div className="max-w-2xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        找不到 Ribbon Workbench：本机没有 XrmToolBox 的 Ribbon Workbench 插件包（<span className="font-mono">{state.localPackagePath}</span>），这个环境里也没有安装{" "}
        <span className="font-mono">{RWB_SOLUTION}</span>。在 XrmToolBox 里安装 Ribbon Workbench 插件即可。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400">页面来自{state.source}，使用当前标签连接访问环境，修改在其中直接发布。</p>
      <iframe
        key={state.url}
        src={state.url}
        title="Ribbon Workbench"
        className="w-full rounded-md border border-gray-200 bg-white dark:border-gray-800"
        style={{ height: "calc(100vh - 250px)", minHeight: 480 }}
      />
    </div>
  );
}
