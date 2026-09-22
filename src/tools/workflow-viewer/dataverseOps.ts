import { callNative } from "../../native/bridge";
import { runPagedQuery } from "../../native/dataverseQuery";
import type { ProcessCategory, WorkflowDefinition, WorkflowListItem } from "./types";

const FV = "@OData.Community.Display.V1.FormattedValue";

interface RawWorkflow {
  workflowid: string;
  name: string;
  uniquename: string | null;
  category: ProcessCategory;
  primaryentity: string;
  statecode: number;
  mode: number;
  modifiedon: string;
  description: string | null;
  triggeroncreate: boolean;
  triggerondelete: boolean;
  triggeronupdateattributelist: string | null;
  createstage: number | null;
  updatestage: number | null;
  deletestage: number | null;
  ondemand: boolean;
  subprocess: boolean;
  scope: number;
  runas: number;
  _ownerid_value: string | null;
  [annotation: string]: unknown;
}

const SELECT = [
  "workflowid",
  "name",
  "uniquename",
  "category",
  "primaryentity",
  "statecode",
  "mode",
  "modifiedon",
  "description",
  "triggeroncreate",
  "triggerondelete",
  "triggeronupdateattributelist",
  "createstage",
  "updatestage",
  "deletestage",
  "ondemand",
  "subprocess",
  "scope",
  "runas",
  "_ownerid_value",
].join(",");

function formatted(w: RawWorkflow, field: string, fallback: string): string {
  const v = w[`${field}${FV}`];
  return typeof v === "string" ? v : fallback;
}

/** `type eq 1` keeps process definitions only — activations (type 2) and templates (type 3) are
 *  copies of the same definition. The filter on the indexed `type` column also matters for speed:
 *  an unfiltered query on `workflows` has been seen to time out on a large org. */
export async function fetchWorkflows(connectionId: string): Promise<WorkflowListItem[]> {
  const res = await runPagedQuery(
    connectionId,
    `workflows?$select=${SELECT}&$filter=type eq 1 and (category eq 0 or category eq 2 or category eq 3 or category eq 5)&$orderby=name`,
    { maxRows: 0, includeFormattedValues: true },
  );
  return (res.value as RawWorkflow[]).map((w) => ({
    workflowId: w.workflowid,
    name: w.name,
    uniqueName: w.uniquename ?? "",
    category: w.category,
    primaryEntity: w.primaryentity,
    primaryEntityLabel: formatted(w, "primaryentity", w.primaryentity),
    stateCode: w.statecode,
    stateLabel: formatted(w, "statecode", String(w.statecode)),
    mode: w.mode,
    ownerName: formatted(w, "_ownerid_value", ""),
    modifiedOn: w.modifiedon,
    description: w.description ?? "",
    triggerOnCreate: w.triggeroncreate,
    triggerOnDelete: w.triggerondelete,
    triggerOnUpdateAttributeList: w.triggeronupdateattributelist,
    createStage: w.createstage,
    updateStage: w.updatestage,
    deleteStage: w.deletestage,
    onDemand: w.ondemand,
    subprocess: w.subprocess,
    scopeLabel: formatted(w, "scope", String(w.scope)),
    runAsLabel: formatted(w, "runas", String(w.runas)),
  }));
}

export async function fetchWorkflowDefinition(connectionId: string, workflowId: string): Promise<WorkflowDefinition> {
  const res = await callNative<{ xaml: string | null; clientdata: string | null }>("dataverse.request", {
    connectionId,
    method: "GET",
    path: `workflows(${workflowId})?$select=xaml,clientdata`,
  });
  return { xaml: res.xaml, clientData: res.clientdata };
}
