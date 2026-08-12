import type { BpfGraph, Edge, Stage, Step } from "./types";

/** Loose shape of one node in the `Microsoft.Crm.Workflow.ObjectModel` tree stored in a BPF's
 *  `clientdata` — confirmed live against a real org (contoso-dev's "Example Quotation Process"),
 *  not from any Microsoft doc (there isn't a public one for this internal format). Only the
 *  fields this parser actually reads are declared; everything else is untyped passthrough. */
interface RawNode {
  __class?: string;
  id?: string;
  description?: string;
  name?: string | null;
  stepLabels?: { list?: { labelId?: string; description?: string }[] };
  steps?: { list?: RawNode[] };
  primaryEntityName?: string;
  // StageStep — a stage with no unconditional next (all outgoing paths gated by a
  // ConditionStep, e.g. every branch point's origin stage) has nextStageId: null.
  stageId?: string;
  nextStageId?: string | null;
  // StepStep
  stepStepId?: string;
  isProcessRequired?: boolean;
  // ControlStep
  dataFieldName?: string;
  // ConditionBranchStep → conditionExpression (BinaryExpression / EntityAttributeExpression /
  // PrimitiveExpression) — field name is "conditionOperatoroperator", not "operatoroperator".
  conditionExpression?: RawNode;
  attributeName?: string;
  entity?: { entityName?: string };
  conditionOperatoroperator?: string;
  left?: RawNode;
  right?: unknown;
  primitiveValue?: unknown;
  // SetNextStageStep
  [key: string]: unknown;
}

function classIs(node: RawNode | undefined, prefix: string): boolean {
  return typeof node?.__class === "string" && node.__class.startsWith(prefix);
}

function childList(node: RawNode): RawNode[] {
  return node.steps?.list ?? [];
}

function labelOf(node: RawNode): string {
  return node.stepLabels?.list?.[0]?.description || node.description || node.name || "";
}

/** Best-effort text for a `conditionExpression` tree. Operator codes (`operatoroperator`) aren't
 *  publicly documented anywhere confirmed, so this deliberately renders the raw code (`op:6`)
 *  instead of guessing a label like "equals" that could be wrong. */
function describeExpression(expr: RawNode | undefined, depth = 0): string {
  if (!expr || typeof expr !== "object" || depth > 4) return "";
  if (classIs(expr, "BinaryExpression")) {
    const left = describeExpression(expr.left, depth + 1);
    const op = typeof expr.conditionOperatoroperator === "string" ? `op:${expr.conditionOperatoroperator}` : "op:?";
    const right = describeRightSide(expr.right, depth + 1);
    return `${left || "?"} ${op} ${right}`;
  }
  if (classIs(expr, "EntityAttributeExpression")) {
    return typeof expr.attributeName === "string" ? expr.attributeName : "?";
  }
  if (classIs(expr, "PrimitiveExpression")) {
    return expr.primitiveValue !== undefined ? String(expr.primitiveValue) : "?";
  }
  return expr.__class ? `[${expr.__class}]` : "";
}

function describeRightSide(right: unknown, depth: number): string {
  if (right === null || right === undefined) return "null";
  if (Array.isArray(right)) return right.map((r) => describeRightSide(r, depth)).join(", ");
  if (typeof right === "object") return describeExpression(right as RawNode, depth);
  return String(right);
}

function buildStep(stepNode: RawNode): Step {
  const control = childList(stepNode).find((c) => classIs(c, "ControlStep"));
  return {
    id: typeof stepNode.stepStepId === "string" ? stepNode.stepStepId : (stepNode.id ?? ""),
    displayName: labelOf(stepNode),
    dataFieldName: typeof control?.dataFieldName === "string" ? control.dataFieldName : "",
    isRequired: stepNode.isProcessRequired === true,
  };
}

function buildStage(stageNode: RawNode, entityName: string, notes: string[]): Stage {
  const name = labelOf(stageNode);
  const steps: Step[] = [];
  for (const child of childList(stageNode)) {
    if (classIs(child, "StepStep")) {
      steps.push(buildStep(child));
    } else if (classIs(child, "ConditionStep")) {
      continue; // collected separately by collectConditionEdges, not part of the step list
    } else if (child.__class) {
      notes.push(`阶段 "${name}" 里有未识别的步骤类型 ${child.__class}，已跳过。`);
    }
  }
  return {
    id: typeof stageNode.stageId === "string" ? stageNode.stageId : (stageNode.id ?? ""),
    name,
    entityName,
    steps,
  };
}

