import { useEffect, useMemo, useState } from "react";
import {
  fetchEntityAttributes,
  fetchMessageFilters,
  fetchMessages,
  registerStep,
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
  onClose: () => void;
  onRegistered: () => void;
}

export default function StepRegisterDialog({
  connectionId,
  pluginTypeId,
  pluginTypeName,
  onClose,
  onRegistered,
}: StepRegisterDialogProps) {
  const [messages, setMessages] = useState<SdkMessage[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [messageFilter, setMessageFilter] = useState("");
  const [messageId, setMessageId] = useState("");

  const [filters, setFilters] = useState<SdkMessageFilter[] | null>(null);
  const [filterId, setFilterId] = useState("");

  const [attributes, setAttributes] = useState<string[] | null>(null);
  const [selectedAttributes, setSelectedAttributes] = useState<Set<string>>(new Set());

  const [stage, setStage] = useState(20);
  const [mode, setMode] = useState(0);
  const [rank, setRank] = useState(1);
  const [unsecureConfig, setUnsecureConfig] = useState("");
  const [secureConfig, setSecureConfig] = useState("");
  const [deployment, setDeployment] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetchMessages(connectionId)
      .then(setMessages)
      .catch((err) => setMessagesError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  useEffect(() => {
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
    const q = messageFilter.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => m.name.toLowerCase().includes(q));
  }, [messages, messageFilter]);

  const selectedMessage = messages?.find((m) => m.sdkmessageid === messageId);
  const primaryEntity = filters?.find((f) => f.sdkmessagefilterid === filterId)?.primaryobjecttypecode ?? null;

  function toggleAttribute(name: string) {
    setSelectedAttributes((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleSubmit() {
    if (!selectedMessage) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
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
      onRegistered();
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
          注册 Step — {pluginTypeName}
        </h3>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>Message</label>
            {messagesError && <p className="text-xs text-red-600 dark:text-red-400">{messagesError}</p>}
            <input
              type="text"
              placeholder="搜索消息名，如 Create / Update…"
              value={messageFilter}
              onChange={(e) => setMessageFilter(e.target.value)}
              className={`${inputCls} mb-1.5`}
            />
            <select
              value={messageId}
              onChange={(e) => setMessageId(e.target.value)}
              size={6}
              className={inputCls}
            >
              {filteredMessages.map((m) => (
                <option key={m.sdkmessageid} value={m.sdkmessageid}>
                  {m.name}
                </option>
              ))}
            </select>
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
            <div>
              <label className={labelCls}>Filtering Attributes（不勾选 = 不过滤，任意字段变化都触发）</label>
              <div className="max-h-32 overflow-y-auto rounded-md border border-gray-200 p-2 text-xs dark:border-gray-700">
                {attributes.map((a) => (
                  <label key={a} className="mr-3 inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={selectedAttributes.has(a)}
                      onChange={() => toggleAttribute(a)}
                    />
                    {a}
                  </label>
                ))}
              </div>
            </div>
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
            <label className={labelCls}>Secure Configuration</label>
            <textarea
              value={secureConfig}
              onChange={(e) => setSecureConfig(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </div>

          {submitError && (
            <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {submitError}
            </p>
          )}
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
            disabled={!selectedMessage || submitting}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "注册中…" : "注册 Step"}
          </button>
        </div>
      </div>
    </div>
  );
}
