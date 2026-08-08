import { diffLines as jsDiffLines } from "diff";
import type { DiffItem, DiffLine, ItemStatus, SectionDiff } from "./types";

const serializer = new XMLSerializer();
const GUID_IN_TEXT_RE =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

/** Best-effort identity resolver. GUID-shaped id attributes (WorkflowId, RoleId, ...) win first
 *  since they stay stable across a rename — falling back to Name would misreport a rename as
 *  "removed + added" instead of "modified". Falls back to Name-like attributes/children when no
 *  id attribute is present. */
export function resolveKey(item: Element): string | null {
  for (const attr of item.getAttributeNames()) {
    if (!/id$/i.test(attr)) continue;
    const match = item.getAttribute(attr)?.match(GUID_IN_TEXT_RE);
    if (match) return match[0].toLowerCase();
  }
  for (const attr of ["Name", "UniqueName", "PhysicalName", "LogicalName"]) {
    const v = item.getAttribute(attr);
    if (v && v.trim()) return v.trim();
  }
  for (const tag of ["name", "logicalname", "uniquename"]) {
    const child = Array.from(item.children).find((c) => c.tagName.toLowerCase() === tag);
    const text = child?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

function displayNameFor(item: Element, key: string): string {
  const nameChild = Array.from(item.children).find(
    (c) => c.tagName.toLowerCase() === "displayname" || c.tagName.toLowerCase() === "localizedname",
  );
  if (nameChild?.textContent?.trim()) return nameChild.textContent.trim();

  const nameAttr = item.getAttribute("Name");
  if (nameAttr?.trim()) return nameAttr.trim();

  const nameEl = Array.from(item.children).find((c) => c.tagName.toLowerCase() === "name");
  if (nameEl?.textContent?.trim()) return nameEl.textContent.trim();

  return key;
}

function serialize(el: Element): string {
  return serializer
    .serializeToString(el)
    .replace(/></g, ">\n<")
    .trim();
}

export function toDiffLines(oldText: string, newText: string): DiffLine[] {
  const parts = jsDiffLines(oldText, newText);
  const lines: DiffLine[] = [];
  for (const part of parts) {
    const type = part.added ? "add" : part.removed ? "remove" : "context";
    const textLines = part.value.replace(/\n$/, "").split("\n");
    for (const t of textLines) lines.push({ type, text: t });
  }
  return lines;
}

export function findChild(el: Element, tag: string): Element | undefined {
  return Array.from(el.children).find((c) => c.tagName.toLowerCase() === tag);
}

export function findChildren(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName.toLowerCase() === tag);
}

/** Drills into <EntityInfo><entity><attributes><attribute> — degrades gracefully to no
 *  children if the expected structure isn't present rather than guessing. */
function diffEntityAttributes(oldEl: Element | undefined, newEl: Element | undefined): DiffItem[] {
  function extractAttrs(entity: Element | undefined): Map<string, Element> {
    const map = new Map<string, Element>();
    if (!entity) return map;
    const entityInfo = findChild(entity, "entityinfo");
    const inner = entityInfo && findChild(entityInfo, "entity");
    const attributesEl = inner && findChild(inner, "attributes");
    if (!attributesEl) return map;
    for (const attr of findChildren(attributesEl, "attribute")) {
      const key = resolveKey(attr);
      if (key) map.set(key, attr);
    }
    return map;
  }

  const oldAttrs = extractAttrs(oldEl);
  const newAttrs = extractAttrs(newEl);
  if (oldAttrs.size === 0 && newAttrs.size === 0) return [];

  return diffMaps(oldAttrs, newAttrs);
}

function diffMaps(oldMap: Map<string, Element>, newMap: Map<string, Element>): DiffItem[] {
  const items: DiffItem[] = [];
  const allKeys = new Set([...oldMap.keys(), ...newMap.keys()]);

  for (const key of allKeys) {
    const oldEl = oldMap.get(key);
    const newEl = newMap.get(key);
    let status: ItemStatus;
    let diffLines: DiffLine[] | undefined;

    if (oldEl && !newEl) {
      status = "removed";
    } else if (!oldEl && newEl) {
      status = "added";
    } else {
      const oldText = serialize(oldEl!);
      const newText = serialize(newEl!);
      if (oldText === newText) {
        status = "unchanged";
      } else {
        status = "modified";
        diffLines = toDiffLines(oldText, newText);
      }
    }

    const refEl = newEl ?? oldEl!;
    items.push({
      key,
      displayName: displayNameFor(refEl, key),
      status,
      diffLines,
    });
  }

  return items.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export interface SectionSpec {
  key: string;
  label: string;
  /** Direct-child tag of the customizations.xml root holding the collection, e.g. "Entities". */
  containerTag: string;
  /** Repeating item tag inside the container, e.g. "Entity". */
  itemTag: string;
  /** Only meaningful for the Entities section. */
  drillIntoAttributes?: boolean;
}

export function diffSection(
  oldDoc: Document | null,
  newDoc: Document | null,
  spec: SectionSpec,
): SectionDiff {
  function extract(doc: Document | null): Map<string, Element> {
    const map = new Map<string, Element>();
    if (!doc) return map;
    const container = Array.from(doc.documentElement.children).find(
      (c) => c.tagName.toLowerCase() === spec.containerTag.toLowerCase(),
    );
    if (!container) return map;
    let index = 0;
    for (const item of Array.from(container.children).filter(
      (c) => c.tagName.toLowerCase() === spec.itemTag.toLowerCase(),
    )) {
      const key = resolveKey(item) ?? `#${index}`;
      map.set(key, item);
      index++;
    }
    return map;
  }

  const oldMap = extract(oldDoc);
  const newMap = extract(newDoc);
  const items = diffMaps(oldMap, newMap);

  if (spec.drillIntoAttributes) {
    for (const item of items) {
      if (item.status === "removed" || item.status === "added") continue;
      const children = diffEntityAttributes(oldMap.get(item.key), newMap.get(item.key));
      const changed = children.filter((c) => c.status !== "unchanged");
      if (changed.length > 0) {
        item.children = changed;
        if (item.status === "unchanged") item.status = "modified";
      }
    }
  }

  return {
    key: spec.key,
    label: spec.label,
    items,
    addedCount: items.filter((i) => i.status === "added").length,
    removedCount: items.filter((i) => i.status === "removed").length,
    modifiedCount: items.filter((i) => i.status === "modified").length,
    unchangedCount: items.filter((i) => i.status === "unchanged").length,
  };
}

export const SECTION_SPECS: SectionSpec[] = [
  { key: "entities", label: "实体 Entities", containerTag: "Entities", itemTag: "Entity", drillIntoAttributes: true },
  { key: "webresources", label: "Web 资源", containerTag: "WebResources", itemTag: "WebResource" },
  { key: "workflows", label: "流程 Workflows", containerTag: "Workflows", itemTag: "Workflow" },
  { key: "roles", label: "安全角色 Roles", containerTag: "Roles", itemTag: "Role" },
  { key: "optionsets", label: "全局选项集 Option Sets", containerTag: "optionsets", itemTag: "optionset" },
  {
    key: "relationships",
    label: "实体关系 Relationships",
    containerTag: "EntityRelationships",
    itemTag: "EntityRelationship",
  },
  { key: "entitymaps", label: "实体映射 Entity Maps", containerTag: "EntityMaps", itemTag: "EntityMap" },
];
