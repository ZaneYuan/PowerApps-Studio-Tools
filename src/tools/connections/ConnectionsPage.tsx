import { useState } from "react";
import type { FormEvent } from "react";
import { callNative, isNativeBridgeAvailable } from "../../native/bridge";
import { useActiveConnection, type ConnectionDto } from "../../native/activeConnection";
import { parseConnectionString } from "./connectionString";
import ErrorMessage from "../../shared/ErrorMessage";

type AuthTypeInput = "interactive" | "clientSecret" | "certificate";

interface FormState {
  name: string;
  environmentUrl: string;
  authType: AuthTypeInput;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  certificateFilePath: string;
  certificatePassword: string;
  allowWrite: boolean;
}

const emptyForm: FormState = {
  name: "",
  environmentUrl: "",
  authType: "interactive",
  tenantId: "",
  clientId: "",
  clientSecret: "",
  certificateFilePath: "",
  certificatePassword: "",
  allowWrite: true,
};

const AUTH_TYPE_LABELS: Record<string, string> = {
  Interactive: "交互式登录",
  ClientSecret: "Client Secret",
  Certificate: "证书认证",
};

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

interface ConnectionStatus {
  loading?: boolean;
  message?: string;
  error?: string;
}

interface PasswordLoginState {
  open: boolean;
  username: string;
  password: string;
}

const emptyPasswordLogin: PasswordLoginState = { open: false, username: "", password: "" };

function authTypeToInput(authType: ConnectionDto["authType"]): AuthTypeInput {
  if (authType === "ClientSecret") return "clientSecret";
  if (authType === "Certificate") return "certificate";
  return "interactive";
}

/** The auth-type-dependent field set shared by "添加连接" and the inline edit form below —
 *  extracted so both stay in sync instead of drifting as two hand-copied field lists.
 *  `secretsOptional` (edit mode) only changes the secret fields' placeholder text: a saved
 *  connection's secret is never sent back to the JS side (see ConnectionHandlers.cs's ToDto), so
 *  leaving the field blank on edit means "keep the existing one", not "clear it". */
function ConnectionFormFields({
  values,
  onChange,
  onPickCertificate,
  secretsOptional,
}: {
  values: FormState;
  onChange: (patch: Partial<FormState>) => void;
  onPickCertificate: () => void;
  secretsOptional?: boolean;
}) {
  return (
    <>
      <input
        type="text"
        placeholder="连接名称"
        value={values.name}
        onChange={(e) => onChange({ name: e.target.value })}
        required
        className={inputCls}
      />
      <input
        type="text"
        placeholder="环境 URL，例如 https://xxx.crm5.dynamics.com"
        value={values.environmentUrl}
        onChange={(e) => onChange({ environmentUrl: e.target.value })}
        required
        className={inputCls}
      />
      <select value={values.authType} onChange={(e) => onChange({ authType: e.target.value as AuthTypeInput })} className={inputCls}>
        <option value="interactive">交互式登录（用户本人登录，原生支持 MFA / 条件访问）</option>
        <option value="clientSecret">Client Secret（应用身份）</option>
        <option value="certificate">证书认证（应用身份，.pfx 文件）</option>
      </select>

      <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={values.allowWrite}
          onChange={(e) => onChange({ allowWrite: e.target.checked })}
        />
        允许写入
      </label>
      {!values.allowWrite && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          关闭后，此连接对所有工具都只有查询权限——任何新建/修改/删除/发布等写操作都会被拒绝，直到重新打开此开关。
        </p>
      )}

      {values.authType === "interactive" && (
        <>
          <p className="text-xs text-gray-400">
            交互式登录需要一个在目标环境所在租户里注册好的 App Registration（"Mobile and desktop applications"平台、redirect
            URI <code>http://localhost</code>、允许 public client flow、并已同意 Dynamics CRM API 的委托权限）——先问问这个环境的管理员是不是已经有现成的可以直接用，没有的话去
            Entra 后台自己注册一个。这里没有默认值：不同租户各自有各自的 App Registration，同一个 Client ID 只在它注册所在的那个租户里能用。
          </p>
          <input
            type="text"
            placeholder="Tenant ID（必填，例如 contoso.onmicrosoft.com 或租户 GUID）"
            value={values.tenantId}
            onChange={(e) => onChange({ tenantId: e.target.value })}
            required
            className={inputCls}
          />
          <input
            type="text"
            placeholder="Client ID（必填）"
            value={values.clientId}
            onChange={(e) => onChange({ clientId: e.target.value })}
            required
            className={inputCls}
          />
        </>
      )}

      {values.authType === "clientSecret" && (
        <>
          <input
            type="text"
            placeholder="Tenant ID"
            value={values.tenantId}
            onChange={(e) => onChange({ tenantId: e.target.value })}
            className={inputCls}
          />
          <input
            type="text"
            placeholder="Client ID"
            value={values.clientId}
            onChange={(e) => onChange({ clientId: e.target.value })}
            className={inputCls}
          />
          <input
            type="password"
            placeholder={secretsOptional ? "Client Secret（留空 = 不修改已保存的密钥）" : "Client Secret"}
            value={values.clientSecret}
            onChange={(e) => onChange({ clientSecret: e.target.value })}
            className={inputCls}
          />
        </>
      )}

      {values.authType === "certificate" && (
        <>
          <input
            type="text"
            placeholder="Tenant ID"
            value={values.tenantId}
            onChange={(e) => onChange({ tenantId: e.target.value })}
            className={inputCls}
          />
          <input
            type="text"
            placeholder="Client ID"
            value={values.clientId}
            onChange={(e) => onChange({ clientId: e.target.value })}
            className={inputCls}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPickCertificate}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              选择证书文件 (.pfx)
            </button>
            <span className="truncate text-xs text-gray-500 dark:text-gray-400">{values.certificateFilePath || "未选择文件"}</span>
          </div>
          <input
            type="password"
            placeholder={secretsOptional ? "证书密码（留空 = 不修改已保存的密钥）" : "证书密码"}
            value={values.certificatePassword}
            onChange={(e) => onChange({ certificatePassword: e.target.value })}
            className={inputCls}
          />
        </>
      )}
    </>
  );
}

