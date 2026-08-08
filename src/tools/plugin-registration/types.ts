export interface PluginAssembly {
  pluginassemblyid: string;
  name: string;
  version: string;
  ismanaged: boolean;
}

export interface PluginType {
  plugintypeid: string;
  typename: string;
  friendlyname: string | null;
}

export interface SdkMessageRef {
  name: string;
}

export interface SdkMessageFilterRef {
  primaryobjecttypecode: string;
}

export interface PluginStep {
  sdkmessageprocessingstepid: string;
  name: string;
  stage: number;
  mode: number;
  rank: number;
  statecode: number;
  statuscode: number;
  sdkmessageid?: SdkMessageRef | null;
  sdkmessagefilterid?: SdkMessageFilterRef | null;
}

export interface PluginStepImage {
  sdkmessageprocessingstepimageid: string;
  name: string;
  entityalias: string;
  imagetype: number;
}

export const STAGE_LABELS: Record<number, string> = {
  10: "Pre-validation",
  20: "Pre-operation",
  40: "Post-operation",
};

export const MODE_LABELS: Record<number, string> = {
  0: "同步 (Synchronous)",
  1: "异步 (Asynchronous)",
};

export const IMAGE_TYPE_LABELS: Record<number, string> = {
  0: "Pre Image",
  1: "Post Image",
  2: "Pre & Post Image",
};

export const DEPLOYMENT_LABELS: Record<number, string> = {
  0: "Server Only",
  1: "Client Only（已弃用）",
  2: "Both",
};

export const STEP_STATE_LABELS: Record<number, string> = {
  0: "已启用",
  1: "已停用",
};

/** Tree node identity — used for cache keys, expand/collapse state, and selection. */
export type TreeNodeKind = "assembly" | "type" | "step" | "image";

export interface TreeNodeKey {
  kind: TreeNodeKind;
  id: string;
}

export function nodeKey(kind: TreeNodeKind, id: string): string {
  return `${kind}:${id}`;
}

/** Maps a node kind to the Web API collection its own record lives in (for row-detail fetches). */
export const COLLECTION_BY_KIND: Record<TreeNodeKind, string> = {
  assembly: "pluginassemblies",
  type: "plugintypes",
  step: "sdkmessageprocessingsteps",
  image: "sdkmessageprocessingstepimages",
};
