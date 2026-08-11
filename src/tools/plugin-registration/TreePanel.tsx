import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { fetchAssemblies, fetchImages, fetchPluginTypes, fetchSteps } from "./dataverseOps";
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

export interface TreePanelHandle {
  /** Clears the whole tree and reloads the assembly list from scratch. */
  reloadRoot: () => void;
  /** Clears the cached children of one node so the next expand (or an already-expanded
   *  node, immediately) refetches them. Used after a write under that node. */
  invalidateChildrenOf: (kind: TreeNodeKind, id: string) => void;
}

interface TreePanelProps {
  connectionId: string;
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
  { connectionId, selectedKey, onSelect, onAddAssembly, onAddStep, onAddImage, onEditStep, onEditImage },
  ref,
) {
  const [assemblies, setAssemblies] = useState<PluginAssembly[] | null>(null);

  const [typesCache, setTypesCache] = useState<Record<string, PluginType[]>>({});
  const [stepsCache, setStepsCache] = useState<Record<string, PluginStep[]>>({});
  const [imagesCache, setImagesCache] = useState<Record<string, PluginStepImage[]>>({});

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});

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
    <div className="flex w-96 shrink-0 flex-col rounded-lg border border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between border-b border-gray-200 p-2 dark:border-gray-800">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Assembly / Type / Step / Image</span>
        <button
          onClick={onAddAssembly}
          className="rounded border border-blue-300 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
        >
          + 注册程序集
        </button>
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
                <div className={`${rowBase} ${selectedKey === key ? rowSelected : ""}`}>
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
                          <div className={`${rowBase} ${selectedKey === tKey ? rowSelected : ""}`}>
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
                                    <div className={`${rowBase} ${selectedKey === sKey ? rowSelected : ""}`}>
                                      <button
                                        onClick={() =>
                                          toggle(sKey, () => loadImages(s.sdkmessageprocessingstepid), !!images)
                                        }
                                      >
                                        <Caret open={sOpen} />
                                      </button>
                                      <button
                                        className="min-w-0 flex-1 truncate text-left"
                                        onClick={() => onSelect("step", s.sdkmessageprocessingstepid)}
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
                                                onClick={() => onSelect("image", img.sdkmessageprocessingstepimageid)}
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
