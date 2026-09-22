import type { XamlStep } from "./types";

/** The classic designer compiles each step into one or more xaml elements that all carry the
 *  step's `DisplayName`, formatted `<Kind>Step<N>` or `<Kind>Step<N>: <description>` (e.g.
 *  "UpdateStep3", "WaitStep13: Delay 1 day"). Everything else in the xaml — GetEntityProperty,
 *  EvaluateExpression, variables — is plumbing that feeds those steps. Confirmed against every
 *  workflow, action and business rule in two real orgs; there is no public spec for this format. */
const STEP_NAME = /^([A-Za-z]+?)Step(\d+)(?::\s*([\s\S]*))?$/;
const BUILT_IN_ACTIVITY_PREFIX = "Microsoft.Crm.Workflow.Activities.";

/** Strips the VB expression brackets `[x]` and a `DirectCast(x, Type)` / `CType(x, Type)`
 *  wrapper, leaving the variable name the value came from. */
function unwrapVariable(text: string | null | undefined): string {
  let t = (text ?? "").trim();
  if (t.startsWith("[") && t.endsWith("]")) t = t.slice(1, -1).trim();
  const cast = /^(?:DirectCast|CType)\(\s*(\w+)\s*,[^)]*\)$/.exec(t);
  return cast ? cast[1] : t;
}

function shortClassName(assemblyQualifiedName: string): string {
  return assemblyQualifiedName.split(",")[0].trim();
}

/** `x:Key` lives in the XAML namespace; reading it by local name avoids depending on the prefix. */
function xKey(el: Element): string {
  for (const attr of Array.from(el.attributes)) {
    if (attr.localName === "Key") return attr.value;
  }
  return "";
}

function argumentsOf(el: Element): Map<string, Element> {
  const args = new Map<string, Element>();
  const container = Array.from(el.children).find((c) => c.localName === "ActivityReference.Arguments");
  for (const arg of Array.from(container?.children ?? [])) {
    const key = xKey(arg);
    if (key) args.set(key, arg);
  }
  return args;
}

/** Resolves the workflow's intermediate variables back into readable text: each
 *  GetEntityProperty / EvaluateExpression / EvaluateCondition writes its result into a variable
 *  that a later activity reads, so walking them in document order and remembering what each
 *  variable holds reconstructs "contact.statuscode Equal 421320002"-style expressions. */
class VariableResolver {
  private readonly values = new Map<string, string>();

  resolve(text: string | null | undefined): string {
    const raw = unwrapVariable(text);
    if (!raw) return "";
    return this.values.get(raw) ?? raw;
  }

  private resolveList(parameters: string): string[] {
    const inner = unwrapVariable(parameters).replace(/^New Object\(\)\s*\{/, "").replace(/\}$/, "");
    return inner
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => this.values.get(p) ?? p);
  }

  record(el: Element): void {
    if (el.localName === "GetEntityProperty") {
      const target = unwrapVariable(el.getAttribute("Value"));
      if (target) this.values.set(target, `${el.getAttribute("EntityName") ?? "?"}.${el.getAttribute("Attribute") ?? "?"}`);
      return;
    }
    if (el.localName !== "ActivityReference") return;
    const cls = shortClassName(el.getAttribute("AssemblyQualifiedName") ?? "");
    const args = argumentsOf(el);
    const result = unwrapVariable(args.get("Result")?.textContent);
    if (!result) return;

    if (cls === `${BUILT_IN_ACTIVITY_PREFIX}EvaluateExpression`) {
      const op = args.get("ExpressionOperator")?.textContent?.trim() ?? "";
      const params = args.get("Parameters")?.textContent ?? "";
      if (op === "CreateCrmType") {
        const literal = /"((?:[^"]|"")*)"/.exec(params);
        this.values.set(result, literal ? `"${literal[1].replace(/""/g, '"')}"` : "null");
      } else {
        const operands = this.resolveList(params);
        this.values.set(result, op === "SelectFirstNonNull" && operands.length === 1 ? operands[0] : `${op}(${operands.join(", ")})`);
      }
    } else if (cls === `${BUILT_IN_ACTIVITY_PREFIX}ConvertCrmXrmTypes`) {
      this.values.set(result, this.resolve(args.get("Value")?.textContent));
    } else if (cls === `${BUILT_IN_ACTIVITY_PREFIX}EvaluateCondition`) {
      const operand = this.resolve(args.get("Operand")?.textContent);
      const op = args.get("ConditionOperator")?.textContent?.trim() ?? "?";
      const params = args.get("Parameters");
      const values = params && params.localName !== "Null" ? this.resolveList(params.textContent ?? "") : [];
      this.values.set(result, [operand, op, values.join(", ")].filter(Boolean).join(" "));
    } else if (cls === `${BUILT_IN_ACTIVITY_PREFIX}EvaluateLogicalCondition`) {
      const left = this.resolve(args.get("LeftOperand")?.textContent);
      const right = this.resolve(args.get("RightOperand")?.textContent);
      const op = args.get("LogicalOperator")?.textContent?.trim() ?? "?";
      this.values.set(result, `(${left} ${op} ${right})`);
    }
  }
}

