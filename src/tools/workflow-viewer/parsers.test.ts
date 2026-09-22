// @vitest-environment jsdom
// Fixtures are real exported definitions (classic workflows, an action, a business rule, cloud
// flows). The two customer-authored workflows had table, column and assembly names renamed to
// "contoso" and GUIDs zeroed; the xaml structure is untouched.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkflowXaml } from "./xamlParser";
import { parseFlowClientData } from "./flowParser";
import type { FlowAction, XamlStep } from "./types";

function fixture(name: string): string {
  return readFileSync(resolve(process.cwd(), "src/tools/workflow-viewer/testFixtures", name), "utf8");
}

function outline(steps: XamlStep[], depth = 0): string[] {
  return steps.flatMap((s) => [`${"  ".repeat(depth)}${s.kind}${s.number}`, ...outline(s.children, depth + 1)]);
}

function actionOutline(actions: FlowAction[], depth = 0): string[] {
  return actions.flatMap((a) => [
    `${"  ".repeat(depth)}${a.name}`,
    ...a.branches.flatMap((b) => [
      ...(b.label ? [`${"  ".repeat(depth + 1)}[${b.label}]`] : []),
      ...actionOutline(b.actions, depth + (b.label ? 2 : 1)),
    ]),
  ]);
}

describe("parseWorkflowXaml", () => {
  it("rebuilds conditions, waits, custom activities and stop steps in designer order", () => {
    const steps = parseWorkflowXaml(fixture("reminder-email.workflow.xaml"));
    expect(outline(steps)).toEqual([
      "Condition1",
      "  ConditionBranch2",
      "    CustomActivity25",
      "    Wait13",
      "      WaitTimeout15",
      "        CustomActivity16",
      "    Wait17",
      "      WaitTimeout19",
      "        CustomActivity20",
      "    Wait21",
      "      WaitTimeout23",
      "        CustomActivity24",
      "StopWorkflow6",
    ]);
    const [condition, stop] = steps;
    expect(condition.description).toBe("If new flow and status is Request Sent");
    expect(condition.children[0].detail).toBe(
      '(contoso_enrollment.statuscode Equal "421320002" And contoso_enrollment.contoso_flow Equal "1")',
    );
    const callWebApi = condition.children[0].children[1].children[0].children[0];
    expect(callWebApi.description).toBe("Call Web API");
    expect(callWebApi.detail).toBe("Contoso.Crm.Plugins.WorkflowActivities.CallWebApiAction");
    expect(callWebApi.assignments).toContain('Controller = "Enrollment"');
    expect(stop.detail).toBe("Succeeded");
  });

  it("lists the target table and set fields of create / update steps", () => {
    const steps = parseWorkflowXaml(fixture("create-translations.workflow.xaml"));
    const branch = steps[0].children[0];
    const create = branch.children[0];
    expect(create.kind).toBe("Create");
    expect(create.description).toBe("Create English Translation");
    expect(create.detail).toBe("contoso_translation");
    expect(create.assignments.some((a) => a.startsWith("contoso_message = "))).toBe(true);
    const update = branch.children.find((s) => s.kind === "Update");
    expect(update?.detail).toBe("contoso_conditions");
    expect(update?.assignments.map((a) => a.split(" = ")[0])).toEqual(["contoso_textidentifier", "contoso_translationid"]);
    expect(update?.children).toEqual([]);
  });

  it("reads the target state and status of a change-status step", () => {
    const [setState] = parseWorkflowXaml(fixture("close-quote.workflow.xaml"));
    expect(setState).toMatchObject({ kind: "SetState", detail: "quote", assignments: ["statecode = 2", "statuscode = 4"] });
  });

  it("parses an action's send-email step", () => {
    const [sendEmail] = parseWorkflowXaml(fixture("send-password-reset.action.xaml"));
    expect(sendEmail.kind).toBe("SendEmail");
    expect(sendEmail.description).toBe("Send password reset email");
    expect(sendEmail.assignments.map((a) => a.split(" = ")[0])).toEqual(expect.arrayContaining(["to", "subject"]));
  });

  it("keeps both branches of a business rule as siblings", () => {
    const steps = parseWorkflowXaml(fixture("business-rule.xaml"));
    expect(outline(steps)).toEqual([
      "Condition1",
      "  ConditionBranch2",
      "    SetVisibility2",
      "    SetAttributeValue1",
      "  ConditionBranch3",
      "    SetVisibility3",
    ]);
  });

  it("rejects malformed xaml instead of returning an empty tree", () => {
    expect(() => parseWorkflowXaml("<Activity><broken></Activity>")).toThrow(/xaml 解析失败/);
  });
});

describe("parseFlowClientData", () => {
  it("reads a Dataverse row trigger's parameters", () => {
    const { triggers } = parseFlowClientData(fixture("iot-parent-alerts.flow.json"));
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ connector: "shared_commondataserviceforapps", operationId: "SubscribeWebhookTrigger" });
    expect(Object.fromEntries(triggers[0].parameters)).toMatchObject({
      message: "1",
      entityname: "msdyn_iotalert",
      scope: "4",
      filterexpression: "msdyn_iotalertid eq null",
    });
  });

  it("orders sibling actions by runAfter rather than by JSON key order", () => {
    const { triggers, actions } = parseFlowClientData(fixture("transfer-data.flow.json"));
    expect(triggers[0]).toMatchObject({ type: "Request", kind: "Button" });
    expect(actions.map((a) => a.name)).toEqual([
      "Transfer_Approval_Template_Data_",
      "Transfer_Node",
      "Transfer_Approval_Direction_Data",
      "Respond_to_a_Power_App_or_flow",
    ]);
  });

  it("nests loop bodies and both If branches", () => {
    const { actions } = parseFlowClientData(fixture("transfer-direction.flow.json"));
    expect(actionOutline(actions)).toEqual([
      "Parse_JSON",
      "Apply_to_each",
      "  Approval_Dirctrion_List_rows",
      "  Apply_to_each_2",
      "    Upsert_a_row_in_selected_environment",
      "    handle_inactive_record",
      "      [是]",
      "        Upsert_a_row_in_selected_environment_2",
      "      [否]",
      "Respond_to_a_Power_App_or_flow",
    ]);
    const listRows = actions[1].branches[0].actions[0];
    expect(listRows).toMatchObject({ connector: "shared_commondataserviceforapps", operationId: "ListRecords" });
  });

  it("rejects clientdata that isn't a flow definition", () => {
    expect(() => parseFlowClientData('{"properties":{}}')).toThrow(/不是云端流定义/);
  });
});
