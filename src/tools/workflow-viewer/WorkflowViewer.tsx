import { useEffect, useMemo, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import ErrorMessage from "../../shared/ErrorMessage";
import { fetchWorkflowDefinition, fetchWorkflows } from "./dataverseOps";
import { parseWorkflowXaml } from "./xamlParser";
import { parseFlowClientData } from "./flowParser";
import { CATEGORY_LABELS, type FlowAction, type FlowDefinition, type ProcessCategory, type WorkflowDefinition, type WorkflowListItem, type XamlStep } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const errorCls = "rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400";
const sectionTitleCls = "border-b border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-800 dark:text-gray-300";
const badgeCls = "rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-400";

const CATEGORIES = Object.keys(CATEGORY_LABELS).map(Number) as ProcessCategory[];

const STEP_LABELS: Record<string, string> = {
  Condition: "条件",
  Update: "更新记录",
  Create: "创建记录",
  SetState: "更改状态",
  SendEmail: "发送邮件",
  Assign: "分配记录",
  Wait: "等待条件",
  WaitTimeout: "超时",
  CustomActivity: "自定义活动",
  StopWorkflow: "停止流程",
  ChildWorkflow: "启动子流程",
  SetAttributeValue: "设置字段值",
  SetVisibility: "设置可见性",
  SetDisplayMode: "设置只读",
  SetFieldRequiredLevel: "设置必填",
  SetDefaultValue: "设置默认值",
  SetMessage: "显示错误消息",
  AssignValue: "赋值",
  AssignOutputArgument: "设置输出参数",
  WaitBranch: "等待分支",
  InvokeSdkMessage: "调用消息",
  Action: "操作组",
  Stage: "阶段",
};

/** Workflow `createstage`/`updatestage`/`deletestage` option values. */
const STAGE_LABELS: Record<number, string> = { 20: "操作前", 40: "操作后" };

interface Selected {
  item: WorkflowListItem;
  definition: WorkflowDefinition;
  steps: XamlStep[] | null;
  flow: FlowDefinition | null;
  parseError: string | null;
}

function stageSuffix(item: WorkflowListItem, stage: number | null): string {
  if (item.mode !== 1 || stage === null) return "";
  return `（${STAGE_LABELS[stage] ?? stage}）`;
}

function classicTriggers(item: WorkflowListItem): string[] {
  const lines: string[] = [];
  if (item.triggerOnCreate) lines.push(`记录创建时${stageSuffix(item, item.createStage)}`);
  const updateAttrs = (item.triggerOnUpdateAttributeList ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  if (updateAttrs.length > 0) lines.push(`字段更新时${stageSuffix(item, item.updateStage)}：${updateAttrs.join(", ")}`);
  if (item.triggerOnDelete) lines.push(`记录删除时${stageSuffix(item, item.deleteStage)}`);
  if (item.onDemand) lines.push("按需运行（手动）");
  if (item.subprocess) lines.push("作为子流程被调用");
  return lines;
}

/** A Condition step's children are its branches, in evaluation order. */
function branchLabel(step: XamlStep, index: number): string {
  if (index === 0) return "如果";
  return step.detail ? "否则如果" : "否则";
}

function StepTree({ steps }: { steps: XamlStep[] }) {
  return (
    <ul className="space-y-1 border-l border-gray-200 pl-3 dark:border-gray-700">
      {steps.map((step, i) => {
        const label = step.kind === "ConditionBranch" ? branchLabel(step, i) : (STEP_LABELS[step.kind] ?? step.kind);
        return (
          <li key={`${step.kind}${step.number}-${i}`}>
            <div className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="font-medium text-gray-900 dark:text-gray-100">{label}</span>
              {step.description && <span className="text-gray-600 dark:text-gray-300">{step.description}</span>}
              {step.detail && <span className="font-mono text-xs text-blue-700 dark:text-blue-400">{step.detail}</span>}
            </div>
            {step.assignments.length > 0 && (
              <ul className="mt-0.5 space-y-0.5 pl-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                {step.assignments.map((a, j) => (
                  <li key={j} className="break-all">
                    {a}
                  </li>
                ))}
              </ul>
            )}
            {step.children.length > 0 && (
              <div className="mt-1">
                <StepTree steps={step.children} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FlowActionTree({ actions }: { actions: FlowAction[] }) {
  if (actions.length === 0) return <p className="text-xs text-gray-400">（无操作）</p>;
  return (
    <ul className="space-y-1 border-l border-gray-200 pl-3 dark:border-gray-700">
      {actions.map((a) => (
        <li key={a.name}>
          <div className="flex flex-wrap items-baseline gap-2 text-sm">
            <span className="font-medium text-gray-900 dark:text-gray-100">{a.name.replace(/_/g, " ")}</span>
            <span className={badgeCls}>{a.type}</span>
            {a.operationId && (
              <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                {a.connector ? `${a.connector} · ` : ""}
                {a.operationId}
              </span>
            )}
          </div>
          {a.detail && <p className="mt-0.5 break-all pl-3 font-mono text-xs text-blue-700 dark:text-blue-400">{a.detail}</p>}
          {a.branches.map((b, i) => (
            <div key={i} className="mt-1 pl-3">
              {b.label && <p className="mb-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">{b.label}</p>}
              <FlowActionTree actions={b.actions} />
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

function rawDefinitionText(selected: Selected): string {
  if (selected.item.category !== 5) return selected.definition.xaml ?? "";
  const raw = selected.definition.clientData ?? "";
  return selected.flow ? JSON.stringify(JSON.parse(raw), null, 2) : raw;
}

export default function WorkflowViewer() {
  const { activeConnectionId } = useActiveConnection();

  const [workflows, setWorkflows] = useState<WorkflowListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ProcessCategory | "all">("all");
  const [activeOnly, setActiveOnly] = useState(false);

  const [selected, setSelected] = useState<Selected | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setWorkflows(null);
    setListError(null);
    setSelected(null);
    if (!activeConnectionId) return;
    fetchWorkflows(activeConnectionId)
      .then(setWorkflows)
      .catch((err) => setListError(err instanceof Error ? err.message : String(err)));
  }, [activeConnectionId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (workflows ?? []).filter(
      (w) =>
        (categoryFilter === "all" || w.category === categoryFilter) &&
        (!activeOnly || w.stateCode === 1) &&
        (!q || [w.name, w.uniqueName, w.primaryEntity, w.primaryEntityLabel].some((v) => v.toLowerCase().includes(q))),
    );
  }, [workflows, search, categoryFilter, activeOnly]);

  const countByCategory = useMemo(() => {
    const counts = new Map<ProcessCategory, number>();
    for (const w of workflows ?? []) counts.set(w.category, (counts.get(w.category) ?? 0) + 1);
    return counts;
  }, [workflows]);

  async function handleSelect(item: WorkflowListItem) {
    if (!activeConnectionId) return;
    setLoadingId(item.workflowId);
    setLoadError(null);
    try {
      const definition = await fetchWorkflowDefinition(activeConnectionId, item.workflowId);
      let steps: XamlStep[] | null = null;
      let flow: FlowDefinition | null = null;
      let parseError: string | null = null;
      try {
        if (item.category === 5 && definition.clientData) flow = parseFlowClientData(definition.clientData);
        else if (definition.xaml) steps = parseWorkflowXaml(definition.xaml);
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err);
      }
      setSelected({ item, definition, steps, flow, parseError });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingId(null);
    }
  }

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

  const item = selected?.item;
  const triggers = item && item.category === 0 ? classicTriggers(item) : [];

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex w-full flex-col gap-2 rounded-lg border border-gray-200 p-3 lg:w-96 lg:shrink-0 dark:border-gray-800">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索名称 / 唯一名 / 表" className={inputCls} />
        <div className="flex flex-wrap items-center gap-1">
          {(["all", ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                categoryFilter === c
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                  : "border-gray-300 text-gray-600 hover:border-blue-300 dark:border-gray-600 dark:text-gray-300"
              }`}
            >
              {c === "all" ? `全部 ${workflows?.length ?? ""}` : `${CATEGORY_LABELS[c]} ${countByCategory.get(c) ?? 0}`}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          只看已激活
        </label>

        {listError && <ErrorMessage error={listError} className={errorCls} />}
        {!workflows && !listError && <p className="text-xs text-gray-400">加载中…</p>}
        {workflows && (
          <ul className="max-h-[70vh] divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
            {filtered.length === 0 && <li className="py-2 text-xs text-gray-400">没有匹配的流程。</li>}
            {filtered.map((w) => (
              <li key={w.workflowId}>
                <button
                  onClick={() => void handleSelect(w)}
                  className={`w-full px-2 py-1.5 text-left ${
                    selected?.item.workflowId === w.workflowId ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-sm text-gray-900 dark:text-gray-100">
                    <span className="truncate">{w.name}</span>
                    {loadingId === w.workflowId && <span className="text-xs text-gray-400">加载中…</span>}
                  </div>
                  <div className="flex flex-wrap gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className={badgeCls}>{CATEGORY_LABELS[w.category]}</span>
                    <span className={w.stateCode === 1 ? "text-emerald-600 dark:text-emerald-400" : ""}>{w.stateLabel}</span>
                    {w.primaryEntity && w.primaryEntity !== "none" && <span className="font-mono">{w.primaryEntity}</span>}
                    {w.category === 0 && <span>{w.mode === 1 ? "实时" : "后台"}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        {loadError && <ErrorMessage error={loadError} className={errorCls} />}
        {!selected && !loadError && <p className="text-sm text-gray-400">从左侧选择一个流程查看触发时机和具体操作。</p>}

        {selected && item && (
          <>
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{item.name}</h3>
                <span className={badgeCls}>{CATEGORY_LABELS[item.category]}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{item.stateLabel}</span>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {item.uniqueName && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">唯一名</dt>
                    <dd className="font-mono text-gray-800 dark:text-gray-200">{item.uniqueName}</dd>
                  </>
                )}
                <dt className="text-gray-500 dark:text-gray-400">主表</dt>
                <dd className="text-gray-800 dark:text-gray-200">
                  {item.primaryEntityLabel} <span className="font-mono text-gray-500">({item.primaryEntity})</span>
                </dd>
                <dt className="text-gray-500 dark:text-gray-400">负责人</dt>
                <dd className="text-gray-800 dark:text-gray-200">{item.ownerName || "—"}</dd>
                <dt className="text-gray-500 dark:text-gray-400">修改时间</dt>
                <dd className="text-gray-800 dark:text-gray-200">{new Date(item.modifiedOn).toLocaleString()}</dd>
                {item.description && (
                  <>
                    <dt className="text-gray-500 dark:text-gray-400">描述</dt>
                    <dd className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">{item.description}</dd>
                  </>
                )}
              </dl>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
              <div className={sectionTitleCls}>触发时机</div>
              <div className="space-y-1 p-3 text-sm text-gray-800 dark:text-gray-200">
                {item.category === 0 && (
                  <>
                    <p>
                      {item.mode === 1 ? "实时（同步）" : "后台（异步）"} · 范围：{item.scopeLabel} · 运行身份：{item.runAsLabel}
                    </p>
                    {triggers.length === 0 ? (
                      <p className="text-xs text-gray-400">没有配置任何触发条件。</p>
                    ) : (
                      <ul className="list-inside list-disc">
                        {triggers.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                {item.category === 3 && (
                  <p>
                    作为消息 <span className="font-mono">{item.uniqueName}</span> 被调用（插件、流程、Web API 均可触发）· {item.mode === 1 ? "实时" : "后台"}
                  </p>
                )}
                {item.category === 2 && <p>表单加载及相关字段变化时执行；作用域为“实体”时，服务器端保存记录也会执行。</p>}
                {item.category === 5 &&
                  (selected.flow ? (
                    selected.flow.triggers.map((t) => (
                      <div key={t.name}>
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium">{t.name.replace(/_/g, " ")}</span>
                          <span className={badgeCls}>
                            {t.type}
                            {t.kind ? ` / ${t.kind}` : ""}
                          </span>
                          {t.operationId && (
                            <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                              {t.connector ? `${t.connector} · ` : ""}
                              {t.operationId}
                            </span>
                          )}
                        </div>
                        {t.parameters.length > 0 && (
                          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-3 font-mono text-xs">
                            {t.parameters.map(([k, v]) => (
                              <div key={k} className="contents">
                                <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                                <dd className="break-all text-gray-800 dark:text-gray-200">{v}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-gray-400">没有读到云端流定义。</p>
                  ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
              <div className={sectionTitleCls}>具体操作</div>
              <div className="p-3">
                {selected.parseError && <ErrorMessage error={`解析失败，请看下方原始定义：${selected.parseError}`} className={errorCls} />}
                {selected.steps && (selected.steps.length === 0 ? <p className="text-xs text-gray-400">（无步骤）</p> : <StepTree steps={selected.steps} />)}
                {selected.flow && <FlowActionTree actions={selected.flow.actions} />}
                {!selected.steps && !selected.flow && !selected.parseError && <p className="text-xs text-gray-400">没有可解析的定义。</p>}
              </div>
            </div>

            <details className="rounded-lg border border-gray-200 dark:border-gray-800">
              <summary className="cursor-pointer px-3 py-2 text-sm text-gray-700 dark:text-gray-300">原始定义（{item.category === 5 ? "clientdata" : "xaml"}）</summary>
              <pre className="max-h-[60vh] overflow-auto border-t border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                {rawDefinitionText(selected)}
              </pre>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
