export type ParsedAuthType = "interactive" | "clientSecret" | "certificate";

export interface ParsedConnectionString {
  authType?: ParsedAuthType;
  environmentUrl?: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  warnings: string[];
}

const AUTH_TYPE_MAP: Record<string, ParsedAuthType> = {
  oauth: "interactive",
  office365: "interactive",
  clientsecret: "clientSecret",
  certificate: "certificate",
};

// Known XRM Tooling connection-string fields this app intentionally doesn't carry over
// (different auth model, e.g. thumbprint-based certs, or not applicable to this app).
const IGNORED_FIELDS: Record<string, string> = {
  thumbprint: "不支持按指纹选证书，请在表单里手动选择 .pfx 文件",
  username: "不支持预填用户名",
  "integrated security": "不支持 Integrated Security",
  loginprompt: "不支持 LoginPrompt",
  redirecturi: "使用固定的 redirect URI",
  tokencachestorepath: "使用内置的 token 缓存路径",
  requirenewinstance: "不支持此字段",
};

/** Parses an XRM Tooling / Dataverse-style connection string (e.g.
 * `AuthType=OAuth;Url=https://org.crm.dynamics.com;ClientId=...`) into this app's connection
 * form fields. Tolerant of unknown/unsupported fields — pushes them into `warnings` instead of
 * throwing, since the string may have been copied from a different tool. */
export function parseConnectionString(raw: string): ParsedConnectionString {
  const result: ParsedConnectionString = { warnings: [] };

  const segments = raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const eqIndex = segment.indexOf("=");
    if (eqIndex === -1) {
      result.warnings.push(`无法解析的片段，已忽略：${segment}`);
      continue;
    }

    const key = segment.slice(0, eqIndex).trim().toLowerCase();
    const value = segment.slice(eqIndex + 1).trim();
    if (!value) continue;

    switch (key) {
      case "authtype": {
        const mapped = AUTH_TYPE_MAP[value.toLowerCase()];
        if (mapped) {
          result.authType = mapped;
        } else {
          result.warnings.push(`未知的 AuthType："${value}"，请手动选择认证方式`);
        }
        break;
      }
      case "url":
      case "serviceuri":
        result.environmentUrl = value.replace(/\/$/, "");
        break;
      case "clientid":
      case "appid":
        result.clientId = value;
        break;
      case "clientsecret":
        result.clientSecret = value;
        break;
      case "tenantid":
        // Kept only as an optional override — the app normally auto-detects the tenant from the
        // environment URL at sign-in time, and there's no Tenant ID field on the form anymore.
        result.tenantId = value;
        result.warnings.push(`Tenant ID 已记录为覆盖值（${value}），通常无需设置`);
        break;
      default: {
        const reason = IGNORED_FIELDS[key];
        result.warnings.push(reason ? `已忽略：${key}（${reason}）` : `未知字段，已忽略：${key}`);
        break;
      }
    }
  }

  return result;
}
