import { formatDataverseError } from "./errorFormatting";

/** Drop-in replacement for the app's near-ubiquitous "dump a raw caught error into a red box"
 *  pattern (`<pre className="... border-red-200 bg-red-50 ...">{someError}</pre>`) — same visual
 *  convention, but the summary is run through `formatDataverseError` first (a plain-language
 *  status-code prefix + Dataverse's own message, instead of the raw `Dataverse 请求失败 (401):
 *  {"error":{...}}` string), with the full original text still available behind a "技术细节"
 *  toggle for anyone who needs it (support, a bug report) instead of always being on screen. */
export default function ErrorMessage({ error, className }: { error: unknown; className?: string }) {
  const { summary, detail } = formatDataverseError(error);
  return (
    <div
      className={
        className ??
        "rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400"
      }
    >
      <p className="whitespace-pre-wrap">{summary}</p>
      {detail && (
        <details className="mt-1">
          <summary className="cursor-pointer text-red-600 hover:underline dark:text-red-400">技术细节</summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{detail}</pre>
        </details>
      )}
    </div>
  );
}
