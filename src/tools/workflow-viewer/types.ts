export type ProcessCategory = 0 | 2 | 3 | 5;

export const CATEGORY_LABELS: Record<ProcessCategory, string> = {
  0: "经典工作流",
  2: "业务规则",
  3: "Action",
  5: "云端流",
};

export interface WorkflowListItem {
  workflowId: string;
  name: string;
  uniqueName: string;
  category: ProcessCategory;
  primaryEntity: string;
  primaryEntityLabel: string;
  stateCode: number;
  stateLabel: string;
  /** 0 = background, 1 = real-time. */
  mode: number;
  ownerName: string;
  modifiedOn: string;
  description: string;
  triggerOnCreate: boolean;
  triggerOnDelete: boolean;
  /** Comma-separated logical names; "" or null both mean "not triggered on update". */
  triggerOnUpdateAttributeList: string | null;
  createStage: number | null;
  updateStage: number | null;
  deleteStage: number | null;
  onDemand: boolean;
  subprocess: boolean;
  scopeLabel: string;
  runAsLabel: string;
}

export interface WorkflowDefinition {
  xaml: string | null;
  clientData: string | null;
}

/** One designer step of a classic workflow / action / business rule, rebuilt from the compiled
 *  xaml. `kind` is the designer's own step type name (Update, Create, Condition, Wait, …). */
export interface XamlStep {
  kind: string;
  number: string;
  description: string;
  /** Condition text for a ConditionBranch; target table for Create/Update/SetState/…; custom
   *  activity class name. */
  detail: string;
  /** "column = value" lines for steps that set fields, "input = value" for custom activities. */
  assignments: string[];
  children: XamlStep[];
}

export interface FlowTrigger {
  name: string;
  type: string;
  kind: string;
  connector: string;
  operationId: string;
  parameters: [string, string][];
}

export interface FlowAction {
  name: string;
  type: string;
  connector: string;
  operationId: string;
  detail: string;
  /** Child branches: If → "是"/"否", Switch → each case + "默认", Scope/Foreach/Until → "". */
  branches: { label: string; actions: FlowAction[] }[];
}

export interface FlowDefinition {
  triggers: FlowTrigger[];
  actions: FlowAction[];
}
