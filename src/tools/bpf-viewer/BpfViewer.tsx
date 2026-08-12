import { useEffect, useMemo, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import { fetchBusinessProcessFlows, fetchBpfDefinition } from "./dataverseOps";
import { parseBpfClientData } from "./bpfParser";
import type { BpfGraph, BpfListItem, Edge, Stage } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

const STATE_LABELS: Record<number, string> = { 0: "Draft", 1: "Activated" };

interface DiagramRow {
  /** null for the first/root row; the edge that spawned every other row, for the "↳ 来自…" label. */
  fromEdge: Edge | null;
  stages: Stage[];
}

/** Arranges stages into horizontal rows for the diagram: a stage's first outgoing edge
 *  continues the current row (the default/primary continuation), any further outgoing edges
 *  each start a new row below (a condition branch) — matching the shape actually observed in a
 *  live BPF (one straight default path, branches peeling off into their own row). Doesn't model
 *  branches rejoining a shared later stage; anything a simple single-pass walk can't reach still
 *  gets appended as a trailing row so nothing is silently dropped. */
function buildDiagramRows(graph: BpfGraph): DiagramRow[] {
  const stageById = new Map(graph.stages.map((s) => [s.id, s]));
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Set<string>();
  for (const e of graph.edges) {
    if (!outgoing.has(e.fromStageId)) outgoing.set(e.fromStageId, []);
    outgoing.get(e.fromStageId)!.push(e);
    incoming.add(e.toStageId);
  }

  const visited = new Set<string>();
  const rows: DiagramRow[] = [];
  const branchQueue: { startId: string; fromEdge: Edge }[] = [];

  function walkRow(startId: string, fromEdge: Edge | null) {
    const stages: Stage[] = [];
    let currentId: string | undefined = startId;
    while (currentId && !visited.has(currentId)) {
      const stage = stageById.get(currentId);
      if (!stage) break;
      visited.add(currentId);
      stages.push(stage);
      const outs: Edge[] = outgoing.get(currentId) ?? [];
      for (let i = 1; i < outs.length; i++) {
        if (!visited.has(outs[i].toStageId)) branchQueue.push({ startId: outs[i].toStageId, fromEdge: outs[i] });
      }
      currentId = outs[0]?.toStageId;
    }
    if (stages.length > 0) rows.push({ fromEdge, stages });
  }

  const roots = graph.stages.filter((s) => !incoming.has(s.id));
  for (const root of roots.length > 0 ? roots : graph.stages.slice(0, 1)) {
    walkRow(root.id, null);
  }
  while (branchQueue.length > 0) {
    const next = branchQueue.shift()!;
    walkRow(next.startId, next.fromEdge);
  }

  const missed = graph.stages.filter((s) => !visited.has(s.id));
  if (missed.length > 0) rows.push({ fromEdge: null, stages: missed });

  return rows;
}

export default function BpfViewer() {
  const { activeConnectionId } = useActiveConnection();

  const [bpfs, setBpfs] = useState<BpfListItem[] | null>(null);
  const [bpfsError, setBpfsError] = useState<string | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");

  const [graph, setGraph] = useState<BpfGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  useEffect(() => {
    setBpfs(null);
    setBpfsError(null);
    setSelectedWorkflowId("");
    setGraph(null);
    setSelectedStageId(null);
    if (!activeConnectionId) return;
    fetchBusinessProcessFlows(activeConnectionId)
      .then(setBpfs)
      .catch((err) => setBpfsError(err instanceof Error ? err.message : String(err)));
  }, [activeConnectionId]);

  async function handleSelectBpf(workflowId: string) {
    setSelectedWorkflowId(workflowId);
    setGraph(null);
    setSelectedStageId(null);
    setLoadError(null);
    if (!activeConnectionId || !workflowId) return;
    setLoading(true);
    try {
      const clientdata = await fetchBpfDefinition(activeConnectionId, workflowId);
      const parsed = parseBpfClientData(clientdata);
      setGraph(parsed);
      setSelectedStageId(parsed.stages[0]?.id ?? null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => (graph ? buildDiagramRows(graph) : []), [graph]);
  const selectedStage = graph?.stages.find((s) => s.id === selectedStageId) ?? null;

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
        请先在左侧侧边栏顶部选择一个"我的连接"（没有连接的话先去"我的连接"里添加）。
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        只读查看 Business Process Flow 的阶段 / 步骤 / 条件分支，暂不支持编辑——分支逻辑存的是 Microsoft
        未公开的内部 JSON 格式，贸然写入风险很高，v1 先只做可视化。
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Business Process Flow</label>
          {bpfsError && <p className="text-xs text-red-600 dark:text-red-400">{bpfsError}</p>}
          {!bpfs && !bpfsError && <p className="text-xs text-gray-400">加载中…</p>}
          {bpfs && (
            <select
              value={selectedWorkflowId}
              onChange={(e) => void handleSelectBpf(e.target.value)}
              className={`${inputCls} w-96`}
            >
              <option value="">-- 选一个 BPF --</option>
              {bpfs.map((b) => (
                <option key={b.workflowId} value={b.workflowId}>
                  {b.name}（{STATE_LABELS[b.stateCode] ?? b.stateCode}，{b.primaryEntity}）
                </option>
              ))}
            </select>
          )}
        </div>
        {loading && <span className="text-xs text-gray-400">加载中…</span>}
      </div>

      {loadError && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {loadError}
        </p>
      )}

      {graph && (
        <>
          <div className="space-y-5 overflow-x-auto rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            {rows.length === 0 ? (
              <p className="text-sm text-gray-400">没有识别出任何阶段，见下方详情。</p>
            ) : (
              rows.map((row, i) => (
                <div key={i}>
                  {row.fromEdge && (
                    <p className="mb-1.5 text-xs text-gray-400">
                      ↳ 来自「{graph.stages.find((s) => s.id === row.fromEdge!.fromStageId)?.name ?? "?"}」的分支：
                      {row.fromEdge.label}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1">
                    {row.stages.map((stage, j) => (
                      <div key={stage.id} className="flex items-center gap-1">
                        <button
                          onClick={() => setSelectedStageId(stage.id)}
                          className={`min-w-[8rem] rounded-md border px-3 py-2 text-left text-xs shadow-sm ${
                            selectedStageId === stage.id
                              ? "border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20"
                              : "border-gray-300 bg-white hover:border-blue-300 dark:border-gray-600 dark:bg-gray-800"
                          }`}
                        >
                          <div className="font-medium text-gray-900 dark:text-gray-100">{stage.name}</div>
                          <div className="text-gray-400">
                            {stage.steps.length} 步
                            {stage.triggeredProcesses.length > 0 && ` · ${stage.triggeredProcesses.length} 个触发流程`}
                          </div>
                        </button>
                        {j < row.stages.length - 1 && <span className="text-gray-300">→</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {selectedStage && (
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
              <div className="border-b border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-800 dark:text-gray-300">
                {selectedStage.name} 的步骤（{selectedStage.entityName}）
              </div>
              {selectedStage.steps.length === 0 ? (
                <p className="p-3 text-xs text-gray-400">这个阶段没有数据收集步骤。</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                    <tr>
                      <th className="px-3 py-2">显示名</th>
                      <th className="px-3 py-2">字段（Logical Name）</th>
                      <th className="px-3 py-2">必填</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedStage.steps.map((step) => (
                      <tr key={step.id} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="px-3 py-1.5">{step.displayName}</td>
                        <td
                          onClick={() => step.dataFieldName && navigator.clipboard.writeText(step.dataFieldName)}
                          className="cursor-pointer px-3 py-1.5 font-mono text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                          title={step.dataFieldName ? "点击复制" : ""}
                        >
                          {step.dataFieldName || "—"}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-500">{step.isRequired ? "是" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="border-t border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 dark:border-gray-800 dark:text-gray-300">
                触发的流程/操作（Triggered Process）
              </div>
              {selectedStage.triggeredProcesses.length === 0 ? (
                <p className="p-3 text-xs text-gray-400">这个阶段没有触发任何流程/操作。</p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {selectedStage.triggeredProcesses.map((tp) => (
                    <li key={tp.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="text-gray-900 dark:text-gray-100">{tp.uniqueName || "(未命名)"}</span>
                      {tp.triggerEvent && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                          {tp.triggerEvent === "STAGEENTER"
                            ? "阶段进入时"
                            : tp.triggerEvent === "STAGEEXIT"
                              ? "阶段退出时"
                              : tp.triggerEvent}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {graph.unsupportedNotes.length > 0 && (
            <details className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-400">
              <summary className="cursor-pointer font-medium">
                有 {graph.unsupportedNotes.length} 处未识别的结构被跳过（不影响上面已识别的阶段/步骤）
              </summary>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {[...new Set(graph.unsupportedNotes)].map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
