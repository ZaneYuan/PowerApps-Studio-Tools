export interface PluginTraceLog {
  plugintracelogid: string;
  createdon: string;
  typename: string | null;
  messagename: string | null;
  primaryentity: string | null;
  mode: number | null;
  operationtype: number | null;
  correlationid: string | null;
  depth: number | null;
  performanceexecutionduration: number | null;
  exceptiondetails: string | null;
  messageblock: string | null;
}

export const OPERATION_TYPE_LABELS: Record<number, string> = {
  1: "Plugin",
  2: "Workflow Activity",
};

/** Same 0/1 sync/async semantics as sdkmessageprocessingstep.mode. */
export { MODE_LABELS } from "../plugin-registration/types";

export const TRACE_SETTING_LABELS: Record<number, string> = {
  0: "关闭 (Off)",
  1: "仅异常 (Exception)",
  2: "全部 (All)",
};

export interface TraceFilters {
  typeName: string;
  messageName: string;
  primaryEntity: string;
  onlyErrors: boolean;
  from: string;
  to: string;
  top: number;
}

export const DEFAULT_FILTERS: TraceFilters = {
  typeName: "",
  messageName: "",
  primaryEntity: "",
  onlyErrors: false,
  from: "",
  to: "",
  top: 100,
};
