import { useEffect, useState } from "react";
import { fetchOptionSetValues, type OptionSetValue } from "../../native/metadataService";
import { useEntityAttributes } from "../../native/useEntityAttributes";
import LookupPickerModal from "../../shared/LookupPickerModal";
import { MULTI_VALUE_OPERATORS, type ConditionOperator } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

// A polymorphic lookup (customerid -> account/contact, ownerid/createdby/modifiedby ->
// systemuser/team) reports as "Customer"/"Owner" in attribute metadata, not "Lookup" — checking
// only "Lookup" would silently skip the search-icon treatment for these very common fields.
const LOOKUP_TYPES = new Set(["Lookup", "Customer", "Owner"]);

/** Appends `next` to a comma-separated list (used for in/not-in), skipping an exact duplicate —
 *  matches serialize.ts's own trim+filter-empty parsing of MULTI_VALUE_OPERATORS values. */
function appendValue(current: string, next: string): string {
  const parts = current
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.includes(next)) parts.push(next);
  return parts.join(",");
}

/** The condition value input, upgraded from a plain text box to a type-aware widget once the
 *  field's real attribute type is known (via `useEntityAttributes`): Lookup/Customer/Owner get a
 *  search icon that opens `LookupPickerModal`; Picklist gets a real `<select>`; everything else
 *  (String/Integer/Boolean/DateTime, and the v1-out-of-scope State/Status/MultiSelectPicklist —
 *  `fetchOptionSetValues` only covers Picklist, see its own doc comment) stays plain text,
 *  unchanged from before this component existed. */
export default function ConditionValueInput({
  connectionId,
  entityLogicalName,
  attribute,
  operator,
  value,
  onChange,
  className,
}: {
  connectionId: string | null;
  entityLogicalName: string;
  attribute: string;
  operator: ConditionOperator;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const { attributes } = useEntityAttributes(connectionId, entityLogicalName);
  const attrType = attributes?.find((a) => a.logicalName.toLowerCase() === attribute.trim().toLowerCase())?.attributeType;
  const multiValue = MULTI_VALUE_OPERATORS.includes(operator);
  const isLookup = !!attrType && LOOKUP_TYPES.has(attrType);
  const isPicklist = attrType === "Picklist";

  const [modalOpen, setModalOpen] = useState(false);
  const [options, setOptions] = useState<OptionSetValue[] | null>(null);

  useEffect(() => {
    if (!isPicklist || !connectionId || !entityLogicalName.trim() || !attribute.trim()) {
      setOptions(null);
      return;
    }
    let cancelled = false;
    fetchOptionSetValues(connectionId, entityLogicalName, attribute)
      .then((opts) => {
        if (!cancelled) setOptions(opts);
      })
      .catch(() => {
        if (!cancelled) setOptions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isPicklist, connectionId, entityLogicalName, attribute]);

  if (isLookup) {
    return (
      <>
        <div className={`flex items-center gap-1 ${className ?? ""}`}>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="值"
            className={`${inputCls} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            title="搜索并选择记录"
            aria-label="搜索并选择记录"
            disabled={!connectionId}
            className="shrink-0 rounded border border-gray-300 px-1.5 py-1 text-xs hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            🔍
          </button>
        </div>
        {modalOpen && connectionId && (
          <LookupPickerModal
            connectionId={connectionId}
            entityLogicalName={entityLogicalName}
            attributeLogicalName={attribute}
            multiValue={multiValue}
            onPick={(picked) => onChange(multiValue ? appendValue(value, picked) : picked)}
            onClose={() => setModalOpen(false)}
          />
        )}
      </>
    );
  }

  if (isPicklist && !multiValue) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} ${className ?? ""}`}>
        <option value="" />
        {options?.map((o) => (
          <option key={o.value} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (isPicklist && multiValue) {
    return (
      <div className={`flex items-center gap-1 ${className ?? ""}`}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="值（逗号分隔）"
          className={`${inputCls} min-w-0 flex-1`}
        />
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange(appendValue(value, e.target.value));
          }}
          title="选一个选项追加到左侧的值列表"
          className={`${inputCls} w-20 shrink-0`}
        >
          <option value="">+ 添加</option>
          {options?.map((o) => (
            <option key={o.value} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="值" className={`${inputCls} ${className ?? ""}`} />
  );
}
