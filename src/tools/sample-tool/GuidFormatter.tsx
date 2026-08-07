import { useMemo, useState } from "react";

function normalize(input: string): string | null {
  const hex = input.trim().replace(/[{}]/g, "");
  const match = hex.match(
    /^([0-9a-fA-F]{8})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{12})$/,
  );
  if (!match) return null;
  return match.slice(1, 6).join("-").toLowerCase();
}

export default function GuidFormatter() {
  const [raw, setRaw] = useState("");

  const normalized = useMemo(() => normalize(raw), [raw]);

  const formats = useMemo(() => {
    if (!normalized) return null;
    return {
      plain: normalized,
      upper: normalized.toUpperCase(),
      braces: `{${normalized.toUpperCase()}}`,
      webApiKey: `guid'${normalized}'`,
    };
  }, [normalized]);

  return (
    <div className="max-w-xl">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        输入 GUID（任意格式：带/不带连字符、带/不带大括号）
      </label>
      <input
        type="text"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="例如：{3F2504E0-4F89-11D3-9A0C-0305E82C3301}"
        className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      />

      {raw.trim() !== "" && !formats && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">
          无法识别为有效 GUID。
        </p>
      )}

      {formats && (
        <div className="mt-5 space-y-3">
          {(
            [
              ["标准格式（小写）", formats.plain],
              ["大写", formats.upper],
              ["大括号（Windows 风格）", formats.braces],
              ["OData Web API key", formats.webApiKey],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50"
            >
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
                <div className="font-mono text-sm text-gray-900 dark:text-gray-100">
                  {value}
                </div>
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(value)}
                className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                复制
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
