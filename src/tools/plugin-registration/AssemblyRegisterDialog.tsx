import { useEffect, useState } from "react";
import ErrorMessage from "../../shared/ErrorMessage";
import {
  inspectAssembly,
  pickPluginDll,
  registerAssembly,
  updateAssembly,
  type AssemblyInspectionResult,
} from "./dataverseOps";

interface AssemblyRegisterDialogProps {
  connectionId: string;
  /** Present only when updating an already-registered assembly. */
  existingAssemblyId?: string;
  onClose: () => void;
  onRegistered: () => void;
}

export default function AssemblyRegisterDialog({
  connectionId,
  existingAssemblyId,
  onClose,
  onRegistered,
}: AssemblyRegisterDialogProps) {
  const isUpdate = !!existingAssemblyId;

  const [fileName, setFileName] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<AssemblyInspectionResult | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) return;
    setInspecting(true);
    setInspectError(null);
    setInspection(null);
    inspectAssembly(filePath)
      .then((result) => {
        setInspection(result);
        setSelectedTypes(new Set(result.pluginTypes.map((t) => t.typeName)));
      })
      .catch((err) => setInspectError(err instanceof Error ? err.message : String(err)))
      .finally(() => setInspecting(false));
  }, [filePath]);

  async function handleBrowse() {
    try {
      const picked = await pickPluginDll();
      if (picked.filePath) {
        setFileName(picked.fileName);
        setFilePath(picked.filePath);
      }
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleType(typeName: string) {
    setSelectedTypes((s) => {
      const next = new Set(s);
      if (next.has(typeName)) next.delete(typeName);
      else next.add(typeName);
      return next;
    });
  }

  async function handleSubmit() {
    if (!inspection) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (isUpdate && existingAssemblyId) {
        await updateAssembly(connectionId, existingAssemblyId, inspection, selectedTypes);
      } else {
        await registerAssembly(connectionId, inspection, selectedTypes);
      }
      onRegistered();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
        <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {isUpdate ? "更新程序集" : "注册新程序集"}
        </h3>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button
              onClick={handleBrowse}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              浏览…
            </button>
            <span className="truncate text-sm text-gray-500 dark:text-gray-400">
              {fileName ?? "未选择文件"}
            </span>
          </div>

          {inspecting && <p className="text-xs text-gray-400">正在反射分析程序集…</p>}
          {inspectError && <ErrorMessage error={inspectError} className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400" />}

          {inspection && (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
                <div>
                  Name: <span className="font-mono">{inspection.name}</span>
                </div>
                <div>
                  Version: <span className="font-mono">{inspection.version}</span>
                </div>
                <div>
                  Culture: <span className="font-mono">{inspection.culture}</span>
                </div>
                <div>
                  PublicKeyToken: <span className="font-mono">{inspection.publicKeyToken || "(none)"}</span>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                  发现的插件类型（勾选要注册的类型）
                </label>
                {inspection.pluginTypes.length === 0 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    没有找到实现 IPlugin 的公开非抽象类型。
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200 p-2 dark:border-gray-700">
                    {inspection.pluginTypes.map((t) => (
                      <label key={t.typeName} className="flex items-center gap-2 py-0.5 text-xs">
                        <input
                          type="checkbox"
                          checked={selectedTypes.has(t.typeName)}
                          onChange={() => toggleType(t.typeName)}
                        />
                        <span className="font-mono">{t.typeName}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {submitError && <ErrorMessage error={submitError} className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400" />}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!inspection || selectedTypes.size === 0 || submitting}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "提交中…" : isUpdate ? "更新程序集" : "注册程序集"}
          </button>
        </div>
      </div>
    </div>
  );
}

