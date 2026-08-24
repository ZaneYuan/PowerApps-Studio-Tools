import { useState } from "react";
import { createTable, suggestSchemaName } from "./dataverseOps";
import ErrorMessage from "../../shared/ErrorMessage";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";

export default function NewTableDialog({
  connectionId,
  solutionUniqueName,
  publisherPrefix,
  onClose,
  onCreated,
}: {
  connectionId: string;
  solutionUniqueName: string;
  publisherPrefix: string;
  onClose: () => void;
  onCreated: (logicalName: string) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [displayCollectionName, setDisplayCollectionName] = useState("");
  const [displayCollectionNameTouched, setDisplayCollectionNameTouched] = useState(false);
  const [schemaName, setSchemaName] = useState("");
  const [schemaNameTouched, setSchemaNameTouched] = useState(false);
  const [ownershipType, setOwnershipType] = useState<"UserOwned" | "OrganizationOwned">("UserOwned");
  const [description, setDescription] = useState("");
  const [primaryFieldDisplayName, setPrimaryFieldDisplayName] = useState("名称");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleDisplayNameChange(value: string) {
    setDisplayName(value);
    if (!displayCollectionNameTouched) setDisplayCollectionName(value ? `${value}s` : "");
    if (!schemaNameTouched) setSchemaName(suggestSchemaName(publisherPrefix, value));
  }

  async function handleSubmit() {
    if (!displayName.trim() || !schemaName.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { logicalName } = await createTable(connectionId, solutionUniqueName, {
        schemaName: schemaName.trim(),
        displayName: displayName.trim(),
        displayCollectionName: displayCollectionName.trim() || `${displayName.trim()}s`,
        description,
        ownershipType,
        // Matches what make.powerapps itself defaults a new table's primary column to
        // (`<publisherprefix>_name`) — attribute SchemaNames only need to be unique within their
        // own table, so this doesn't collide with other tables reusing the same convention.
        primaryFieldSchemaName: `${publisherPrefix}_name`,
        primaryFieldDisplayName: primaryFieldDisplayName.trim() || "Name",
      });
      onCreated(logicalName);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
        <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">新建表</h3>

        <div className="space-y-3">
          <div>
            <label className={labelCls}>显示名称</label>
            <input value={displayName} onChange={(e) => handleDisplayNameChange(e.target.value)} className={inputCls} placeholder="Bank Account" />
          </div>
          <div>
            <label className={labelCls}>复数显示名称</label>
            <input
              value={displayCollectionName}
              onChange={(e) => {
                setDisplayCollectionName(e.target.value);
                setDisplayCollectionNameTouched(true);
              }}
              className={inputCls}
              placeholder="Bank Accounts"
            />
          </div>
          <div>
            <label className={labelCls}>SchemaName（含 publisher 前缀，创建后不可改）</label>
            <input
              value={schemaName}
              onChange={(e) => {
                setSchemaName(e.target.value);
                setSchemaNameTouched(true);
              }}
              className={`${inputCls} font-mono`}
              placeholder={`${publisherPrefix}_BankAccount`}
            />
          </div>
          <div>
            <label className={labelCls}>主键"名称"字段的显示名</label>
            <input value={primaryFieldDisplayName} onChange={(e) => setPrimaryFieldDisplayName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>所有权类型</label>
            <select value={ownershipType} onChange={(e) => setOwnershipType(e.target.value as "UserOwned" | "OrganizationOwned")} className={inputCls}>
              <option value="UserOwned">User or team owned（用户/团队所有）</option>
              <option value="OrganizationOwned">Organization owned（组织所有）</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>描述（可选）</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
          </div>

          {submitError && <ErrorMessage error={submitError} className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400" />}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!displayName.trim() || !schemaName.trim() || submitting}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
