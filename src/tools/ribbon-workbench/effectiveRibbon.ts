import JSZip from "jszip";

/** One button-family control (Button/SplitButton/MenuButton/Flyout — Dataverse's ribbon schema
 *  uses all four for a clickable command entry point) found under a Group. Kept intentionally
 *  shallow — a Flyout's own nested menu items aren't walked, since the read-only tree's job is
 *  "what commands exist and what are their real Ids", not a pixel-perfect ribbon renderer. */
export interface RibbonControlNode {
  tag: string;
  id: string | null;
  command: string | null;
  labelText: string | null;
}

export interface RibbonGroupNode {
  id: string | null;
  labelText: string | null;
  controls: RibbonControlNode[];
}

export interface RibbonTabNode {
  id: string | null;
  labelText: string | null;
  groups: RibbonGroupNode[];
}

const CONTROL_TAGS = new Set(["button", "splitbutton", "menubutton", "flyoutanchor"]);

/** Finds every descendant (not just direct children) matching `tag`, case-insensitively —
 *  Groups sit under a `<Group>` directly in some ribbon locations but under `<Groups><Group>` in
 *  others (confirmed inconsistent nesting between Form/HomepageGrid/SubGrid ribbon XML fragments
 *  in real exports), and Controls sit under `<Controls>` wrappers that themselves vary in depth.
 *  Searching all descendants sidesteps needing to special-case every nesting variant. */
function findDescendantsCI(root: Element, tag: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter((el) => el.tagName.toLowerCase() === tag);
}

function parseControl(el: Element): RibbonControlNode {
  return {
    tag: el.tagName,
    id: el.getAttribute("Id"),
    command: el.getAttribute("Command"),
    labelText: el.getAttribute("LabelText"),
  };
}

function parseGroup(el: Element): RibbonGroupNode {
  const controls: RibbonControlNode[] = [];
  for (const controlsEl of findDescendantsCI(el, "controls")) {
    for (const child of Array.from(controlsEl.children)) {
      if (CONTROL_TAGS.has(child.tagName.toLowerCase())) controls.push(parseControl(child));
    }
  }
  return { id: el.getAttribute("Id"), labelText: el.getAttribute("LabelText"), controls };
}

function parseTab(el: Element): RibbonTabNode {
  return {
    id: el.getAttribute("Id"),
    labelText: el.getAttribute("LabelText"),
    groups: findDescendantsCI(el, "group").map(parseGroup),
  };
}

/** Parses the decompressed RibbonXml.xml (see fetchEffectiveRibbonXml) into a Tab -> Group ->
 *  Control tree. Deliberately schema-lenient (searches for `<Tab>`/`<Group>`/button-family
 *  elements anywhere under the document, not a fixed `<Tabs><Tab>` path) — real exports mix
 *  Form/HomepageGrid/SubGrid ribbon fragments with structurally different wrapping, and a rigid
 *  path-based walk would silently return an empty tree for whichever shape it didn't anticipate. */
export function parseRibbonTree(xmlText: string): RibbonTabNode[] {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error(`RibbonXml.xml 不是合法的 XML：${parserError.textContent}`);
  return findDescendantsCI(doc.documentElement, "tab").map(parseTab);
}

/** `RetrieveEntityRibbon`'s `CompressedEntityXml` is not a plain gzip stream — per Microsoft's own
 *  docs ("Export ribbon definitions"), it's a `System.IO.Packaging.ZipPackage` (an OPC/ZIP
 *  container, the same family as a .docx), and the ribbon XML itself lives at the fixed part path
 *  `/RibbonXml.xml` inside it. A ZipPackage's part-to-entry mapping stores a root-level part like
 *  this one as a same-named top-level ZIP entry, so JSZip (already a dependency, used elsewhere in
 *  this codebase for actual solution.zip files) can read it directly without needing to understand
 *  OPC's `[Content_Types].xml`/`_rels` machinery — this was verified against Microsoft's published
 *  C# `unzipRibbon` helper (`ZipPackage.Open(...).GetPart(new Uri("/RibbonXml.xml", ...))`), not
 *  guessed from the "Compressed" name, which would have suggested plain GZip and silently failed
 *  to parse (GZip and ZIP are different container formats; JSZip only reads the latter). */
export async function decompressRibbonXml(compressedBase64: string): Promise<string> {
  const zip = await JSZip.loadAsync(compressedBase64, { base64: true });
  const entry = zip.file("RibbonXml.xml") ?? zip.file(/^\/?RibbonXml\.xml$/i)[0];
  if (!entry) {
    throw new Error("RetrieveEntityRibbon 返回的压缩包里没有找到 RibbonXml.xml（意料之外的格式）。");
  }
  return entry.async("string");
}