/** A stage's branch point (if any) is a `ConditionStep` sibling sitting inline among its
 *  `StepStep` children — not a separate slot. Each `ConditionBranchStep` under it carries the
 *  condition text plus a nested `SetNextStageStep{stageId}` naming the jump target; v1 only
 *  supports this one level (a branch that itself branches again is flagged in unsupportedNotes,
 *  not modeled). */
function collectConditionEdges(stageNode: RawNode, fromStageId: string, notes: string[], edges: Edge[]) {
  for (const child of childList(stageNode)) {
    if (!classIs(child, "ConditionStep")) continue;
    for (const branch of childList(child)) {
      if (!classIs(branch, "ConditionBranchStep")) {
        notes.push(`条件节点里有未识别的分支类型 ${branch.__class ?? "?"}，已跳过。`);
        continue;
      }
      // An empty description is a real, observed case (the implicit "else" branch of a
      // condition has no authored label) — falling back to labelOf() here would leak the
      // internal step name ("Step_75") instead, so use an explicit placeholder.
      const branchLabel = branch.description || "（否则 / 未命名分支）";
      const conditionText = describeExpression(branch.conditionExpression);
      const setNext = childList(branch).find((c) => classIs(c, "SetNextStageStep"));
      const targetStageId = typeof setNext?.stageId === "string" ? setNext.stageId : null;
      if (!targetStageId) {
        notes.push(`分支 "${branchLabel}" 没有找到明确的跳转目标（SetNextStageStep），已跳过这条连线。`);
        continue;
      }
      edges.push({
        fromStageId,
        toStageId: targetStageId,
        kind: "condition",
        label: conditionText ? `${branchLabel}（${conditionText}）` : branchLabel,
      });
    }
  }
}

/** Parses a BPF's `workflow.clientdata` JSON into a normalized stage/edge graph. Never throws on
 *  a structure that doesn't fit the confirmed shape — anything unrecognized is recorded in
 *  `unsupportedNotes` and skipped, so a more exotic real-world BPF still renders what it can. */
export function parseBpfClientData(raw: string): BpfGraph {
  const notes: string[] = [];
  let root: RawNode;
  try {
    root = JSON.parse(raw);
  } catch (err) {
    return {
      primaryEntityName: "",
      stages: [],
      edges: [],
      unsupportedNotes: [`clientdata 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const primaryEntityName = typeof root.primaryEntityName === "string" ? root.primaryEntityName : "";
  const stages: Stage[] = [];
  const edges: Edge[] = [];

  function walk(node: RawNode, entityName: string) {
    for (const child of childList(node)) {
      if (classIs(child, "EntityStep")) {
        walk(child, child.description || entityName);
      } else if (classIs(child, "StageStep")) {
        const stage = buildStage(child, entityName, notes);
        stages.push(stage);
        // The authoritative default edge — read directly off the stage, not inferred from
        // document order. Verified live: a stage whose only outgoing paths are conditional
        // (e.g. the branch point itself) has nextStageId: null, and document order otherwise
        // interleaves the default path with branch-only stages in a way that does NOT match
        // real adjacency (a naive "connect consecutive stages" pass produced a false edge from
        // the top path's last stage straight into the branch's first stage).
        if (typeof child.nextStageId === "string") {
          edges.push({ fromStageId: stage.id, toStageId: child.nextStageId, kind: "default" });
        }
        collectConditionEdges(child, stage.id, notes, edges);
      } else if (childList(child).length > 0) {
        // an unrecognized wrapper (e.g. RelationshipCollectionStep) — recurse in case stages
        // are nested deeper than the confirmed sample, instead of silently missing them
        walk(child, entityName);
      }
    }
  }
  walk(root, primaryEntityName);

  if (stages.length === 0) {
    notes.push("没有识别出任何阶段（StageStep）——clientdata 结构超出 v1 支持范围，请展开下方原始 JSON 查看。");
  }

  return { primaryEntityName, stages, edges, unsupportedNotes: notes };
}
