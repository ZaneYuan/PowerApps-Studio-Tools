import type { FlowAction, FlowDefinition, FlowTrigger } from "./types";

/** A cloud flow's `clientdata` is `{ properties: { definition } }` where `definition` is a
 *  standard Logic Apps workflow definition (triggers / actions / runAfter). */
interface RawOperation {
  type?: string;
  kind?: string;
  runAfter?: Record<string, unknown>;
  inputs?: {
    host?: { apiId?: string; connectionName?: string; operationId?: string; workflowReferenceName?: string };
    parameters?: Record<string, unknown>;
    recurrence?: { frequency?: string; interval?: number };
    [key: string]: unknown;
  };
  recurrence?: { frequency?: string; interval?: number };
  expression?: unknown;
  foreach?: unknown;
  actions?: Record<string, RawOperation>;
  else?: { actions?: Record<string, RawOperation> };
  cases?: Record<string, { case?: unknown; actions?: Record<string, RawOperation> }>;
  default?: { actions?: Record<string, RawOperation> };
}

function connectorName(op: RawOperation): string {
  const apiId = op.inputs?.host?.apiId ?? "";
  return apiId ? apiId.slice(apiId.lastIndexOf("/") + 1) : "";
}

function display(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parseTrigger(name: string, op: RawOperation): FlowTrigger {
  const parameters: [string, string][] = Object.entries(op.inputs?.parameters ?? {}).map(([k, v]) => [
    k.replace(/^subscriptionRequest\//, ""),
    display(v),
  ]);
  const recurrence = op.recurrence ?? op.inputs?.recurrence;
  if (recurrence) parameters.push(["recurrence", `every ${recurrence.interval ?? 1} ${recurrence.frequency ?? "?"}`]);
  return {
    name,
    type: op.type ?? "",
    kind: op.kind ?? "",
    connector: connectorName(op),
    operationId: op.inputs?.host?.operationId ?? "",
    parameters,
  };
}

function actionDetail(op: RawOperation): string {
  const params = op.inputs?.parameters ?? {};
  if (op.type === "If" || op.type === "Switch") return display(op.expression);
  if (op.type === "Foreach") return display(op.foreach);
  if (op.type === "Workflow") return op.inputs?.host?.workflowReferenceName ?? "";
  const parts = ["entityName", "actionName", "recordId", "$filter"]
    .filter((k) => params[k] !== undefined)
    .map((k) => `${k}: ${display(params[k])}`);
  return parts.join("  ");
}

/** Logic Apps stores actions as an unordered object; the designer's order comes from `runAfter`.
 *  Siblings are emitted in dependency order, falling back to authoring order for ties. */
function orderByRunAfter(actions: Record<string, RawOperation>): [string, RawOperation][] {
  const entries = Object.entries(actions);
  const done = new Set<string>();
  const ordered: [string, RawOperation][] = [];
  while (ordered.length < entries.length) {
    const ready = entries.find(
      ([name, op]) => !done.has(name) && Object.keys(op.runAfter ?? {}).every((dep) => done.has(dep) || !(dep in actions)),
    );
    const next = ready ?? entries.find(([name]) => !done.has(name))!;
    done.add(next[0]);
    ordered.push(next);
  }
  return ordered;
}

function parseActions(actions: Record<string, RawOperation> | undefined): FlowAction[] {
  if (!actions) return [];
  return orderByRunAfter(actions).map(([name, op]) => {
    const branches: FlowAction["branches"] = [];
    if (op.type === "If") {
      branches.push({ label: "是", actions: parseActions(op.actions) });
      branches.push({ label: "否", actions: parseActions(op.else?.actions) });
    } else if (op.type === "Switch") {
      for (const [caseName, c] of Object.entries(op.cases ?? {})) {
        branches.push({ label: `case ${display(c.case)}（${caseName}）`, actions: parseActions(c.actions) });
      }
      branches.push({ label: "默认", actions: parseActions(op.default?.actions) });
    } else if (op.actions) {
      branches.push({ label: "", actions: parseActions(op.actions) });
    }
    return {
      name,
      type: op.type ?? "",
      connector: connectorName(op),
      operationId: op.inputs?.host?.operationId ?? "",
      detail: actionDetail(op),
      branches,
    };
  });
}

export function parseFlowClientData(clientData: string): FlowDefinition {
  const parsed = JSON.parse(clientData) as { properties?: { definition?: { triggers?: Record<string, RawOperation>; actions?: Record<string, RawOperation> } } };
  const definition = parsed.properties?.definition;
  if (!definition) throw new Error("clientdata 里没有 properties.definition，不是云端流定义。");
  return {
    triggers: Object.entries(definition.triggers ?? {}).map(([name, op]) => parseTrigger(name, op)),
    actions: parseActions(definition.actions),
  };
}
