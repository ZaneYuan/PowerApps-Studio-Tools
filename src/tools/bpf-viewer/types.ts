/** Normalized model only — the raw `Microsoft.Crm.Workflow.ObjectModel` tree inside a BPF's
 *  `clientdata` has far more node classes (RelationshipCollectionStep, ActionStep, etc.) than a
 *  stage diagram needs. See bpfParser.ts for the raw shape this is derived from. */

export interface BpfListItem {
  workflowId: string;
  name: string;
  primaryEntity: string;
  uniqueName: string;
  stateCode: number;
}

export interface Step {
  id: string;
  displayName: string;
  dataFieldName: string;
  isRequired: boolean;
}

export interface Stage {
  id: string;
  name: string;
  entityName: string;
  steps: Step[];
}

export type EdgeKind = "default" | "condition";

export interface Edge {
  fromStageId: string;
  toStageId: string;
  kind: EdgeKind;
  /** Branch label + best-effort condition text, e.g. "Check If MQ is not required (contoso_ismqrequired op:6 ...)" — only set for "condition" edges. */
  label?: string;
}

export interface BpfGraph {
  primaryEntityName: string;
  stages: Stage[];
  edges: Edge[];
  /** Parts of clientdata that didn't fit the confirmed shape (nested conditions, multi-entity
   *  chains, unrecognized step classes) — the parser skips these instead of throwing, so a more
   *  exotic real BPF still renders what it can understand. */
  unsupportedNotes: string[];
}
