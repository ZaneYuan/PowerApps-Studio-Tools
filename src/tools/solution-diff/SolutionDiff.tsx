import { useEffect, useMemo, useState } from "react";
import { compareVersions, loadSolutionZip } from "./loadSolution";
import { SECTION_SPECS, diffSection } from "./xmlDiff";
import { diffWebResourceFile } from "./webResourceContent";
import { SectionPanel } from "./components";
import type { SectionDiff, SolutionBundle, WebResourceFileDiff } from "./types";

function FilePicker({
  label,
  bundle,
  loading,
  error,
  onFile,
}: {
  label: string;
  bundle: SolutionBundle | null;
  loading: boolean;
  error: string | null;
  onFile: (f: File) => void;
}) {
  return (
    <div className="flex-1 rounded-lg border border-dashed border-gray-300 p-4 dark:border-gray-700">
      <div className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{label}</div>
      <input
        type="file"
        accept=".zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
        className="block w-full text-xs text-gray-500 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-blue-700 hover:file:bg-blue-100 dark:text-gray-400 dark:file:bg-blue-900/30 dark:file:text-blue-400"
      />
      {loading && <p className="mt-2 text-xs text-gray-400">解析中…</p>}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      {bundle && !loading && (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          <div className="truncate">{bundle.fileName}</div>
          <div>
            {bundle.uniqueName ?? "(未知名称)"} · v{bundle.version ?? "?"}
          </div>
        </div>
      )}
    </div>
  );
}

function applyWebResourceContentDiffs(
  section: SectionDiff,
  contentDiffs: Map<string, WebResourceFileDiff>,
): SectionDiff {
  const items = section.items.map((item) => {
    const content = contentDiffs.get(item.key);
    if (!content || content.status === "unavailable") return item;
    if (item.status !== "unchanged" || content.status === "unchanged") return item;
    return {
      ...item,
      status: "modified" as const,
      diffLines: content.diffLines ?? [
        {
          type: "context" as const,
          text: content.isText ? "(内容不同，但未能生成文本 diff)" : "(二进制内容不同，如图片/图标资源)",
        },
      ],
    };
  });
  return {
    ...section,
    items,
    addedCount: items.filter((i) => i.status === "added").length,
    removedCount: items.filter((i) => i.status === "removed").length,
    modifiedCount: items.filter((i) => i.status === "modified").length,
    unchangedCount: items.filter((i) => i.status === "unchanged").length,
  };
}

export default function SolutionDiff() {
  const [oldBundle, setOldBundle] = useState<SolutionBundle | null>(null);
  const [newBundle, setNewBundle] = useState<SolutionBundle | null>(null);
  const [loadingOld, setLoadingOld] = useState(false);
  const [loadingNew, setLoadingNew] = useState(false);
  const [errorOld, setErrorOld] = useState<string | null>(null);
  const [errorNew, setErrorNew] = useState<string | null>(null);
  const [webResourceDiffs, setWebResourceDiffs] = useState<Map<string, WebResourceFileDiff>>(
    new Map(),
  );

  async function handleFile(file: File, which: "old" | "new") {
    const setLoading = which === "old" ? setLoadingOld : setLoadingNew;
    const setError = which === "old" ? setErrorOld : setErrorNew;
    const setBundle = which === "old" ? setOldBundle : setNewBundle;

    setLoading(true);
    setError(null);
    setBundle(null);
    try {
      const bundle = await loadSolutionZip(file);
      if (!bundle.customizationsXml) {
        setError("zip 中未找到 customizations.xml，请确认这是一个完整的 solution 导出包。");
      } else {
        setBundle(bundle);
      }
    } catch {
      setError("无法解析该文件，请确认这是一个未损坏的 solution.zip。");
    } finally {
      setLoading(false);
    }
  }

  const rawSections = useMemo(() => {
    if (!oldBundle && !newBundle) return [];
    return SECTION_SPECS.map((spec) =>
      diffSection(oldBundle?.customizationsXml ?? null, newBundle?.customizationsXml ?? null, spec),
    );
  }, [oldBundle, newBundle]);

  const webResourceSection = rawSections.find((s) => s.key === "webresources") ?? null;

  useEffect(() => {
    if (!oldBundle || !newBundle || !webResourceSection) return;
    let cancelled = false;

    (async () => {
      const map = new Map<string, WebResourceFileDiff>();
      for (const item of webResourceSection.items) {
        if (item.key.startsWith("#")) continue;
        const result = await diffWebResourceFile(oldBundle.zip, newBundle.zip, item.key);
        if (cancelled) return;
        map.set(item.key, result);
      }
      if (!cancelled) setWebResourceDiffs(map);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldBundle, newBundle]);

  const sections = useMemo(
    () =>
      rawSections.map((s) =>
        s.key === "webresources" ? applyWebResourceContentDiffs(s, webResourceDiffs) : s,
      ),
    [rawSections, webResourceDiffs],
  );

  const versionCompare = useMemo(() => {
    if (!oldBundle?.version || !newBundle?.version) return null;
    const cmp = compareVersions(oldBundle.version, newBundle.version);
    const verdict = cmp < 0 ? "新版本更新" : cmp > 0 ? "新版本是降级" : "版本号相同";
    return { cmp, verdict };
  }, [oldBundle, newBundle]);

  const bothLoaded = oldBundle && newBundle;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        上传两个通过"导出解决方案"得到的 solution.zip（未托管或托管均可）。所有解析都在浏览器本地完成，文件不会上传到任何服务器。
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <FilePicker
          label="旧版本"
          bundle={oldBundle}
          loading={loadingOld}
          error={errorOld}
          onFile={(f) => handleFile(f, "old")}
        />
        <FilePicker
          label="新版本"
          bundle={newBundle}
          loading={loadingNew}
          error={errorNew}
          onFile={(f) => handleFile(f, "new")}
        />
      </div>

      {bothLoaded && (
        <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-mono">{oldBundle.version ?? "?"}</span>
            <span className="mx-2 text-gray-400">→</span>
            <span className="font-mono">{newBundle.version ?? "?"}</span>
            {versionCompare && (
              <span className="ml-3 text-xs text-gray-500 dark:text-gray-400">
                （{versionCompare.verdict}）
              </span>
            )}
          </div>
        </div>
      )}

      {bothLoaded && (
        <div className="space-y-3">
          {sections.map((s) => (
            <SectionPanel key={s.key} section={s} />
          ))}
        </div>
      )}
    </div>
  );
}
