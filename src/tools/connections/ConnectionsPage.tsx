import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";

interface ConnectionDto {
  id: string;
  name: string;
  environmentUrl: string;
  authType: "Interactive" | "ClientSecret";
  tenantId?: string;
  clientId?: string;
  hasSecret: boolean;
}

type AuthTypeInput = "interactive" | "clientSecret";

interface FormState {
  name: string;
  environmentUrl: string;
  authType: AuthTypeInput;
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

const emptyForm: FormState = {
  name: "",
  environmentUrl: "",
  authType: "interactive",
  tenantId: "",
  clientId: "",
  clientSecret: "",
};

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

interface ConnectionStatus {
  loading?: boolean;
  message?: string;
  error?: string;
}

export default function ConnectionsPage() {
  const available = isNativeBridgeAvailable();
  const [connections, setConnections] = useState<ConnectionDto[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, ConnectionStatus>>({});

  async function refresh() {
    const list = await callNative<ConnectionDto[]>("connections.list");
    setConnections(list);
  }

  useEffect(() => {
    if (available) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await callNative("connections.add", {
        name: form.name,
        environmentUrl: form.environmentUrl,
        authType: form.authType,
        tenantId: form.tenantId || undefined,
        clientId: form.clientId || undefined,
        clientSecret: form.clientSecret || undefined,
      });
      setForm(emptyForm);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemove(id: string) {
    await callNative("connections.remove", { id });
    await refresh();
  }

  async function handleWhoAmI(id: string) {
    setStatus((s) => ({ ...s, [id]: { loading: true } }));
    try {
      await callNative("auth.login", { connectionId: id });
      const result = await callNative<Record<string, unknown>>("dataverse.request", {
        connectionId: id,
        method: "GET",
        path: "WhoAmI",
      });
      setStatus((s) => ({ ...s, [id]: { message: JSON.stringify(result, null, 2) } }));
    } catch (err) {
      setStatus((s) => ({ ...s, [id]: { error: err instanceof Error ? err.message : String(err) } }));
    }
  }

  if (!available) {
    return (
      <div className="max-w-xl rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        此功能仅在桌面版（WebView2 壳）中可用，当前在普通浏览器里打开，看不到已保存的连接。
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">已保存的连接</h2>
        {connections.length === 0 ? (
          <p className="text-sm text-gray-400">还没有连接，在下面添加一个。</p>
        ) : (
          <div className="space-y-3">
            {connections.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">{c.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {c.environmentUrl} · {c.authType === "Interactive" ? "交互式登录" : "Client Secret"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleWhoAmI(c.id)}
                      disabled={status[c.id]?.loading}
                      className="rounded-md border border-blue-300 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
                    >
                      {status[c.id]?.loading ? "登录并调用中…" : "登录 + WhoAmI"}
                    </button>
                    <button
                      onClick={() => handleRemove(c.id)}
                      className="text-xs text-gray-400 hover:text-red-500"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {status[c.id]?.error && (
                  <pre className="mt-2 overflow-x-auto rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
                    {status[c.id].error}
                  </pre>
                )}
                {status[c.id]?.message && (
                  <pre className="mt-2 overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
                    {status[c.id].message}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">添加连接</h2>

        <input
          type="text"
          placeholder="连接名称"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
          className={inputCls}
        />
        <input
          type="text"
          placeholder="环境 URL，例如 https://xxx.crm5.dynamics.com"
          value={form.environmentUrl}
          onChange={(e) => setForm((f) => ({ ...f, environmentUrl: e.target.value }))}
          required
          className={inputCls}
        />
        <select
          value={form.authType}
          onChange={(e) => setForm((f) => ({ ...f, authType: e.target.value as AuthTypeInput }))}
          className={inputCls}
        >
          <option value="interactive">交互式登录（用户本人登录）</option>
          <option value="clientSecret">Client Secret（应用身份）</option>
        </select>

        {form.authType === "clientSecret" && (
          <>
            <input
              type="text"
              placeholder="Tenant ID"
              value={form.tenantId}
              onChange={(e) => setForm((f) => ({ ...f, tenantId: e.target.value }))}
              className={inputCls}
            />
            <input
              type="text"
              placeholder="Client ID"
              value={form.clientId}
              onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
              className={inputCls}
            />
            <input
              type="password"
              placeholder="Client Secret"
              value={form.clientSecret}
              onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))}
              className={inputCls}
            />
          </>
        )}

        {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}

        <button
          type="submit"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          添加
        </button>
      </form>
    </div>
  );
}
