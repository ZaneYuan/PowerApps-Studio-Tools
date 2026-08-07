import type JSZip from "jszip";
import { toDiffLines } from "./xmlDiff";
import { findWebResourceZipPath, isTextWebResource } from "./loadSolution";
import type { WebResourceFileDiff } from "./types";

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function diffWebResourceFile(
  oldZip: JSZip,
  newZip: JSZip,
  logicalName: string,
): Promise<WebResourceFileDiff> {
  const oldPath = findWebResourceZipPath(oldZip, logicalName);
  const newPath = findWebResourceZipPath(newZip, logicalName);
  const isText = isTextWebResource(logicalName);

  if (!oldPath && !newPath) return { status: "unavailable", isText };
  if (oldPath && !newPath) return { status: "removed", isText };
  if (!oldPath && newPath) return { status: "added", isText };

  const oldFile = oldZip.file(oldPath!)!;
  const newFile = newZip.file(newPath!)!;

  if (isText) {
    const [oldText, newText] = await Promise.all([
      oldFile.async("string"),
      newFile.async("string"),
    ]);
    if (oldText === newText) return { status: "unchanged", isText };
    return { status: "modified", isText, diffLines: toDiffLines(oldText, newText) };
  }

  const [oldBuf, newBuf] = await Promise.all([
    oldFile.async("arraybuffer"),
    newFile.async("arraybuffer"),
  ]);
  const [oldHash, newHash] = await Promise.all([sha256(oldBuf), sha256(newBuf)]);
  return { status: oldHash === newHash ? "unchanged" : "modified", isText };
}
