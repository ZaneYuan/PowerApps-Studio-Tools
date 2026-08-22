// Bridges this app's own native-bridge protocol (native/bridge.ts's callNative) to a REAL
// Dataverse HTTP request via dataverseTestClient's cached MSAL token. This is the mechanism that
// makes *.integration.test.ts genuinely "call the real dataverseOps.ts functions against real
// Dataverse" rather than a separate hand-rolled HTTP test harness: dataverseOps.ts's exported
// functions (buildAttributeBody, createLookupColumn, fetchEntityFields, ...) run completely
// unmodified — the only thing faked is the WebView2 postMessage transport itself, which in the
// real desktop app forwards to C#'s DataverseApiClient.RequestAsync and here forwards straight to
// Dataverse instead. A bug in this app's own request-building logic (wrong $select, wrong
// @odata.type, wrong header) surfaces exactly the same way it would in production: a real 400 from
// Dataverse.
import { dataverseTestRequest } from "./dataverseTestClient";

interface NativeResultMessage {
  id: string;
  result?: unknown;
  error?: string;
}
type MessageListener = (event: { data: NativeResultMessage }) => void;

interface DataverseRequestParams {
  connectionId: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  solutionUniqueName?: string;
  includeFormattedValues?: boolean;
}

async function handleCall(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (method !== "dataverse.request") {
    throw new Error(`mock native bridge 没有实现 "${method}"（这个测试套件只处理 dataverse.request）。`);
  }
  const p = params as unknown as DataverseRequestParams;
  const headers: Record<string, string> = {};
  if (p.solutionUniqueName) headers["MSCRM.SolutionUniqueName"] = p.solutionUniqueName;
  // Mirrors DataverseApiClient.cs exactly: the real C# layer sends `Prefer: return=representation`
  // on every request unconditionally (not just writes — harmless on GET/DELETE), with the
  // annotations clause appended only when includeFormattedValues is set. This mock previously only
  // sent Prefer when includeFormattedValues was true, which silently diverged from production and
  // made a plain POST come back 204 (empty body) here while the real app always gets the created
  // record inline — masking exactly the class of bug this test suite exists to catch.
  headers.Prefer = p.includeFormattedValues
    ? 'return=representation,odata.include-annotations="OData.Community.Display.V1.FormattedValue,Microsoft.Dynamics.CRM.lookuplogicalname"'
    : "return=representation";
  const res = await dataverseTestRequest(p.method, p.path, p.body, headers);
  return res.body;
}

/** Call in a jsdom-environment integration test file's `beforeAll`. `connectionId` in every
 *  dataverseOps.ts call is ignored here (this always talks to the one real ZaneTest connection
 *  the cached token is scoped to) — pass any placeholder string. */
export function installMockNativeBridge(): void {
  const listeners = new Set<MessageListener>();
  (window as unknown as { chrome: { webview: unknown } }).chrome = {
    webview: {
      postMessage: (message: { id: string; method: string; params: Record<string, unknown> }) => {
        handleCall(message.method, message.params)
          .then((result) => listeners.forEach((l) => l({ data: { id: message.id, result } })))
          .catch((err: unknown) =>
            listeners.forEach((l) => l({ data: { id: message.id, error: err instanceof Error ? err.message : String(err) } })),
          );
      },
      addEventListener: (_type: "message", listener: MessageListener) => listeners.add(listener),
      removeEventListener: (_type: "message", listener: MessageListener) => listeners.delete(listener),
    },
  };
}

/** Call in `afterAll` — jsdom's `window` can be reused across test files in the same worker, so
 *  leaving the mock installed could leak into a file that expects `isNativeBridgeAvailable()` to
 *  be false. */
export function uninstallMockNativeBridge(): void {
  delete (window as unknown as { chrome?: unknown }).chrome;
}
