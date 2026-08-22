// Real-Dataverse HTTP client for the integration test suite (`npm run test:integration`) — talks
// directly to ZaneTest over the network, bypassing this app's own native bridge entirely (that
// bridge only exists inside the WebView2-hosted desktop shell; these tests run as a plain Node
// process under Vitest). Auth is a cached MSAL token redeemed silently — see
// scripts/dataverse-test-login.mjs for the one-time interactive login that creates the cache this
// reads. Deliberately NOT wired into the app's own dataverseOps.ts functions (which all go through
// callNative/native/bridge.ts) — this only ever talks to Dataverse directly, on purpose, so a bug
// in the native bridge itself can't mask a real API mismatch these tests exist to catch.
import { PublicClientApplication, type AccountInfo } from "@azure/msal-node";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// `process.cwd()`-relative, not `import.meta.url`-relative: the latter resolves inconsistently
// depending on which Vitest environment (node vs jsdom) loads this module — confirmed by a real
// failure ("The URL must be of scheme file") the one time a jsdom-environment test file imported
// this before cwd-based resolution replaced it. `npm run test:integration` always runs from the
// repo root, so cwd is reliable here.
const CACHE_PATH = resolve(process.cwd(), ".dataverse-test-cache.json");
const TENANT = "bamboonetworks.net";
const CLIENT_ID = "51f81489-12ee-4a9e-aaae-a2591f45987d";
export const TEST_ORG_URL = "https://org0475e5da.crm5.dynamics.com";
const API_BASE = `${TEST_ORG_URL}/api/data/v9.2/`;

export function hasTestCredentials(): boolean {
  return existsSync(CACHE_PATH);
}

const cachePlugin = {
  beforeCacheAccess: async (ctx: { tokenCache: { deserialize: (s: string) => void } }) => {
    if (existsSync(CACHE_PATH)) ctx.tokenCache.deserialize(await readFile(CACHE_PATH, "utf-8"));
  },
  afterCacheAccess: async (ctx: { cacheHasChanged: boolean; tokenCache: { serialize: () => string } }) => {
    if (ctx.cacheHasChanged) await writeFile(CACHE_PATH, ctx.tokenCache.serialize(), "utf-8");
  },
};

let pcaInstance: PublicClientApplication | null = null;
function pca(): PublicClientApplication {
  if (!pcaInstance) {
    pcaInstance = new PublicClientApplication({
      auth: { clientId: CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT}` },
      cache: { cachePlugin },
    });
  }
  return pcaInstance;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  if (!hasTestCredentials()) {
    throw new Error("没有找到 .dataverse-test-cache.json —— 先跑一次 `node scripts/dataverse-test-login.mjs` 完成一次性交互式登录。");
  }
  const app = pca();
  const accounts = await app.getTokenCache().getAllAccounts();
  const account: AccountInfo | undefined = accounts[0];
  if (!account) {
    throw new Error("Token cache 存在但里面没有账号 —— 缓存可能损坏，删掉 .dataverse-test-cache.json 重新跑一次登录脚本。");
  }
  const result = await app.acquireTokenSilent({ account, scopes: [`${TEST_ORG_URL}/.default`] });
  if (!result) throw new Error("acquireTokenSilent 没有返回 token（意料之外）。");
  cachedToken = { value: result.accessToken, expiresAt: result.expiresOn?.getTime() ?? Date.now() + 5 * 60_000 };
  return cachedToken.value;
}

export interface DataverseTestResponse<T = unknown> {
  status: number;
  /** The new record's id, parsed out of the OData-EntityId response header — Dataverse's metadata
   *  write endpoints (EntityDefinitions/Attributes, RelationshipDefinitions,
   *  GlobalOptionSetDefinitions) return a bare 204 with the id only in this header, same behavior
   *  this app's own C# DataverseApiClient already works around for the real app. */
  entityId: string | null;
  body: T;
}

/** Minimal direct Web API caller — no retry, no odata annotation stripping, on purpose: these
 *  tests exist to catch exactly the kind of mismatch a "helpful" wrapper could paper over. */
export async function dataverseTestRequest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<DataverseTestResponse<T>> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      ...(body !== undefined ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const entityIdHeader = res.headers.get("OData-EntityId");
  const entityIdMatch = entityIdHeader?.match(/\(([0-9a-fA-F-]{36})\)\s*$/);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dataverse ${method} ${path} → ${res.status}: ${text}`);
  }

  const text = await res.text();
  const parsedBody = text ? (JSON.parse(text) as T) : (undefined as T);
  return { status: res.status, entityId: entityIdMatch?.[1] ?? null, body: parsedBody };
}

/** A short random suffix for schema/unique names this test run creates, so repeated runs don't
 *  collide with what a previous run left behind (see the module doc comment in each
 *  *.integration.test.ts for this suite's cleanup policy — metadata created here is generally left
 *  in place rather than deleted, same as the ClaudeSmokeTest/Claude Test Table artifacts already in
 *  ZaneTest from manual testing earlier). */
export function testRunSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
