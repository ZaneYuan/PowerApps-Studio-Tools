import JSZip from "jszip";
import { findChild, findChildren, resolveKey } from "../solution-diff/xmlDiff";

/** Skeleton for a table that has never had its ribbon customized — the common case. */
const RIBBON_SKELETON =
  "<RibbonDiffXml><CustomActions /><Templates /><CommandDefinitions /><RuleDefinitions /><LocLabels /></RibbonDiffXml>";

const serializer = new XMLSerializer();

function findDirectChild(parent: Element, tag: string): Element | undefined {
  return Array.from(parent.children).find((c) => c.tagName.toLowerCase() === tag.toLowerCase());
}

function parseXml(text: string, contextLabel: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error(`${contextLabel} 不是合法的 XML：${parserError.textContent}`);
  }
  return doc;
}

async function loadCustomizationsDoc(zipBase64: string): Promise<{ zip: JSZip; doc: Document }> {
  const zip = await JSZip.loadAsync(zipBase64, { base64: true });
  const entry = zip.file("customizations.xml") ?? zip.file(/^customizations\.xml$/i)[0];
  if (!entry) {
    throw new Error("导出的 solution 压缩包里没有找到 customizations.xml。");
  }
  const text = await entry.async("string");
  return { zip, doc: parseXml(text, "customizations.xml") };
}

/** Finds `//ImportExportXml/Entities/Entity` whose resolved logical name matches — reuses the
 *  same key-resolution heuristic `solution-diff` already validates against real solution zips. */
export function findEntityElement(doc: Document, logicalName: string): Element | undefined {
  const entitiesEl = findChild(doc.documentElement, "entities");
  if (!entitiesEl) return undefined;
  return findChildren(entitiesEl, "entity").find(
    (entityEl) => resolveKey(entityEl)?.toLowerCase() === logicalName.toLowerCase(),
  );
}

/** Reads the current `<RibbonDiffXml>` for a table out of an already-exported solution zip
 *  (base64). Returns an empty skeleton — not an error — if the table has no ribbon
 *  customization yet. Throws if the table itself isn't in the exported solution at all (the
 *  caller is expected to have added it as a solution component first). */
export async function readRibbonDiffXml(zipBase64: string, logicalName: string): Promise<string> {
  const { doc } = await loadCustomizationsDoc(zipBase64);
  const entityEl = findEntityElement(doc, logicalName);
  if (!entityEl) {
    throw new Error(`导出的 solution 里没有找到实体 "${logicalName}"，请确认它已经作为组件加入了所选的 solution。`);
  }
  const ribbonEl = findDirectChild(entityEl, "RibbonDiffXml");
  return ribbonEl ? serializer.serializeToString(ribbonEl) : RIBBON_SKELETON;
}

/** Patches a table's `<RibbonDiffXml>` inside a fresh export of the solution zip (base64) and
 *  returns the new zip (base64), ready to hand to ImportSolution. Validates the replacement XML
 *  is well-formed and rooted at `<RibbonDiffXml>` before touching the zip at all. */
export async function writeRibbonDiffXml(
  zipBase64: string,
  logicalName: string,
  newRibbonDiffXmlText: string,
): Promise<string> {
  const parsedNew = parseXml(newRibbonDiffXmlText, "RibbonDiffXml");
  if (parsedNew.documentElement.tagName.toLowerCase() !== "ribbondiffxml") {
    throw new Error("根节点必须是 <RibbonDiffXml>。");
  }

  const { zip, doc } = await loadCustomizationsDoc(zipBase64);
  const entityEl = findEntityElement(doc, logicalName);
  if (!entityEl) {
    throw new Error(`导出的 solution 里没有找到实体 "${logicalName}"，请确认它已经作为组件加入了所选的 solution。`);
  }

  const imported = doc.importNode(parsedNew.documentElement, true);
  const existing = findDirectChild(entityEl, "RibbonDiffXml");
  if (existing) {
    entityEl.replaceChild(imported, existing);
  } else {
    entityEl.appendChild(imported);
  }

  zip.file("customizations.xml", serializer.serializeToString(doc));
  return zip.generateAsync({ type: "base64" });
}
