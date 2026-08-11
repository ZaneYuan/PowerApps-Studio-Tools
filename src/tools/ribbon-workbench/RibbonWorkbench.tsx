import { useEffect, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import {
  exportSolutionZip,
  fetchSolutionEntities,
  fetchUnmanagedSolutions,
  importSolutionZip,
  publishEntity,
  waitForImportJobCompletion,
  type SolutionEntity,
  type UnmanagedSolution,
} from "./dataverseOps";
import { readRibbonDiffXml, writeRibbonDiffXml } from "./ribbonXml";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

function assertWellFormed(xmlText: string) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error(`不是合法的 XML：${parserError.textContent}`);
  if (doc.documentElement.tagName.toLowerCase() !== "ribbondiffxml") {
    throw new Error("根节点必须是 <RibbonDiffXml>。");
  }
}

export default function RibbonWorkbench() {
  const { activeConnectionId } = useActiveConnection();

  const [solutions, setSolutions] = useState<UnmanagedSolution[] | null>(null);
  const [solutionsError, setSolutionsError] = useState<string | null>(null);
  const [solutionUniqueName, setSolutionUniqueName] = useState("");

  const [entityName, setEntityName] = useState("");
  const [ribbonXml, setRibbonXml] = useState("");

  const [solutionEntities, setSolutionEntities] = useState<SolutionEntity[] | null>(null);
  const [solutionEntitiesError, setSolutionEntitiesError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveStep, setSaveStep] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveResultData, setSaveResultData] = useState<string | null>(null);

  useEffect(() => {
    if (!activeConnectionId) return;
    fetchUnmanagedSolutions(activeConnectionId)
      .then(setSolutions)
      .catch((err) => setSolutionsError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

  const selectedSolution = solutions?.find((s) => s.uniquename === solutionUniqueName) ?? null;

  useEffect(() => {
    setSolutionEntities(null);
    setSolutionEntitiesError(null);
    setEntityName("");
    setRibbonXml("");
    if (!activeConnectionId || !selectedSolution) return;
    fetchSolutionEntities(activeConnectionId, selectedSolution.solutionid)
      .then(setSolutionEntities)
      .catch((err) => setSolutionEntitiesError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId, selectedSolution?.solutionid]);

  async function handleLoad() {
    if (!activeConnectionId || !selectedSolution || !entityName.trim()) return;
    const logicalName = entityName.trim();
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaveResultData(null);
    try {
      const zip = await exportSolutionZip(activeConnectionId, selectedSolution.uniquename);
      const xml = await readRibbonDiffXml(zip, logicalName);
      setRibbonXml(xml);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!activeConnectionId || !selectedSolution || !entityName.trim()) return;
    const logicalName = entityName.trim();
    setSaving(true);
    setSaveError(null);
    setSaveResultData(null);
    try {
      setSaveStep("校验 XML…");
      assertWellFormed(ribbonXml);

      setSaveStep("重新导出 solution（避免覆盖别人并发的改动）…");
      const freshZip = await exportSolutionZip(activeConnectionId, selectedSolution.uniquename);

      setSaveStep("写入 RibbonDiffXml…");
      const patchedZip = await writeRibbonDiffXml(freshZip, logicalName, ribbonXml);

      setSaveStep("导入 solution…");
      const importJobId = await importSolutionZip(activeConnectionId, patchedZip);

      setSaveStep("等待导入完成…");
      const status = await waitForImportJobCompletion(activeConnectionId, importJobId);
      setSaveResultData(status.data);

      setSaveStep("发布…");
      await publishEntity(activeConnectionId, logicalName);

      setSaveStep(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaveStep(null);
    } finally {
      setSaving(false);
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
        请先在左侧侧边栏顶部选择一个"当前连接"（没有连接的话先去"我的连接"里添加）。
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        编辑表的 RibbonDiffXml（原始 XML，暂无可视化编辑器）。原理：导出你选的 solution → 改 RibbonDiffXml →
        重新导入 → 发布。只能选 solution 里已有的表，v1 只支持单表的 ribbon，不支持全局 Application Ribbon。
        <br />
        ⚠️ 会实际修改所选 solution 的 unmanaged customizations，建议先在测试表/非生产环境上试。跟其他人同时编辑同一张表的
        ribbon 有小概率互相覆盖（保存前会重新导出一次，但没法完全消除这个窗口）。
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Solution（unmanaged）</label>
          {solutionsError && <p className="text-xs text-red-600 dark:text-red-400">{solutionsError}</p>}
          {!solutions && !solutionsError && <p className="text-xs text-gray-400">加载中…</p>}
          {solutions && (
            <select
              value={solutionUniqueName}
              onChange={(e) => setSolutionUniqueName(e.target.value)}
              className={`${inputCls} w-64`}
            >
              <option value="">选择 solution…</option>
              {solutions.map((s) => (
                <option key={s.solutionid} value={s.uniquename}>
                  {s.friendlyname}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">表（solution 中已有的）</label>
          {solutionEntitiesError && <p className="text-xs text-red-600 dark:text-red-400">{solutionEntitiesError}</p>}
          <select
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
            disabled={!selectedSolution || !solutionEntities}
            className={`${inputCls} w-56`}
          >
            <option value="">
              {!selectedSolution ? "先选 solution…" : !solutionEntities ? "加载中…" : "-- 选一张已有的表 --"}
            </option>
            {solutionEntities?.map((en) => (
              <option key={en.logicalName} value={en.logicalName}>
                {en.displayName} ({en.logicalName})
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleLoad}
          disabled={!selectedSolution || !entityName.trim() || loading || saving}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "加载中…" : "加载"}
        </button>
      </div>

      {loadError && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {loadError}
        </p>
      )}

      {ribbonXml && (
        <>
          <div>
            <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">RibbonDiffXml</label>
            <textarea
              value={ribbonXml}
              onChange={(e) => setRibbonXml(e.target.value)}
              rows={16}
              spellCheck={false}
              className={`${inputCls} w-full font-mono text-xs`}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? saveStep ?? "保存中…" : "保存并发布"}
            </button>
            {saving && saveStep && <span className="text-xs text-gray-400">{saveStep}</span>}
          </div>

          {saveError && (
            <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {saveError}
            </p>
          )}
          {!saveError && saveResultData !== null && !saving && (
            <div>
              <p className="mb-1 text-xs font-medium text-green-600 dark:text-green-400">保存并发布完成。</p>
              <details>
                <summary className="cursor-pointer text-xs text-gray-500 dark:text-gray-400">
                  导入结果详情（importjobs.data）
                </summary>
                <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
                  {saveResultData}
                </pre>
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}
