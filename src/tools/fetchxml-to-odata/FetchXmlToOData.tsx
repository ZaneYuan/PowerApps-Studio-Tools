import { useMemo, useState } from "react";
import { convertFetchXmlToOData, naivePluralize } from "./convert";

const SAMPLE = `<fetch top="50">
  <entity name="account">
    <attribute name="name" />
    <attribute name="revenue" />
    <order attribute="name" descending="false" />
    <filter type="and">
      <condition attribute="statecode" operator="eq" value="0" />
      <filter type="or">
        <condition attribute="name" operator="like" value="Contoso%" />
        <condition attribute="telephone1" operator="not-null" />
      </filter>
    </filter>
    <link-entity name="contact" from="parentcustomerid" to="accountid" alias="primarycontact">
      <attribute name="fullname" />
    </link-entity>
  </entity>
</fetch>`;

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

function OutputRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
        <button
          onClick={() => navigator.clipboard.writeText(value)}
          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          复制
        </button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
        {value}
      </pre>
    </div>
  );
}

export default function FetchXmlToOData() {
  const [fetchXml, setFetchXml] = useState("");
  const [entitySetOverride, setEntitySetOverride] = useState("");

  const result = useMemo(() => convertFetchXmlToOData(fetchXml), [fetchXml]);
  const guessedEntitySet = result.entityName ? naivePluralize(result.entityName) : "";
  const entitySet = entitySetOverride || guessedEntitySet;

  const queryParts = useMemo(() => {
    const parts: string[] = [];
    if (result.select) parts.push(`$select=${result.select}`);
    if (result.expand) parts.push(`$expand=${result.expand}`);
    if (result.filter) parts.push(`$filter=${result.filter}`);
    if (result.orderby) parts.push(`$orderby=${result.orderby}`);
    if (result.top) parts.push(`$top=${result.top}`);
    for (const p of result.aliasParams) parts.push(`${p.name}=${p.value}`);
    return parts;
  }, [result]);

  const fullUrl = entitySet
    ? `[Organization URI]/api/data/v9.2/${entitySet}${queryParts.length ? `?${queryParts.join("&")}` : ""}`
    : "";

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-400">
        基于启发式规则转换，不读取实际字段元数据（字段类型、查找字段导航属性名等），请核对生成结果后再使用，尤其是标记为"尽力而为"的日期专属函数和
        link-entity → $expand 部分。
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">FetchXML</label>
          <button
            onClick={() => setFetchXml(SAMPLE)}
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            填充示例
          </button>
        </div>
        <textarea
          value={fetchXml}
          onChange={(e) => setFetchXml(e.target.value)}
          rows={12}
          spellCheck={false}
          placeholder="粘贴 FetchXML..."
          className={inputCls}
        />
      </div>

      {result.error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {result.error}
        </div>
      )}

      {result.entityName && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-500 dark:text-gray-400">实体：</span>
            <code className="rounded bg-gray-100 px-2 py-0.5 dark:bg-gray-800">{result.entityName}</code>
            <span className="text-gray-500 dark:text-gray-400">Entity Set Name（猜测，可编辑）：</span>
            <input
              type="text"
              value={entitySetOverride}
              onChange={(e) => setEntitySetOverride(e.target.value)}
              placeholder={guessedEntitySet}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          <div className="space-y-4">
            <OutputRow label="$select" value={result.select} />
            <OutputRow label="$expand" value={result.expand} />
            <OutputRow label="$filter" value={result.filter} />
            <OutputRow label="$orderby" value={result.orderby} />
            <OutputRow label="$top" value={result.top} />
          </div>

          {result.aliasParams.length > 0 && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <div className="mb-1 font-medium">别名参数（In / NotIn 需要作为独立查询参数拼接）：</div>
              {result.aliasParams.map((p) => (
                <div key={p.name} className="font-mono">
                  &amp;{p.name}={p.value}
                </div>
              ))}
            </div>
          )}

          <OutputRow label="完整请求示例" value={fullUrl} />
        </>
      )}

      {result.warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          {result.warnings.map((w, i) => (
            <div key={i} className="mb-1 last:mb-0">
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
