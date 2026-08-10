/** Triggers a browser-style file download via a Blob + temporary `<a download>` — WebView2's
 *  Chromium engine handles this the same way Edge does (native Save As, or straight to
 *  Downloads), no C# bridge method needed. */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
