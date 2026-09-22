import { useCallback, useEffect, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import ErrorMessage from "../../shared/ErrorMessage";
import { useConfirmDialog } from "../../shared/ConfirmDialog";
import {
  decodeProfile,
  deleteProfile,
  fetchProfileContent,
  fetchProfilerEnvironment,
  fetchProfiles,
  fetchProfilingSteps,
  installProfiler,
  isProfilerInstalled,
  pickPluginAssembly,
  replayProfile,
  searchCustomSteps,
  startProfiling,
  stopProfiling,
  uninstallProfiler,
} from "./dataverseOps";
import type { DecodedProfile, ExecutionContext, ProfileSummary, ProfilerEnvironment, ProfilingStep, ReplayResult, SdkValue, StepCandidate } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const buttonCls =
  "rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800";
const primaryButtonCls = "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";
const errorCls = "rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400";
const panelCls = "overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800";
const panelTitleCls = "flex items-center justify-between border-b border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-800 dark:text-gray-300";

const STAGE_LABELS: Record<number, string> = { 10: "Pre-validation", 20: "Pre-operation", 30: "Main operation", 40: "Post-operation" };
const MODE_LABELS: Record<number, string> = { 0: "同步", 1: "异步" };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTyped(value: SdkValue): value is { $type: string; [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "$type" in value;
}

function ValueView({ value }: { value: SdkValue }) {
  if (value === null) return <span className="text-gray-400">null</span>;
  if (Array.isArray(value)) {
    return (
      <ol className="list-inside list-decimal">
        {value.map((v, i) => (
          <li key={i}>
            <ValueView value={v} />
          </li>
        ))}
      </ol>
    );
  }
  if (!isTyped(value)) return <span className="break-all">{String(value)}</span>;
  switch (value.$type) {
    case "Entity":
      return <EntityView value={value} />;
    case "EntityReference":
      return (
        <span className="break-all">
          {String(value.logicalName)}({String(value.id)}){value.name ? ` ${String(value.name)}` : ""}
        </span>
      );
    case "OptionSetValue":
    case "Money":
      return <span>{String(value.value)}</span>;
    case "EntityCollection":
      return (
        <div>
          <span className="text-gray-500">{String(value.entityName)} × {(value.entities as SdkValue[]).length}</span>
          <ValueView value={value.entities as SdkValue[]} />
        </div>
      );
    default:
      return (
        <span className="break-all">
          <span className="text-gray-500">{value.$type}: </span>
          {String(value.value)}
        </span>
      );
  }
}

function EntityView({ value }: { value: { [key: string]: unknown } }) {
  const attributes = Object.entries((value.attributes as Record<string, SdkValue>) ?? {});
  return (
    <div>
      <div className="text-gray-500">
        {String(value.logicalName)}({String(value.id)}) · {attributes.length} 个字段
      </div>
      <table className="mt-0.5 w-full">
        <tbody>
          {attributes.map(([k, v]) => (
            <tr key={k} className="border-t border-gray-100 align-top dark:border-gray-800">
              <td className="w-1/3 py-0.5 pr-2 text-gray-600 dark:text-gray-400">{k}</td>
              <td className="py-0.5">
                <ValueView value={v} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ParameterSection({ title, values }: { title: string; values: Record<string, SdkValue> }) {
  const entries = Object.entries(values);
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-gray-700 dark:text-gray-300">
        {title} <span className="font-normal text-gray-400">({entries.length})</span>
      </p>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400">（空）</p>
      ) : (
        <table className="w-full font-mono text-xs text-gray-800 dark:text-gray-200">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k} className="border-t border-gray-100 align-top dark:border-gray-800">
                <td className="w-40 py-1 pr-2 font-medium">{k}</td>
                <td className="py-1">
                  <ValueView value={v} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ContextView({ context }: { context: ExecutionContext }) {
  const facts: [string, string][] = [
    ["Message", context.messageName],
    ["Stage", `${context.stage} ${STAGE_LABELS[context.stage] ?? ""}`],
    ["Mode", `${context.mode} ${MODE_LABELS[context.mode] ?? ""}`],
    ["Depth", String(context.depth)],
    ["PrimaryEntity", `${context.primaryEntityName} (${context.primaryEntityId})`],
    ["UserId", context.userId],
    ["InitiatingUserId", context.initiatingUserId],
    ["CorrelationId", context.correlationId],
    ["OperationCreatedOn", context.operationCreatedOn],
    ["IsInTransaction", String(context.isInTransaction)],
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
            <dd className="break-all text-gray-800 dark:text-gray-200">{v}</dd>
          </div>
        ))}
      </dl>
      <ParameterSection title="InputParameters" values={context.inputParameters} />
      <ParameterSection title="PreEntityImages" values={context.preEntityImages} />
      <ParameterSection title="PostEntityImages" values={context.postEntityImages} />
      <ParameterSection title="OutputParameters" values={context.outputParameters} />
      <ParameterSection title="SharedVariables" values={context.sharedVariables} />
      {context.parentContext && (
        <details className="rounded-md border border-gray-200 p-2 dark:border-gray-800">
          <summary className="cursor-pointer text-xs font-medium text-gray-700 dark:text-gray-300">
            ParentContext（{context.parentContext.messageName} · Stage {context.parentContext.stage}）
          </summary>
          <div className="mt-2">
            <ContextView context={context.parentContext} />
          </div>
        </details>
      )}
    </div>
  );
}

export default function PluginDebugger() {
  const { activeConnectionId } = useActiveConnection();
  const confirm = useConfirmDialog();

  const [environment, setEnvironment] = useState<ProfilerEnvironment | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<StepCandidate[] | null>(null);
  const [profilingSteps, setProfilingSteps] = useState<ProfilingStep[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileContent, setProfileContent] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<DecodedProfile | null>(null);

  const [assemblyPath, setAssemblyPath] = useState("");
  const [replayTypeName, setReplayTypeName] = useState("");
  const [launchDebugger, setLaunchDebugger] = useState(true);
  const [replay, setReplay] = useState<ReplayResult | null>(null);

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }, []);

  const refresh = useCallback(async (connectionId: string) => {
    const isInstalled = await isProfilerInstalled(connectionId);
    setInstalled(isInstalled);
    if (!isInstalled) {
      setProfilingSteps([]);
      setProfiles([]);
      return;
    }
    const [steps, list] = await Promise.all([fetchProfilingSteps(connectionId), fetchProfiles(connectionId)]);
    setProfilingSteps(steps);
    setProfiles(list);
  }, []);

  useEffect(() => {
    setInstalled(null);
    setCandidates(null);
    setSelectedProfileId(null);
    setDecoded(null);
    setReplay(null);
    if (!activeConnectionId) return;
    void run("加载中", async () => {
      setEnvironment(await fetchProfilerEnvironment());
      await refresh(activeConnectionId);
    });
  }, [activeConnectionId, refresh, run]);

  if (!isNativeBridgeAvailable()) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用。
      </div>
    );
  }
  if (!activeConnectionId) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        请在上方“当前标签连接”中选择连接；如果还没有连接，请先到“我的连接”中添加。
      </div>
    );
  }
  const connectionId = activeConnectionId;
  const ready = environment?.prtDirectory && environment.hostAvailable;

  async function handleInstall() {
    const ok = await confirm({
      title: "安装 Plugin Profiler",
      message: "会把微软官方的 PluginProfiler 解决方案导入当前环境（通常需要几分钟），之后才能抓取插件执行上下文。",
      confirmLabel: "安装",
    });
    if (ok) await run("正在安装 Profiler（导入解决方案，可能需要几分钟）", async () => {
      await installProfiler(connectionId);
      await refresh(connectionId);
    });
  }

  async function handleUninstall() {
    const ok = await confirm({
      title: "卸载 Plugin Profiler",
      message: "会停止所有正在进行的抓取、恢复原始 Step，并删除 PluginProfiler 解决方案和所有抓取记录。",
      confirmLabel: "卸载",
      danger: true,
    });
    if (ok) await run("正在卸载 Profiler", async () => {
      await uninstallProfiler(connectionId);
      await refresh(connectionId);
    });
  }

  async function handleStart(step: StepCandidate) {
    const ok = await confirm({
      title: "开始抓取",
      message: `会停用 Step「${step.name}」，并注册一个“(Profiler)”Step 代替它运行原插件、记录执行上下文。停止抓取后恢复原 Step。`,
      confirmLabel: "开始抓取",
    });
    if (ok) await run("正在开始抓取", async () => {
      await startProfiling(connectionId, step.stepId);
      await refresh(connectionId);
    });
  }

  async function handleSelectProfile(profile: ProfileSummary) {
    setSelectedProfileId(profile.profileId);
    setDecoded(null);
    setReplay(null);
    setReplayTypeName(profile.typeName);
    await run("正在解析抓取记录", async () => {
      const content = await fetchProfileContent(connectionId, profile.profileId);
      setProfileContent(content);
      setDecoded(await decodeProfile(content));
    });
  }

  async function handleDeleteProfile(profile: ProfileSummary) {
    const ok = await confirm({ message: `删除 ${profile.createdOn} 的这条抓取记录？`, confirmLabel: "删除", danger: true });
    if (ok) await run("正在删除", async () => {
      await deleteProfile(connectionId, profile.profileId);
      if (selectedProfileId === profile.profileId) {
        setSelectedProfileId(null);
        setDecoded(null);
      }
      await refresh(connectionId);
    });
  }

  async function handleReplay() {
    if (!profileContent) return;
    setReplay(null);
    await run(launchDebugger ? "等待选择调试器 / 调试中…" : "正在本地重放", async () => {
      setReplay(await replayProfile({ profile: profileContent, assemblyPath, typeName: replayTypeName, launchDebugger }));
    });
  }

  return (
    <div className="max-w-7xl space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        使用微软官方 Plugin Profiler：在环境里抓取一次真实的插件执行上下文（Target、镜像、参数、异常），然后在本机用你编译的插件 DLL 重放，并可附加 Visual Studio 单步调试。
      </div>

      {error && <ErrorMessage error={error} className={errorCls} />}
      {busy && <p className="text-xs text-gray-500 dark:text-gray-400">{busy}…</p>}

      <div className={panelCls}>
        <div className={panelTitleCls}>
          <span>Profiler 状态</span>
          <button onClick={() => void run("刷新", () => refresh(connectionId))} disabled={!!busy} className={buttonCls}>
            刷新
          </button>
        </div>
        <div className="space-y-1 p-3 text-sm text-gray-800 dark:text-gray-200">
          {environment && !environment.prtDirectory && (
            <p className="text-amber-700 dark:text-amber-400">
              本机没有找到官方 Plugin Registration Tool（NuGet 包 microsoft.crmsdk.xrmtooling.pluginregistrationtool），Profiler 的程序集要从那里加载。
            </p>
          )}
          {environment && !environment.hostAvailable && <p className="text-amber-700 dark:text-amber-400">缺少 ProfilerHost 辅助程序，请重新发布桌面版。</p>}
          {environment?.prtDirectory && <p className="text-xs text-gray-500">Profiler 程序集来自：{environment.prtDirectory}</p>}
          {installed === null ? (
            <p className="text-xs text-gray-400">检查中…</p>
          ) : installed ? (
            <div className="flex items-center gap-2">
              <span className="text-emerald-600 dark:text-emerald-400">当前环境已安装 Profiler</span>
              <button onClick={() => void handleUninstall()} disabled={!!busy || !ready} className={buttonCls}>
                卸载
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span>当前环境还没有安装 Profiler。</span>
              <button onClick={() => void handleInstall()} disabled={!!busy || !ready} className={primaryButtonCls}>
                安装 Profiler
              </button>
            </div>
          )}
        </div>
      </div>

      {installed && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={panelCls}>
            <div className={panelTitleCls}>开始抓取</div>
            <div className="space-y-2 p-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run("搜索中", async () => setCandidates(await searchCustomSteps(connectionId, search)));
                }}
              >
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="按 Step 名称搜索自定义插件 Step" className={`${inputCls} flex-1`} />
                <button type="submit" disabled={!!busy || !search.trim()} className={buttonCls}>
                  搜索
                </button>
              </form>
              {candidates && candidates.length === 0 && <p className="text-xs text-gray-400">没有匹配的自定义插件 Step。</p>}
              <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
                {candidates?.map((s) => (
                  <li key={s.stepId} className="flex items-center gap-2 py-1.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-gray-900 dark:text-gray-100">{s.name}</div>
                      <div className="text-[11px] text-gray-500">
                        {STAGE_LABELS[s.stage] ?? s.stage} · {MODE_LABELS[s.mode] ?? s.mode} · {s.enabled ? "已启用" : "已停用"}
                      </div>
                    </div>
                    <button onClick={() => void handleStart(s)} disabled={!!busy || !ready || !s.enabled} className={buttonCls}>
                      开始抓取
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className={panelCls}>
            <div className={panelTitleCls}>正在抓取</div>
            <div className="p-3">
              {profilingSteps.length === 0 ? (
                <p className="text-xs text-gray-400">当前没有正在抓取的 Step。</p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {profilingSteps.map((s) => (
                    <li key={s.profilerStepId} className="flex items-center gap-2 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">{s.name}</span>
                      <button
                        onClick={() =>
                          void run("正在停止抓取", async () => {
                            await stopProfiling(connectionId, s.profilerStepId);
                            await refresh(connectionId);
                          })
                        }
                        disabled={!!busy || !ready}
                        className={buttonCls}
                      >
                        停止并恢复原 Step
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {installed && (
        <div className={panelCls}>
          <div className={panelTitleCls}>
            <span>抓取记录（最近 100 条）</span>
            <button onClick={() => void run("刷新", () => refresh(connectionId))} disabled={!!busy} className={buttonCls}>
              刷新
            </button>
          </div>
          {profiles.length === 0 ? (
            <p className="p-3 text-xs text-gray-400">还没有抓取记录：开始抓取后，在环境里触发一次该 Step（例如创建或更新一条记录）再刷新。</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2">时间</th>
                  <th className="px-3 py-2">插件</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="px-3 py-2">表</th>
                  <th className="px-3 py-2">Depth</th>
                  <th className="px-3 py-2">耗时 (ms)</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr
                    key={p.profileId}
                    onClick={() => void handleSelectProfile(p)}
                    className={`cursor-pointer border-t border-gray-100 dark:border-gray-800 ${
                      selectedProfileId === p.profileId ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    <td className="px-3 py-1.5 text-xs">{new Date(p.createdOn).toLocaleString()}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{p.typeName}</td>
                    <td className="px-3 py-1.5">{p.messageName}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{p.primaryEntity}</td>
                    <td className="px-3 py-1.5">{p.depth ?? ""}</td>
                    <td className="px-3 py-1.5">{p.executionDurationMs ?? ""}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteProfile(p);
                        }}
                        disabled={!!busy}
                        className={buttonCls}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {decoded && (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className={panelCls}>
            <div className={panelTitleCls}>执行上下文 · {decoded.typeName}</div>
            <div className="space-y-3 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {decoded.operationType} · 开始于 {decoded.executionStartTime ?? "?"} · 耗时 {decoded.executionDurationMs ?? "?"} ms · 录下 {decoded.replayEventCount} 次
                Dataverse 调用
              </p>
              {(decoded.constructorException || decoded.executionException) && (
                <pre className={`${errorCls} whitespace-pre-wrap font-mono`}>{decoded.executionException ?? decoded.constructorException}</pre>
              )}
              {decoded.context ? (
                <ContextView context={decoded.context} />
              ) : (
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-xs dark:bg-gray-900">{decoded.rawContext}</pre>
              )}
            </div>
          </div>

          <div className={panelCls}>
            <div className={panelTitleCls}>本地重放 / 调试</div>
            <div className="space-y-2 p-3 text-sm">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                用本机编译的插件 DLL（Debug 版，带 pdb）按这次抓到的上下文重新执行一遍。插件里对 Dataverse 的调用会返回抓取时录下的结果，不会真的写入环境。
              </p>
              <div className="flex gap-2">
                <input value={assemblyPath} onChange={(e) => setAssemblyPath(e.target.value)} placeholder="插件 DLL 路径" className={`${inputCls} flex-1 font-mono text-xs`} />
                <button
                  onClick={() =>
                    void run("选择文件", async () => {
                      const picked = await pickPluginAssembly();
                      if (picked.filePath) setAssemblyPath(picked.filePath);
                    })
                  }
                  disabled={!!busy}
                  className={buttonCls}
                >
                  选择…
                </button>
              </div>
              <input value={replayTypeName} onChange={(e) => setReplayTypeName(e.target.value)} placeholder="插件类型全名" className={`${inputCls} w-full font-mono text-xs`} />
              <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                <input type="checkbox" checked={launchDebugger} onChange={(e) => setLaunchDebugger(e.target.checked)} />
                执行前弹出调试器选择（选已打开插件源码的 Visual Studio，先在源码里下好断点）
              </label>
              <button onClick={() => void handleReplay()} disabled={!!busy || !ready || !assemblyPath.trim() || !replayTypeName.trim()} className={primaryButtonCls}>
                重放
              </button>
              {replay && (
                <div className="space-y-1">
                  <p className={replay.fault ? "text-red-700 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                    {replay.fault ? `插件抛出异常：${replay.fault}` : "执行完成，没有异常"} · {replay.durationMs} ms · {replay.organizationServiceCalls} 次 Dataverse 调用
                  </p>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 font-mono text-xs dark:bg-gray-900">{replay.traces.join("\n")}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
