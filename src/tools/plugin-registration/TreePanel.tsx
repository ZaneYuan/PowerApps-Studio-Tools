import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  fetchAllPluginTypes,
  fetchAllSteps,
  fetchAssemblies,
  fetchImages,
  fetchPluginTypes,
  fetchSteps,
  type PluginStepFlat,
  type PluginTypeFlat,
} from "./dataverseOps";
import {
  IMAGE_TYPE_LABELS,
  MODE_LABELS,
  STAGE_LABELS,
  STEP_STATE_LABELS,
  nodeKey,
  pluginTypeLabel,
  type PluginAssembly,
  type PluginStep,
  type PluginStepImage,
  type PluginType,
  type TreeNodeKind,
} from "./types";

/** One row in the search dropdown. `matched` is false for a row shown only as context for a
 *  matched descendant (e.g. the assembly containing a matched Type) — rendered dimmer. */
interface SearchRow {
  depth: 0 | 1 | 2;
  kind: TreeNodeKind;
  id: string;
  assemblyId: string;
  typeId?: string;
  label: string;
  matched: boolean;
}

const MAX_SEARCH_ROWS = 150;

export interface TreePanelHandle {
  /** Clears the whole tree and reloads the assembly list from scratch. */
  reloadRoot: () => void;
  /** Clears the cached children of one node so the next expand (or an already-expanded
   *  node, immediately) refetches them. Used after a write under that node. */
  invalidateChildrenOf: (kind: TreeNodeKind, id: string) => void;
}

interface TreePanelProps {
  connectionId: string;
  width: number;
  selectedKey: string | null;
  onSelect: (kind: TreeNodeKind, id: string) => void;
  onAddAssembly: () => void;
  onAddStep: (pluginTypeId: string, pluginTypeName: string) => void;
  onAddImage: (stepId: string, messageName: string, primaryEntity: string | null) => void;
  onEditStep: (stepId: string, pluginTypeId: string, pluginTypeName: string) => void;
  onEditImage: (imageId: string, stepId: string) => void;
}

const rowBase =
  "flex w-full items-center gap-1.5 truncate px-1.5 py-1 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800";
const rowSelected = "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400";

function Caret({ open }: { open: boolean }) {
  return <span className="inline-block w-3 shrink-0 text-gray-400">{open ? "▾" : "▸"}</span>;
}

