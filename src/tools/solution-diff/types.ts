export interface SolutionBundle {
  fileName: string;
  version: string | null;
  uniqueName: string | null;
  customizationsXml: Document | null;
  zip: import("jszip");
}

export type ItemStatus = "added" | "removed" | "modified" | "unchanged";

export interface DiffItem {
  key: string;
  displayName: string;
  status: ItemStatus;
  /** Present only for "modified" items — unified line diff of the serialized XML. */
  diffLines?: DiffLine[];
  /** Nested attribute-level diff, only populated for the Entities section. */
  children?: DiffItem[];
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  text: string;
}

export interface SectionDiff {
  key: string;
  label: string;
  items: DiffItem[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  unchangedCount: number;
}

export interface WebResourceFileDiff {
  status: "added" | "removed" | "modified" | "unchanged" | "unavailable";
  isText: boolean;
  diffLines?: DiffLine[];
}
