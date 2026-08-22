// One-time interactive login for the real-Dataverse integration test suite. Opens the system
// browser, you sign in as yourself (same account the desktop app's "ZaneTest" connection already
// uses), and the resulting MSAL token cache (which includes a refresh token) is persisted to
// .dataverse-test-cache.json — gitignored, never committed. Every subsequent `npm run
// test:integration` run redeems that cache silently via acquireTokenSilent, no browser needed,
// until the refresh token itself expires (Entra ID's default sliding refresh-token lifetime is
// long — typically ~90 days of inactivity before it needs this script run again).
//
// Uses the SAME App Registration the desktop app's "ZaneTest" connection already uses (public
// client, no secret — see 我的连接 in the app), so this doesn't need any new Entra ID setup:
//   Tenant: bamboonetworks.net
//   Client ID: 51f81489-12ee-4a9e-aaae-a2591f45987d
//   Redirect URI: http://localhost (dynamic port — msal-node's acquireTokenInteractive spins up
//     its own loopback listener and picks a free port automatically)
import { PublicClientApplication } from "@azure/msal-node";
import { exec } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const CACHE_PATH = new URL("../.dataverse-test-cache.json", import.meta.url);
const TENANT = "bamboonetworks.net";
const CLIENT_ID = "51f81489-12ee-4a9e-aaae-a2591f45987d";
const ORG_URL = "https://org0475e5da.crm5.dynamics.com";

const cachePlugin = {
  beforeCacheAccess: async (ctx) => {
    if (existsSync(CACHE_PATH)) ctx.tokenCache.deserialize(await readFile(CACHE_PATH, "utf-8"));
  },
  afterCacheAccess: async (ctx) => {
    if (ctx.cacheHasChanged) await writeFile(CACHE_PATH, ctx.tokenCache.serialize(), "utf-8");
  },
};

const pca = new PublicClientApplication({
  auth: { clientId: CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT}` },
  cache: { cachePlugin },
});

console.log("正在打开浏览器登录……在弹出的窗口里用你平时登录 ZaneTest 的账号登录即可。");
const result = await pca.acquireTokenInteractive({
  scopes: [`${ORG_URL}/.default`],
  openBrowser: async (url) => {
    exec(`start "" "${url}"`);
  },
  successTemplate: "<h1>登录成功，可以关闭这个标签页了。</h1>",
  errorTemplate: "<h1>登录失败，回到终端看报错信息。</h1>",
});

console.log(`登录成功：${result.account.username}`);
console.log(`Token cache 已写入 ${CACHE_PATH.pathname.replace(/^\//, "")}（已加入 .gitignore，不会被提交）。`);
console.log("现在可以跑 npm run test:integration 了。");