const TreePanel = forwardRef<TreePanelHandle, TreePanelProps>(function TreePanel(
  { connectionId, width, selectedKey, onSelect, onAddAssembly, onAddStep, onAddImage, onEditStep, onEditImage },
  ref,
) {
  const [assemblies, setAssemblies] = useState<PluginAssembly[] | null>(null);

  const [typesCache, setTypesCache] = useState<Record<string, PluginType[]>>({});
  const [stepsCache, setStepsCache] = useState<Record<string, PluginStep[]>>({});
  const [imagesCache, setImagesCache] = useState<Record<string, PluginStepImage[]>>({});

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});

  // Fuzzy search across Assembly/Type/Step names. Rather than cascading a fetch per matched
  // Assembly and then per matched Type (which is what made the old version slow), this loads
  // every Type and every Step org-wide in two flat queries the first time the user searches,
  // then matches names against those in-memory lists. The tree itself is never filtered by
  // search — matches surface in a dropdown below the box, and picking one expands/scrolls the
  // always-complete tree to that node.
  const [searchQuery, setSearchQuery] = useState("");
  const searching = searchQuery.trim().length > 0;
  const q = searchQuery.trim().toLowerCase();
  const [allTypesFlat, setAllTypesFlat] = useState<PluginTypeFlat[] | null>(null);
  const [allStepsFlat, setAllStepsFlat] = useState<PluginStepFlat[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null);

  // Rows that support double-click-to-edit also have a plain onClick (select/load detail) — a
  // real double-click fires two native `click` events before the `dblclick`, so without this
  // both the select handler's own request AND the edit handler's fire together. Delaying the
  // single-click action lets a following dblclick cancel it instead.
  const clickTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function debouncedClick(key: string, action: () => void) {
    const pending = clickTimers.current[key];
    if (pending) {
      clearTimeout(pending);
      delete clickTimers.current[key];
      return;
    }
    clickTimers.current[key] = setTimeout(() => {
      delete clickTimers.current[key];
      action();
    }, 250);
  }

  function assemblyMatches(asm: PluginAssembly): boolean {
    return asm.name.toLowerCase().includes(q);
  }
  function typeMatches(t: PluginType): boolean {
    return pluginTypeLabel(t).toLowerCase().includes(q) || t.typename.toLowerCase().includes(q);
  }
  function stepMatches(s: PluginStep): boolean {
    return s.name.toLowerCase().includes(q);
  }

  function withLoading(key: string, fn: () => Promise<void>) {
    setLoadingKeys((s) => new Set(s).add(key));
    setErrorByKey((e) => {
      const { [key]: _drop, ...rest } = e;
      return rest;
    });
    fn()
      .catch((err) => setErrorByKey((e) => ({ ...e, [key]: err instanceof Error ? err.message : String(err) })))
      .finally(() => setLoadingKeys((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      }));
  }

  function loadAssemblies() {
    withLoading("root", async () => setAssemblies(await fetchAssemblies(connectionId)));
  }

  useEffect(() => {
    setAssemblies(null);
    setTypesCache({});
    setStepsCache({});
    setImagesCache({});
    setExpanded(new Set());
    setAllTypesFlat(null);
    setAllStepsFlat(null);
    setSearchError(null);
    setSearchQuery("");
    loadAssemblies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  function loadTypes(assemblyId: string) {
    withLoading(nodeKey("assembly", assemblyId), async () => {
      const types = await fetchPluginTypes(connectionId, assemblyId);
      setTypesCache((c) => ({ ...c, [assemblyId]: types }));
    });
  }

  function loadSteps(typeId: string) {
    withLoading(nodeKey("type", typeId), async () => {
      const steps = await fetchSteps(connectionId, typeId);
      setStepsCache((c) => ({ ...c, [typeId]: steps }));
    });
  }

  function loadImages(stepId: string) {
    withLoading(nodeKey("step", stepId), async () => {
      const images = await fetchImages(connectionId, stepId);
      setImagesCache((c) => ({ ...c, [stepId]: images }));
    });
  }

  // The first time the user searches, load every Type and every Step org-wide in one shot each
  // (not per-assembly/per-type) and keep them cached for the rest of the session.
  useEffect(() => {
    if (!searching || (allTypesFlat && allStepsFlat) || searchLoading) return;
    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    Promise.all([fetchAllPluginTypes(connectionId), fetchAllSteps(connectionId)])
      .then(([types, steps]) => {
        if (cancelled) return;
        setAllTypesFlat(types);
        setAllStepsFlat(steps);
      })
      .catch((err) => {
        if (!cancelled) setSearchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, connectionId]);

  // Independently match names against Assembly/Type/Step, then combine matches into the
  // Assembly > Type > Step hierarchy for display — a non-matching ancestor is included only as
  // context for a matched descendant (`matched: false`, rendered dimmer).
  const searchRows = useMemo<SearchRow[]>(() => {
    if (!searching || !assemblies) return [];
    const asmById = new Map(assemblies.map((a) => [a.pluginassemblyid, a]));
    const typeById = new Map((allTypesFlat ?? []).map((t) => [t.plugintypeid, t]));

    interface TypeGroup {
      type: PluginType;
      matched: boolean;
      steps: PluginStep[];
    }
    interface AsmGroup {
      assembly: PluginAssembly;
      matched: boolean;
      types: Map<string, TypeGroup>;
    }
    const groups = new Map<string, AsmGroup>();
    function ensureGroup(asm: PluginAssembly): AsmGroup {
      let g = groups.get(asm.pluginassemblyid);
      if (!g) {
        g = { assembly: asm, matched: false, types: new Map() };
        groups.set(asm.pluginassemblyid, g);
      }
      return g;
    }
    function ensureType(g: AsmGroup, t: PluginType): TypeGroup {
      let tg = g.types.get(t.plugintypeid);
      if (!tg) {
        tg = { type: t, matched: false, steps: [] };
        g.types.set(t.plugintypeid, tg);
      }
      return tg;
    }

    for (const asm of assemblies) {
      if (assemblyMatches(asm)) ensureGroup(asm).matched = true;
    }
    for (const t of allTypesFlat ?? []) {
      if (!typeMatches(t)) continue;
      const asm = asmById.get(t._pluginassemblyid_value);
      if (!asm) continue;
      ensureType(ensureGroup(asm), t).matched = true;
    }
    for (const s of allStepsFlat ?? []) {
      if (!stepMatches(s)) continue;
      const t = typeById.get(s._eventhandler_value);
      const asm = t && asmById.get(t._pluginassemblyid_value);
      if (!t || !asm) continue;
      ensureType(ensureGroup(asm), t).steps.push(s);
    }

    const rows: SearchRow[] = [];
    const sortedGroups = [...groups.values()].sort((a, b) => a.assembly.name.localeCompare(b.assembly.name));
    for (const g of sortedGroups) {
      rows.push({
        depth: 0,
        kind: "assembly",
        id: g.assembly.pluginassemblyid,
        assemblyId: g.assembly.pluginassemblyid,
        label: g.assembly.name,
        matched: g.matched,
      });
      const sortedTypes = [...g.types.values()].sort((a, b) =>
        pluginTypeLabel(a.type).localeCompare(pluginTypeLabel(b.type)),
      );
      for (const tg of sortedTypes) {
        rows.push({
          depth: 1,
          kind: "type",
          id: tg.type.plugintypeid,
          assemblyId: g.assembly.pluginassemblyid,
          typeId: tg.type.plugintypeid,
          label: pluginTypeLabel(tg.type),
          matched: tg.matched,
        });
        for (const s of tg.steps) {
          rows.push({
            depth: 2,
            kind: "step",
            id: s.sdkmessageprocessingstepid,
            assemblyId: g.assembly.pluginassemblyid,
            typeId: tg.type.plugintypeid,
            label: `${s.sdkmessageid?.name ?? "?"} · ${STAGE_LABELS[s.stage] ?? s.stage}`,
            matched: true,
          });
        }
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, q, assemblies, allTypesFlat, allStepsFlat]);

  // Picking a dropdown result expands its ancestors (seeding their caches from the flat search
  // data, so no extra fetch is needed) and scrolls the always-complete tree to that node.
  function jumpTo(row: SearchRow) {
    if (allTypesFlat && !typesCache[row.assemblyId]) {
      const types = allTypesFlat.filter((t) => t._pluginassemblyid_value === row.assemblyId);
      setTypesCache((c) => ({ ...c, [row.assemblyId]: types }));
    }
    if (row.typeId && allStepsFlat && !stepsCache[row.typeId]) {
      const typeId = row.typeId;
      const steps = allStepsFlat.filter((s) => s._eventhandler_value === typeId);
      setStepsCache((c) => ({ ...c, [typeId]: steps }));
    }
    setExpanded((s) => {
      const next = new Set(s);
      next.add(nodeKey("assembly", row.assemblyId));
      if (row.typeId) next.add(nodeKey("type", row.typeId));
      return next;
    });
    onSelect(row.kind, row.id);
    setSearchQuery("");
    setPendingScrollKey(nodeKey(row.kind, row.id));
  }

  // The target row may not exist in the DOM yet right after jumpTo (its ancestor still needs a
  // render pass to pick up the newly-expanded/cached state) — re-check on every relevant state
  // change until it does, then scroll and stop.
  useEffect(() => {
    if (!pendingScrollKey) return;
    const el = document.getElementById(pendingScrollKey);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setPendingScrollKey(null);
    }
  }, [pendingScrollKey, expanded, typesCache, stepsCache]);

  function toggle(key: string, loadFn: () => void, alreadyLoaded: boolean) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        if (!alreadyLoaded) loadFn();
      }
      return next;
    });
  }

  useImperativeHandle(ref, () => ({
    reloadRoot: loadAssemblies,
    invalidateChildrenOf(kind, id) {
      const key = nodeKey(kind, id);
      if (kind === "assembly") {
        setTypesCache((c) => {
          const { [id]: _drop, ...rest } = c;
          return rest;
        });
      } else if (kind === "type") {
        setStepsCache((c) => {
          const { [id]: _drop, ...rest } = c;
          return rest;
        });
      } else if (kind === "step") {
        setImagesCache((c) => {
          const { [id]: _drop, ...rest } = c;
          return rest;
        });
      }
      if (expanded.has(key)) {
        if (kind === "assembly") loadTypes(id);
        else if (kind === "type") loadSteps(id);
        else if (kind === "step") loadImages(id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }));

  return (
    <div className="flex shrink-0 flex-col rounded-lg border border-gray-200 dark:border-gray-800" style={{ width }}>
      <div className="border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between p-2">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Assembly / Type / Step / Image</span>
          <button
            onClick={onAddAssembly}
            className="rounded border border-blue-300 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
          >
            + 注册程序集
          </button>
        </div>
        <div className="relative px-2 pb-2">
          <input
            type="text"
            placeholder="模糊搜索 Assembly / Type / Step…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          {searching && (
            <div className="absolute inset-x-2 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
              {searchLoading && <p className="p-2 text-xs text-gray-400">正在搜索…</p>}
              {searchError && <p className="p-2 text-xs text-red-500">{searchError}</p>}
              {!searchLoading && !searchError && searchRows.length === 0 && (
                <p className="p-2 text-xs text-gray-400">没有匹配的 Assembly / Type / Step。</p>
              )}
              {!searchLoading &&
                searchRows.slice(0, MAX_SEARCH_ROWS).map((row) => (
                  <button
                    key={`${row.kind}:${row.id}`}
                    onClick={() => jumpTo(row)}
                    style={{ paddingLeft: 8 + row.depth * 14 }}
                    className={`flex w-full items-center gap-1 truncate py-1 pr-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800 ${
                      row.matched ? "text-gray-900 dark:text-gray-100" : "text-gray-400 dark:text-gray-500"
                    }`}
                    title={row.label}
                  >
                    {row.kind === "assembly" ? "📦" : row.kind === "type" ? "🧩" : "⚙️"} {row.label}
                  </button>
                ))}
              {searchRows.length > MAX_SEARCH_ROWS && (
                <p className="px-2 py-1 text-[10px] text-gray-400">还有更多匹配项，请输入更精确的关键字缩小范围。</p>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {errorByKey.root && <p className="p-2 text-xs text-red-600 dark:text-red-400">{errorByKey.root}</p>}
        {!assemblies && !errorByKey.root && <p className="p-2 text-xs text-gray-400">加载中…</p>}
        {assemblies && assemblies.length === 0 && <p className="p-2 text-xs text-gray-400">还没有注册任何程序集。</p>}
        <ul>
          {assemblies?.map((asm) => {
              const key = nodeKey("assembly", asm.pluginassemblyid);
              const open = expanded.has(key);
              const types = typesCache[asm.pluginassemblyid];
              return (
              <li key={asm.pluginassemblyid}>
                <div id={key} className={`${rowBase} ${selectedKey === key ? rowSelected : ""}`}>
                  <button onClick={() => toggle(key, () => loadTypes(asm.pluginassemblyid), !!types)}>
                    <Caret open={open} />
                  </button>
                  <button
                    className="flex-1 truncate text-left"
                    onClick={() => onSelect("assembly", asm.pluginassemblyid)}
                    title={asm.name}
                  >
                    📦 {asm.name} <span className="text-xs text-gray-400">v{asm.version}</span>
                  </button>
                </div>
                {open && (
                  <ul className="ml-4 border-l border-gray-100 pl-2 dark:border-gray-800">
                    {loadingKeys.has(key) && <li className="p-1 text-xs text-gray-400">加载类型…</li>}
                    {errorByKey[key] && <li className="p-1 text-xs text-red-500">{errorByKey[key]}</li>}
                    {types && types.length === 0 && <li className="p-1 text-xs text-gray-400">没有插件类型。</li>}
                    {types?.map((t) => {
                      const tKey = nodeKey("type", t.plugintypeid);
                      const tOpen = expanded.has(tKey);
                      const steps = stepsCache[t.plugintypeid];
                      return (
                        <li key={t.plugintypeid}>
                          <div id={tKey} className={`${rowBase} ${selectedKey === tKey ? rowSelected : ""}`}>
                            <button onClick={() => toggle(tKey, () => loadSteps(t.plugintypeid), !!steps)}>
                              <Caret open={tOpen} />
                            </button>
                            <button
                              className="flex-1 truncate text-left"
                              onClick={() => onSelect("type", t.plugintypeid)}
                              title={t.typename}
                            >
                              🧩 {pluginTypeLabel(t)}
                            </button>
                            <button
                              onClick={() => onAddStep(t.plugintypeid, pluginTypeLabel(t))}
                              className="shrink-0 px-1 text-xs text-blue-500 hover:underline"
                              title="注册 Step"
                            >
                              +Step
                            </button>
                          </div>
                          {tOpen && (
                            <ul className="ml-4 border-l border-gray-100 pl-2 dark:border-gray-800">
                              {loadingKeys.has(tKey) && <li className="p-1 text-xs text-gray-400">加载 Step…</li>}
                              {errorByKey[tKey] && <li className="p-1 text-xs text-red-500">{errorByKey[tKey]}</li>}
                              {steps && steps.length === 0 && <li className="p-1 text-xs text-gray-400">没有 Step。</li>}
                              {steps?.map((s) => {
                                const sKey = nodeKey("step", s.sdkmessageprocessingstepid);
                                const sOpen = expanded.has(sKey);
                                const images = imagesCache[s.sdkmessageprocessingstepid];
                                const entity = s.sdkmessagefilterid?.primaryobjecttypecode;
                                return (
                                  <li key={s.sdkmessageprocessingstepid}>
                                    <div id={sKey} className={`${rowBase} ${selectedKey === sKey ? rowSelected : ""}`}>
                                      <button
                                        onClick={() =>
                                          toggle(sKey, () => loadImages(s.sdkmessageprocessingstepid), !!images)
                                        }
                                      >
                                        <Caret open={sOpen} />
                                      </button>
                                      <button
                                        className="min-w-0 flex-1 truncate text-left"
                                        onClick={() =>
                                          debouncedClick(sKey, () => onSelect("step", s.sdkmessageprocessingstepid))
                                        }
                                        onDoubleClick={() =>
                                          onEditStep(s.sdkmessageprocessingstepid, t.plugintypeid, pluginTypeLabel(t))
                                        }
                                        title={`${s.name}（双击编辑）`}
                                      >
                                        ⚙️ {s.sdkmessageid?.name ?? "?"}
                                        {entity ? `(${entity})` : ""} · {STAGE_LABELS[s.stage] ?? s.stage} ·{" "}
                                        {MODE_LABELS[s.mode] ?? s.mode}
                                        {s.statecode !== 0 && (
                                          <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-gray-800">
                                            {STEP_STATE_LABELS[s.statecode] ?? s.statecode}
                                          </span>
                                        )}
                                      </button>
                                      <button
                                        onClick={() =>
                                          onAddImage(s.sdkmessageprocessingstepid, s.sdkmessageid?.name ?? "", entity ?? null)
                                        }
                                        className="shrink-0 px-1 text-xs text-blue-500 hover:underline"
                                        title="注册 Image"
                                      >
                                        +Image
                                      </button>
                                    </div>
                                    {sOpen && (
                                      <ul className="ml-4 border-l border-gray-100 pl-2 dark:border-gray-800">
                                        {loadingKeys.has(sKey) && (
                                          <li className="p-1 text-xs text-gray-400">加载 Image…</li>
                                        )}
                                        {errorByKey[sKey] && (
                                          <li className="p-1 text-xs text-red-500">{errorByKey[sKey]}</li>
                                        )}
                                        {images && images.length === 0 && (
                                          <li className="p-1 text-xs text-gray-400">没有 Image。</li>
                                        )}
                                        {images?.map((img) => {
                                          const iKey = nodeKey("image", img.sdkmessageprocessingstepimageid);
                                          return (
                                            <li key={img.sdkmessageprocessingstepimageid}>
                                              <button
                                                className={`${rowBase} ${selectedKey === iKey ? rowSelected : ""}`}
                                                onClick={() =>
                                                  debouncedClick(iKey, () =>
                                                    onSelect("image", img.sdkmessageprocessingstepimageid),
                                                  )
                                                }
                                                onDoubleClick={() =>
                                                  onEditImage(img.sdkmessageprocessingstepimageid, s.sdkmessageprocessingstepid)
                                                }
                                                title={`${img.name}（双击编辑）`}
                                              >
                                                <span className="inline-block w-3 shrink-0" />
                                                🖼️ {img.entityalias}{" "}
                                                <span className="text-xs text-gray-400">
                                                  ({IMAGE_TYPE_LABELS[img.imagetype] ?? img.imagetype})
                                                </span>
                                              </button>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
});

export default TreePanel;
