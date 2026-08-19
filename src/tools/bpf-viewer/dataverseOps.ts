import { callNative } from "../../native/bridge";
import type { BpfListItem } from "./types";

async function fetchDataverse<T>(connectionId: string, path: string): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "GET", path });
}

/** workflow.category = 4 is Business Process Flow — confirmed live against a real org's
 *  actual BPF processes, not from docs. */
const BPF_CATEGORY = 4;

export async function fetchBusinessProcessFlows(connectionId: string): Promise<BpfListItem[]> {
  const res = await fetchDataverse<{
    value: { workflowid: string; name: string; primaryentity: string; uniquename: string; statecode: number }[];
  }>(
    connectionId,
    `workflows?$filter=category eq ${BPF_CATEGORY}&$select=workflowid,name,primaryentity,statecode,uniquename&$orderby=name`,
  );
  return res.value.map((w) => ({
    workflowId: w.workflowid,
    name: w.name,
    primaryEntity: w.primaryentity,
    uniqueName: w.uniquename,
    stateCode: w.statecode,
  }));
}

/** The BPF designer's source of truth for stage order, steps, and condition branches. `xaml` on
 *  the same record is a redundant compiled form (bigger, and not what the designer reads) and
 *  `processstage.clientdata` only carries a flat per-stage step list with no branch topology —
 *  both deliberately skipped. See bpfParser.ts for what this JSON string contains. */
export async function fetchBpfDefinition(connectionId: string, workflowId: string): Promise<string> {
  const res = await fetchDataverse<{ clientdata: string }>(connectionId, `workflows(${workflowId})?$select=clientdata`);
  return res.clientdata;
}