export default function ConnectionsPage() {
  const available = isNativeBridgeAvailable();
  const { connections, refreshConnections } = useActiveConnection();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, ConnectionStatus>>({});
  const [connectionString, setConnectionString] = useState("");
  const [connectionStringWarnings, setConnectionStringWarnings] = useState<string[]>([]);
  const [passwordLogin, setPasswordLogin] = useState<Record<string, PasswordLoginState>>({});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

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
        certificateFilePath: form.certificateFilePath || undefined,
        certificatePassword: form.certificatePassword || undefined,
        allowWrite: form.allowWrite,
      });
      setForm(emptyForm);
      setConnectionString("");
      setConnectionStringWarnings([]);
      await refreshConnections();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleParseConnectionString() {
    const parsed = parseConnectionString(connectionString);
    setForm((f) => ({
      ...f,
      authType: parsed.authType ?? f.authType,
      environmentUrl: parsed.environmentUrl ?? f.environmentUrl,
      tenantId: parsed.tenantId ?? f.tenantId,
      clientId: parsed.clientId ?? f.clientId,
      clientSecret: parsed.clientSecret ?? f.clientSecret,
    }));
    setConnectionStringWarnings(parsed.warnings);
  }

  async function pickCertificateFile(): Promise<string | null> {
    const result = await callNative<{ filePath: string | null; fileName: string | null }>("dialog.pickFile", {
      title: "选择证书文件 (.pfx)",
      filter: "证书文件 (*.pfx;*.p12)|*.pfx;*.p12|所有文件 (*.*)|*.*",
    });
    return result.filePath;
  }

  async function handlePickCertificateFile() {
    const filePath = await pickCertificateFile();
    if (filePath) setForm((f) => ({ ...f, certificateFilePath: filePath }));
  }

  async function handlePickCertificateFileForEdit() {
    const filePath = await pickCertificateFile();
    if (filePath) setEditForm((f) => ({ ...f, certificateFilePath: filePath }));
  }

  async function handleRemove(id: string) {
    await callNative("connections.remove", { id });
    await refreshConnections();
  }

  function handleStartEdit(c: ConnectionDto) {
    setEditForm({
      name: c.name,
      environmentUrl: c.environmentUrl,
      authType: authTypeToInput(c.authType),
      tenantId: c.tenantId ?? "",
      clientId: c.clientId ?? "",
      clientSecret: "",
      certificateFilePath: c.certificateFilePath ?? "",
      certificatePassword: "",
      allowWrite: c.allowWrite,
    });
    setEditError(null);
    setEditingId(c.id);
  }

  async function handleSaveEdit(e: FormEvent, id: string) {
    e.preventDefault();
    setEditError(null);
    setEditSaving(true);
    try {
      await callNative("connections.update", {
        id,
        name: editForm.name,
        environmentUrl: editForm.environmentUrl,
        authType: editForm.authType,
        tenantId: editForm.tenantId || undefined,
        clientId: editForm.clientId || undefined,
        clientSecret: editForm.clientSecret || undefined,
        certificateFilePath: editForm.certificateFilePath || undefined,
        certificatePassword: editForm.certificatePassword || undefined,
        allowWrite: editForm.allowWrite,
      });
      await refreshConnections();
      setEditingId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditSaving(false);
    }
  }

  async function handleWhoAmI(id: string, credentials?: { username: string; password: string }) {
    setStatus((s) => ({ ...s, [id]: { loading: true } }));
    try {
      // Interactive login needs a human to type credentials / approve MFA in the popup, which
      // routinely takes longer than the default 30s — that default is sized for ordinary API
      // calls. Without this override, the bridge call times out client-side while the WPF side
      // is still legitimately waiting on the browser window, and the UI reports a misleading
      // "timed out" instead of whatever the real outcome ends up being.
      await callNative("auth.login", { connectionId: id, ...credentials }, { timeoutMs: 5 * 60_000 });
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

  function togglePasswordLogin(id: string) {
    setPasswordLogin((p) => {
      const current = p[id] ?? emptyPasswordLogin;
      return { ...p, [id]: { ...current, open: !current.open } };
    });
  }

  function updatePasswordLogin(id: string, patch: Partial<PasswordLoginState>) {
    setPasswordLogin((p) => ({ ...p, [id]: { ...(p[id] ?? emptyPasswordLogin), ...patch } }));
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
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{c.name}</span>
                      {!c.allowWrite && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          只读
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {c.environmentUrl} · {AUTH_TYPE_LABELS[c.authType] ?? c.authType}
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
                    {c.authType === "Interactive" && (
                      <button
                        onClick={() => togglePasswordLogin(c.id)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        用户名密码登录
                      </button>
                    )}
                    <button
                      onClick={() => (editingId === c.id ? setEditingId(null) : handleStartEdit(c))}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      {editingId === c.id ? "取消编辑" : "编辑"}
                    </button>
                    <button
                      onClick={() => handleRemove(c.id)}
                      className="text-xs text-gray-400 hover:text-red-500"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {editingId === c.id && (
                  <form
                    onSubmit={(e) => handleSaveEdit(e, c.id)}
                    className="mt-3 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950"
                  >
                    <ConnectionFormFields
                      values={editForm}
                      onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))}
                      onPickCertificate={handlePickCertificateFileForEdit}
                      secretsOptional
                    />
                    {editError && <p className="text-xs text-red-600 dark:text-red-400">{editError}</p>}
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={editSaving}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {editSaving ? "保存中…" : "保存"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        取消
                      </button>
                    </div>
                  </form>
                )}

                {c.authType === "Interactive" && passwordLogin[c.id]?.open && (
                  <div className="mt-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-950">
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      直接用用户名密码登录，不弹浏览器窗口——只对没有开启 MFA / 条件访问的账号有效，遇到 MFA 会报错提示改用上面的"登录 + WhoAmI"。密码只用于这一次登录，不会保存。
                    </p>
                    <input
                      type="text"
                      placeholder="用户名 (user@tenant.onmicrosoft.com)"
                      value={passwordLogin[c.id]?.username ?? ""}
                      onChange={(e) => updatePasswordLogin(c.id, { username: e.target.value })}
                      className={inputCls}
                    />
                    <input
                      type="password"
                      placeholder="密码"
                      value={passwordLogin[c.id]?.password ?? ""}
                      onChange={(e) => updatePasswordLogin(c.id, { password: e.target.value })}
                      className={inputCls}
                    />
                    <button
                      onClick={() => {
                        const cred = passwordLogin[c.id];
                        if (cred?.username && cred.password) {
                          void handleWhoAmI(c.id, { username: cred.username, password: cred.password });
                        }
                      }}
                      disabled={status[c.id]?.loading || !passwordLogin[c.id]?.username || !passwordLogin[c.id]?.password}
                      className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {status[c.id]?.loading ? "登录并调用中…" : "用密码登录 + WhoAmI"}
                    </button>
                  </div>
                )}

                {status[c.id]?.error && <ErrorMessage error={status[c.id].error} className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400" />}
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

      <div className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">从连接字符串导入</h2>
        <p className="text-xs text-gray-400">
          粘贴 XRM Tooling 格式的连接字符串（例如 <code>AuthType=OAuth;Url=...;ClientId=...</code>），解析后会预填下面的表单，不会自动提交——请检查无误后再点"添加"。
        </p>
        <textarea
          value={connectionString}
          onChange={(e) => setConnectionString(e.target.value)}
          placeholder="AuthType=OAuth;Url=https://org.crm.dynamics.com;ClientId=..."
          rows={2}
          className={inputCls}
        />
        <button
          type="button"
          onClick={handleParseConnectionString}
          disabled={!connectionString.trim()}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          解析并填充下方表单
        </button>
        {connectionStringWarnings.length > 0 && (
          <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-600 dark:text-amber-400">
            {connectionStringWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">添加连接</h2>

        <ConnectionFormFields
          values={form}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          onPickCertificate={handlePickCertificateFile}
        />

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
