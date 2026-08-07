import JSZip from "jszip";
import type { SolutionBundle } from "./types";

export async function loadSolutionZip(file: File): Promise<SolutionBundle> {
  const zip = await JSZip.loadAsync(file);

  const solutionXmlEntry = zip.file("solution.xml") ?? zip.file(/^solution\.xml$/i)[0];
  const customizationsEntry =
    zip.file("customizations.xml") ?? zip.file(/^customizations\.xml$/i)[0];

  let version: string | null = null;
  let uniqueName: string | null = null;
  if (solutionXmlEntry) {
    const text = await solutionXmlEntry.async("string");
    const doc = new DOMParser().parseFromString(text, "application/xml");
    version = doc.querySelector("SolutionManifest > Version")?.textContent?.trim() ?? null;
    uniqueName = doc.querySelector("SolutionManifest > UniqueName")?.textContent?.trim() ?? null;
  }

  let customizationsXml: Document | null = null;
  if (customizationsEntry) {
    const text = await customizationsEntry.async("string");
    customizationsXml = new DOMParser().parseFromString(text, "application/xml");
  }

  return {
    fileName: file.name,
    version,
    uniqueName,
    customizationsXml,
    zip,
  };
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n) || 0);
  const pb = b.split(".").map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const TEXT_EXTENSIONS = [
  ".js",
  ".html",
  ".htm",
  ".css",
  ".xml",
  ".svg",
  ".resx",
  ".json",
  ".xsl",
  ".xslt",
];

export function isTextWebResource(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** WebResource file paths inside the zip don't always match the logical <Name> verbatim
 *  (special characters get encoded). This does a best-effort search rather than assuming
 *  a fixed encoding scheme. */
export function findWebResourceZipPath(zip: JSZip, logicalName: string): string | null {
  const candidates = [
    `WebResources/${logicalName}`,
    `WebResources/${encodeURIComponent(logicalName)}`,
  ];
  for (const c of candidates) {
    if (zip.file(c)) return c;
  }
  const basename = logicalName.split("/").pop() ?? logicalName;
  const match = Object.keys(zip.files).find(
    (path) =>
      path.startsWith("WebResources/") &&
      (path.endsWith(`/${basename}`) || decodeURIComponent(path) === `WebResources/${logicalName}`),
  );
  return match ?? null;
}
