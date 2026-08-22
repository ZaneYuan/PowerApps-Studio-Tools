import { useEffect, useMemo, useState } from "react";
import { isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection } from "../../native/activeConnection";
import {
  exportSolutionZip,
  fetchEffectiveRibbonCompressed,
  fetchSolutionEntities,
  fetchUnmanagedSolutions,
  importSolutionZip,
  publishEntity,
  waitForImportJobCompletion,
  type SolutionEntity,
  type UnmanagedSolution,
} from "./dataverseOps";
import { readRibbonDiffXml, writeRibbonDiffXml } from "./ribbonXml";
import { decompressRibbonXml, parseRibbonTree, type RibbonTabNode } from "./effectiveRibbon";
import { applyAddButtonAction as applyAddButtonActionPure, applyHideAction as applyHideActionPure, parseCustomActions } from "./customActions";

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

  // --- v2: read-only effective-ribbon tree (Tab -> Group -> Button) ---
  const [effectiveTabs, setEffectiveTabs] = useState<RibbonTabNode[] | null>(null);
  const [effectiveLoading, setEffectiveLoading] = useState(false);
  const [effectiveError, setEffectiveError] = useState<string | null>(null);
  const [expandedTabs, setExpandedTabs] = useState<Set<string>>(new Set());

  // --- v2: existing CustomAction/HideCustomAction list — reactively parsed from the textarea's
  // current text, so it always reflects exactly what "保存并发布" is about to write. ---
  const parsedCustomActions = useMemo(() => {
    if (!ribbonXml) return [];
    try {
      return parseCustomActions(ribbonXml);
    } catch {
      return []; // mid-edit invalid XML — the textarea's own state is the source of truth, not this list
    }
  }, [ribbonXml]);

  // --- v2: two guided write forms — both only ever stage a change into `ribbonXml` (the same
  // textarea handleSave already reviews/saves), never write directly, so the existing
  // export-fresh-before-save safety step and manual review are unchanged. ---
  const [hideTargetId, setHideTargetId] = useState("");
  const [addLocation, setAddLocation] = useState("");
  const [addLabelText, setAddLabelText] = useState("");
  const [addToolTip, setAddToolTip] = useState("");
  const [addWebResource, setAddWebResource] = useState("");
  const [addFunctionName, setAddFunctionName] = useState("");
  const [guidedError, setGuidedError] = useState<string | null>(null);

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
    setEffectiveTabs(null);
    setEffectiveError(null);
    setHideTargetId("");
    setAddLocation("");
    setGuidedError(null);
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

  async function handleLoadEffectiveRibbon() {
    if (!activeConnectionId || !entityName.trim()) return;
    setEffectiveLoading(true);
    setEffectiveError(null);
    try {
      const compressed = await fetchEffectiveRibbonCompressed(activeConnectionId, entityName.trim());
      const xml = await decompressRibbonXml(compressed);
      setEffectiveTabs(parseRibbonTree(xml));
    } catch (err) {
      setEffectiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setEffectiveLoading(false);
    }
  }

  function toggleTab(id: string) {
    setExpandedTabs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** A control clicked in the read-only tree fills the "hide" form's target (its own real Id —
   *  HideCustomAction.Location must match exactly); a group clicked fills the "add button" form's
   *  Location as that group's Id + `._children` (the documented suffix for "insert as a new child
   *  of this container" — see customActions.ts's own doc comment). */
  function pickControlForHide(id: string | null) {
    if (id) setHideTargetId(id);
  }
  function pickGroupForAdd(id: string | null) {
    // A <Group>'s own direct children are things like <Controls>/<Layout>/<Sizes>, not raw
    // buttons — the real insertion point for "add a button to this group" is the group's nested
    // <Controls> element, not the group itself. Confirmed against Microsoft's own real worked
    // example (Dynamics 365 Customer Service docs, "Configure Link to conversation button":
    // Location="Mscrm.Form.account.MainTab.Save.Controls._children") — a real integration test
    // run against ZaneTest (2026-08-21) also caught this the hard way: a button added at
    // "<GroupId>._children" silently never rendered, while the same button at
    // "<GroupId>.Controls._children" showed up immediately.
    if (id) setAddLocation(`${id}.Controls._children`);
  }

  function applyHideAction() {
    setGuidedError(null);
    const result = applyHideActionPure(ribbonXml, hideTargetId);
    if ("error" in result) {
      setGuidedError(result.error);
      return;
    }
    setRibbonXml(result.xml);
    setHideTargetId("");
  }

  function applyAddButtonAction() {
    setGuidedError(null);
    if (!entityName.trim()) return;
    const result = applyAddButtonActionPure(
      ribbonXml,
      {
        entityName: entityName.trim(),
        solutionUniqueName,
        location: addLocation,
        labelText: addLabelText,
        toolTipTitle: addToolTip,
        webResourceName: addWebResource,
        functionName: addFunctionName,
      },
      Date.now().toString(36), // only actually used if a collision is detected — see customActions.ts's doc comment
    );
    if ("error" in result) {
      setGuidedError(result.error);
      return;
    }
    setRibbonXml(result.xml);
    setAddLabelText("");
    setAddToolTip("");
    setAddWebResource("");
    setAddFunctionName("");
    setAddLocation("");
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
        请先在左侧侧边栏顶部选择一个"我的连接"（没有连接的话先去"我的连接"里添加）。
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        编辑表的 RibbonDiffXml（原始 XML，暂无可视化编辑器）。原理：导出你选的 solution → 改 RibbonDiffXml →
        重新导入 → 发布。只能选 solution 里已有的表，只支持单表的 ribbon，不支持全局 Application Ribbon。
        <br />
        v2：可以只填表名（不用先选 solution）"只读"地读取当前真实生效的完整 Ribbon 树（RetrieveEntityRibbon，系统默认
        + 所有 solution 层叠加后的结果），点树里的按钮/Group 能直接把真实 Id 填进下面两个引导表单；也会列出这张表已有的
        CustomAction/HideCustomAction。
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
            onChange={(e) => {
              setEntityName(e.target.value);
              setEffectiveTabs(null);
              setEffectiveError(null);
              setHideTargetId("");
              setAddLocation("");
              setGuidedError(null);
            }}
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
        <button
          onClick={handleLoadEffectiveRibbon}
          disabled={!entityName.trim() || effectiveLoading}
          title="读取合并了系统默认 + 所有 solution 层customization 之后、当前真实生效的完整 Ribbon（只读），不需要先选 solution"
          className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          {effectiveLoading ? "读取中…" : "读取当前生效 Ribbon（只读）"}
        </button>
      </div>

      {loadError && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {loadError}
        </p>
      )}

      {effectiveError && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {effectiveError}
        </p>
      )}

      {effectiveTabs && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800">
          <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            {effectiveTabs.length} 个 Tab（点一个按钮 = 填入下面"隐藏"表单的目标；点一个 Group 的名称 = 填入"新增按钮"表单的目标位置）
          </div>
          <div className="max-h-80 overflow-auto p-2 text-xs">
            {effectiveTabs.length === 0 && <p className="p-2 text-gray-400">没有解析出任何 Tab（这张表可能没有自定义的 Form/Grid ribbon，或者结构超出了这里的简化解析）。</p>}
            {effectiveTabs.map((tab) => (
              <div key={tab.id ?? tab.labelText} className="mb-1">
                <button
                  onClick={() => tab.id && toggleTab(tab.id)}
                  className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left font-medium hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <span className="w-3 text-gray-400">{tab.id && expandedTabs.has(tab.id) ? "▾" : "▸"}</span>
                  Tab: {tab.labelText || tab.id || "(未命名)"}
                </button>
                {tab.id && expandedTabs.has(tab.id) && (
                  <div className="ml-4 border-l border-gray-200 pl-2 dark:border-gray-800">
                    {tab.groups.length === 0 && <p className="py-1 text-gray-400">（没有 Group）</p>}
                    {tab.groups.map((group) => (
                      <div key={group.id ?? group.labelText} className="py-0.5">
                        <button
                          onClick={() => pickGroupForAdd(group.id)}
                          title={group.id ? `点击填入"新增按钮"的目标位置：${group.id}.Controls._children` : undefined}
                          className="rounded px-1 text-left text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          Group: {group.labelText || group.id || "(未命名)"}
                        </button>
                        <div className="ml-4">
                          {group.controls.map((control, i) => (
                            <button
                              key={control.id ?? i}
                              onClick={() => pickControlForHide(control.id)}
                              title={control.id ? `点击填入"隐藏按钮"的目标：${control.id}` : undefined}
                              className="block rounded px-1 py-0.5 text-left font-mono text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                            >
                              {control.tag}: {control.labelText || control.id || "(未命名)"}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
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

          <div className="rounded-lg border border-gray-200 dark:border-gray-800">
            <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              这张表已有的 CustomAction / HideCustomAction（{parsedCustomActions.length}）
            </div>
            {parsedCustomActions.length === 0 ? (
              <p className="p-3 text-xs text-gray-400">还没有任何自定义的 CustomAction/HideCustomAction。</p>
            ) : (
              <ul className="divide-y divide-gray-100 text-xs dark:divide-gray-800">
                {parsedCustomActions.map((a, i) => (
                  <li key={i} className="px-3 py-1.5">
                    <span className={a.kind === "hide" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                      {a.kind === "hide" ? "隐藏" : "新增/替换"}
                    </span>{" "}
                    <span className="font-mono">{a.id}</span>
                    {a.kind === "add" && a.buttonLabelText && <span className="text-gray-400"> — 按钮文字："{a.buttonLabelText}"</span>}
                    <div className="text-gray-400">Location: {a.location}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-300">引导式操作：隐藏一个已有按钮</p>
              <input
                type="text"
                value={hideTargetId}
                onChange={(e) => setHideTargetId(e.target.value)}
                placeholder="要隐藏的按钮/控件的真实 Id（可从上面只读树里点选）"
                className={`${inputCls} w-full font-mono text-xs`}
              />
              <button
                onClick={applyHideAction}
                disabled={!hideTargetId.trim()}
                className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                应用到上面的 RibbonDiffXml
              </button>
            </div>

            <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-300">引导式操作：新增一个调用 JS 函数的按钮</p>
              <input
                type="text"
                value={addLocation}
                onChange={(e) => setAddLocation(e.target.value)}
                placeholder="目标位置（可从上面只读树里点一个 Group）"
                className={`${inputCls} w-full font-mono text-xs`}
              />
              <input
                type="text"
                value={addLabelText}
                onChange={(e) => setAddLabelText(e.target.value)}
                placeholder="按钮显示文字"
                className={`${inputCls} w-full text-xs`}
              />
              <input
                type="text"
                value={addToolTip}
                onChange={(e) => setAddToolTip(e.target.value)}
                placeholder="ToolTip 标题（可留空）"
                className={`${inputCls} w-full text-xs`}
              />
              <input
                type="text"
                value={addWebResource}
                onChange={(e) => setAddWebResource(e.target.value)}
                placeholder="Web Resource 名称，例如 new_myscript.js"
                className={`${inputCls} w-full font-mono text-xs`}
              />
              <input
                type="text"
                value={addFunctionName}
                onChange={(e) => setAddFunctionName(e.target.value)}
                placeholder="函数名，例如 MyNamespace.myFunction"
                className={`${inputCls} w-full font-mono text-xs`}
              />
              <button
                onClick={applyAddButtonAction}
                disabled={!addLocation.trim() || !addLabelText.trim() || !addWebResource.trim() || !addFunctionName.trim()}
                className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                应用到上面的 RibbonDiffXml
              </button>
            </div>
          </div>

          {guidedError && (
            <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {guidedError}
            </p>
          )}

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
