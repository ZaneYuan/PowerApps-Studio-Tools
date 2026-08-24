import { useEffect, useMemo, useState } from "react";
import AttributePicker from "../../shared/AttributePicker";
import ErrorMessage from "../../shared/ErrorMessage";
import {
  fetchEntityAttributes,
  fetchMessageFilters,
  fetchMessages,
  fetchStepDetail,
  registerStep,
  updateStep,
  type SdkMessage,
  type SdkMessageFilter,
} from "./dataverseOps";
import { DEPLOYMENT_LABELS, MODE_LABELS, STAGE_LABELS } from "./types";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400";

interface StepRegisterDialogProps {
  connectionId: string;
  pluginTypeId: string;
  pluginTypeName: string;
  /** Present = editing that existing step instead of registering a new one. Message/primary
   *  entity binding is not editable (see updateStep's doc comment) — everything else is. */
  editStepId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function StepRegisterDialog({
  connectionId,
  pluginTypeId,
  pluginTypeName,
  editStepId,
  onClose,
  onSaved,
}: StepRegisterDialogProps) {
  const isEdit = !!editStepId;

  // Message combobox (create mode only) — text input + floating suggestion list, replacing a
  // previous always-open `<select size={6}>` that looked stuck open and didn't feed its
  // selection back into a text box.
  const [messages, setMessages] = useState<SdkMessage[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [messageQuery, setMessageQuery] = useState("");
  const [messageDropdownOpen, setMessageDropdownOpen] = useState(false);
  const [messageId, setMessageId] = useState("");

  const [filters, setFilters] = useState<SdkMessageFilter[] | null>(null);
  const [filterId, setFilterId] = useState("");

  const [attributes, setAttributes] = useState<string[] | null>(null);
  const [selectedAttributes, setSelectedAttributes] = useState<Set<string>>(new Set());

  const [name, setName] = useState("");
  const [stage, setStage] = useState(20);
  const [mode, setMode] = useState(0);
  const [rank, setRank] = useState(1);
  const [unsecureConfig, setUnsecureConfig] = useState("");
  const [secureConfig, setSecureConfig] = useState("");
  const [deployment, setDeployment] = useState(0);

  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editMessageName, setEditMessageName] = useState("");
  const [editEntity, setEditEntity] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (isEdit) return;
    fetchMessages(connectionId)
      .then(setMessages)
      .catch((err) => setMessagesError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  useEffect(() => {
    if (!editStepId) return;
    setEditLoading(true);
    setEditError(null);
    fetchStepDetail(connectionId, editStepId)
      .then((d) => {
        setName(d.name);
        setStage(d.stage);
        setMode(d.mode);
        setRank(d.rank);
        setDeployment(d.supporteddeployment);
        setUnsecureConfig(d.configuration ?? "");
        setEditMessageName(d.sdkmessageid?.name ?? "");
        setEditEntity(d.sdkmessagefilterid?.primaryobjecttypecode ?? null);
        setSelectedAttributes(
          new Set((d.filteringattributes ?? "").split(",").map((a) => a.trim()).filter(Boolean)),
        );
      })
      .catch((err) => setEditError(err instanceof Error ? err.message : String(err)))
      .finally(() => setEditLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editStepId]);

  useEffect(() => {
    if (!editEntity) return;
    fetchEntityAttributes(connectionId, editEntity)
      .then(setAttributes)
      .catch(() => setAttributes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editEntity]);

  useEffect(() => {
    if (isEdit) return;
    setFilterId("");
    setFilters(null);
    setAttributes(null);
    setSelectedAttributes(new Set());
    if (!messageId) return;
    fetchMessageFilters(connectionId, messageId)
      .then(setFilters)
      .catch(() => setFilters([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  useEffect(() => {
    if (isEdit) return;
    setAttributes(null);
    setSelectedAttributes(new Set());
    const entity = filters?.find((f) => f.sdkmessagefilterid === filterId)?.primaryobjecttypecode;
    if (!entity) return;
    fetchEntityAttributes(connectionId, entity)
      .then(setAttributes)
      .catch(() => setAttributes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterId]);

  const filteredMessages = useMemo(() => {
    if (!messages) return [];
    const q = messageQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => m.name.toLowerCase().includes(q));
  }, [messages, messageQuery]);

  const selectedMessage = messages?.find((m) => m.sdkmessageid === messageId);
  const primaryEntity = filters?.find((f) => f.sdkmessagefilterid === filterId)?.primaryobjecttypecode ?? null;

  function selectMessage(m: SdkMessage) {
    setMessageId(m.sdkmessageid);
    setMessageQuery(m.name);
    setMessageDropdownOpen(false);
  }

  function handleMessageQueryChange(v: string) {
    setMessageQuery(v);
    setMessageDropdownOpen(true);
    // Typing invalidates whatever was picked before — a message can only become "selected"
    // again by explicitly clicking a suggestion, never implicitly from stale state.
    if (messageId) setMessageId("");
  }

  function toggleAttribute(name: string) {
    setSelectedAttributes((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAllAttributes(selectAll: boolean) {
    setSelectedAttributes(selectAll ? new Set(attributes) : new Set());
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (isEdit && editStepId) {
        await updateStep(connectionId, editStepId, {
          name,
          stage,
          mode,
          rank,
          filteringAttributes: Array.from(selectedAttributes).join(","),
          unsecureConfig,
          secureConfig,
          deployment,
        });
      } else {
        if (!selectedMessage) return;
        await registerStep(connectionId, {
          pluginTypeId,
          pluginTypeName,
          messageId: selectedMessage.sdkmessageid,
          messageName: selectedMessage.name,
          filterId: filterId || null,
          primaryEntity,
          stage,
          mode,
          rank,
          filteringAttributes: Array.from(selectedAttributes).join(","),
          unsecureConfig,
          secureConfig,
          deployment,
        });
      }
      onSaved();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
        <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {isEdit ? "编辑 Step" : `注册 Step — ${pluginTypeName}`}
        </h3>

        {isEdit && editLoading && <p className="text-xs text-gray-400">加载中…</p>}
        {isEdit && editError && <p className="text-xs text-red-600 dark:text-red-400">{editError}</p>}

        {(!isEdit || (!editLoading && !editError)) && (
          <div className="space-y-4">
            {isEdit ? (
              <>
                <div>
                  <label className={labelCls}>Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                </div>
                <p className="text-xs text-gray-400">
                  Message: <span className="font-medium text-gray-700 dark:text-gray-300">{editMessageName}</span> · 主实体:{" "}
                  <span className="font-medium text-gray-700 dark:text-gray-300">{editEntity ?? "（不限）"}</span>
                  ——注册后不可修改，如需更换请删除该 Step 后重新注册。
                </p>
              </>
            ) : (
              <>
                <div className="relative">
                  <label className={labelCls}>Message</label>
                  {messagesError && <p className="text-xs text-red-600 dark:text-red-400">{messagesError}</p>}
                  <input
                    type="text"
                    placeholder="搜索消息名，如 Create / Update…"
                    value={messageQuery}
                    onChange={(e) => handleMessageQueryChange(e.target.value)}
                    onFocus={() => setMessageDropdownOpen(true)}
                    onBlur={() => setMessageDropdownOpen(false)}
                    className={inputCls}
                  />
                  {messageDropdownOpen && filteredMessages.length > 0 && (
                    <ul
                      // Stops the input from blurring (and this list from disappearing) before
                      // the click below has a chance to register — the classic combobox fix.
                      onMouseDown={(e) => e.preventDefault()}
                      className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
                    >
                      {filteredMessages.map((m) => (
                        <li key={m.sdkmessageid}>
                          <button
                            type="button"
                            onClick={() => selectMessage(m)}
                            className={`block w-full truncate px-2 py-1 text-left text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
                              m.sdkmessageid === messageId
                                ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                                : "text-gray-700 dark:text-gray-300"
                            }`}
                          >
                            {m.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {selectedMessage && (
                    <p className="mt-1 text-xs text-green-600 dark:text-green-400">✓ 已选择：{selectedMessage.name}</p>
                  )}
                </div>

                {messageId && (
                  <div>
                    <label className={labelCls}>主实体（Primary Entity，留空 = 该消息不区分实体）</label>
                    {!filters && <p className="text-xs text-gray-400">加载中…</p>}
                    {filters && filters.length === 0 && (
                      <p className="text-xs text-gray-400">该消息是 org-level，没有主实体可选。</p>
                    )}
                    {filters && filters.length > 0 && (
                      <select value={filterId} onChange={(e) => setFilterId(e.target.value)} className={inputCls}>
                        <option value="">（不限）</option>
                        {filters.map((f) => (
                          <option key={f.sdkmessagefilterid} value={f.sdkmessagefilterid}>
                            {f.primaryobjecttypecode}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Stage</label>
                <select value={stage} onChange={(e) => setStage(Number(e.target.value))} className={inputCls}>
                  {Object.entries(STAGE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Mode</label>
                <select value={mode} onChange={(e) => setMode(Number(e.target.value))} className={inputCls}>
                  {Object.entries(MODE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Rank</label>
                <input
                  type="number"
                  value={rank}
                  onChange={(e) => setRank(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Deployment</label>
              <select value={deployment} onChange={(e) => setDeployment(Number(e.target.value))} className={inputCls}>
                {Object.entries(DEPLOYMENT_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            {attributes && attributes.length > 0 && (
              <AttributePicker
                label="Filtering Attributes（不勾选 = 不过滤，任意字段变化都触发）"
                options={attributes}
                selected={selectedAttributes}
                onToggle={toggleAttribute}
                onToggleAll={toggleAllAttributes}
              />
            )}

            <div>
              <label className={labelCls}>Unsecure Configuration</label>
              <textarea
                value={unsecureConfig}
                onChange={(e) => setUnsecureConfig(e.target.value)}
                rows={2}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Secure Configuration{isEdit ? "（留空 = 不修改现有值）" : ""}</label>
              <textarea
                value={secureConfig}
                onChange={(e) => setSecureConfig(e.target.value)}
                rows={2}
                className={inputCls}
              />
            </div>

            {submitError && <ErrorMessage error={submitError} className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400" />}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={(isEdit ? editLoading : !selectedMessage) || submitting}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "保存中…" : isEdit ? "保存" : "注册 Step"}
          </button>
        </div>
      </div>
    </div>
  );
}