function optionSetValueOf(el: Element): string {
  const osv = Array.from(el.getElementsByTagName("*")).find((c) => c.localName === "OptionSetValue");
  return osv?.getAttribute("Value") ?? "?";
}

/** Collects what a step does from the plumbing elements that belong to it (not to a nested step). */
function describe(el: Element, step: XamlStep, vars: VariableResolver): void {
  switch (el.localName) {
    case "SetEntityProperty":
      step.assignments.push(`${el.getAttribute("Attribute") ?? "?"} = ${vars.resolve(el.getAttribute("Value"))}`);
      if (!step.detail) step.detail = el.getAttribute("EntityName") ?? "";
      return;
    case "CreateEntity":
    case "UpdateEntity":
    case "AssignEntity":
    case "SendEmail":
      if (!step.detail) step.detail = el.getAttribute("EntityName") ?? "";
      return;
    case "SetState.State":
      step.assignments.push(`statecode = ${optionSetValueOf(el)}`);
      return;
    case "SetState.Status":
      step.assignments.push(`statuscode = ${optionSetValueOf(el)}`);
      return;
    case "SetState":
    case "StartChildWorkflow":
      if (!step.detail) step.detail = el.getAttribute("EntityName") ?? "";
      return;
    case "InvokeSdkMessageActivity": {
      const message = el.getAttribute("SdkMessageName");
      if (message && message !== "{x:Null}") step.detail = message;
      return;
    }
    case "Assign":
      if (step.kind === "AssignOutputArgument") {
        step.assignments.push(`${unwrapVariable(el.getAttribute("To"))} = ${vars.resolve(el.getAttribute("Value")?.replace(/\.ToString\(\)\]$/, "]"))}`);
      }
      return;
    case "TerminateWorkflow": {
      const status = /OperationStatus\.(\w+)/.exec(el.getAttribute("Exception") ?? "");
      if (status) step.detail = status[1];
      return;
    }
  }
}

function newStep(match: RegExpExecArray): XamlStep {
  return { kind: match[1], number: match[2], description: (match[3] ?? "").trim(), detail: "", assignments: [], children: [] };
}

export function parseWorkflowXaml(xaml: string): XamlStep[] {
  // DOMParser rejects `encoding="utf-16"` on an already-decoded JS string in some engines.
  const doc = new DOMParser().parseFromString(xaml.replace(/^\s*<\?xml[^>]*\?>/, ""), "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) throw new Error(`xaml 解析失败：${parserError.textContent ?? ""}`);

  const vars = new VariableResolver();
  const root: XamlStep = { kind: "", number: "", description: "", detail: "", assignments: [], children: [] };

  function visit(el: Element, step: XamlStep): void {
    vars.record(el);
    describe(el, step, vars);
    const cls = el.localName === "ActivityReference" ? shortClassName(el.getAttribute("AssemblyQualifiedName") ?? "") : "";
    if (cls && !cls.startsWith(BUILT_IN_ACTIVITY_PREFIX)) {
      step.detail = cls;
      for (const [key, arg] of argumentsOf(el)) {
        if (arg.localName === "InArgument") step.assignments.push(`${key} = ${vars.resolve(arg.textContent)}`);
      }
    }
  }

  // A step's elements repeat its DisplayName, sometimes without the ": description" suffix
  // ("UpdateStep7: …" wrapping an UpdateEntity named just "UpdateStep7"), so steps are
  // identified by kind + number rather than by the full DisplayName.
  function walk(el: Element, current: XamlStep, currentKey: string): void {
    for (const child of Array.from(el.children)) {
      const match = STEP_NAME.exec(child.getAttribute("DisplayName") ?? "");
      const key = match ? `${match[1]}${match[2]}` : "";
      if (match && key !== currentKey) {
        const step = newStep(match);
        current.children.push(step);
        // ConditionBranch / WaitBranch / WaitTimeout evaluate into `<Kind>Step<N>_condition`.
        const conditionVar = `${step.kind}Step${step.number}_condition`;
        const condition = vars.resolve(conditionVar);
        if (condition !== conditionVar) step.detail = condition;
        visit(child, step);
        walk(child, step, key);
      } else {
        visit(child, current);
        walk(child, current, currentKey);
      }
    }
  }

  walk(doc.documentElement, root, "");
  return root.children;
}
