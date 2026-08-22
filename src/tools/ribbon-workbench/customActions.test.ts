// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  appendIntoContainer,
  applyAddButtonAction,
  applyHideAction,
  buildAddButtonCustomAction,
  buildHideCustomAction,
  commandDefinitionExists,
  existingCustomActionIds,
  parseCustomActions,
} from "./customActions";

const SKELETON = "<RibbonDiffXml><CustomActions /><Templates /><CommandDefinitions /><RuleDefinitions /><LocLabels /></RibbonDiffXml>";

const DIFF_WITH_ACTIONS = `<RibbonDiffXml>
  <CustomActions>
    <CustomAction Id="ad.account.Foo.CustomAction" Location="Mscrm.Form.account.MainTab.Actions.Controls._children" Sequence="100">
      <CommandUIDefinition>
        <Button Id="ad.account.Foo.Button" Command="ad.account.Foo.Command" LabelText="Foo" Sequence="100" TemplateAlias="o1" />
      </CommandUIDefinition>
    </CustomAction>
    <HideCustomAction HideActionId="ad.account.HideBar" Location="Mscrm.Form.account.SomeExistingButton" />
  </CustomActions>
  <Templates><RibbonTemplates Id="Mscrm.Templates" /></Templates>
  <CommandDefinitions>
    <CommandDefinition Id="ad.account.Foo.Command"><EnableRules /><DisplayRules /><Actions /></CommandDefinition>
  </CommandDefinitions>
  <RuleDefinitions />
  <LocLabels />
</RibbonDiffXml>`;

describe("parseCustomActions", () => {
  it("returns an empty list for the untouched skeleton", () => {
    expect(parseCustomActions(SKELETON)).toEqual([]);
  });

  it("parses a CustomAction with a nested Button, and a HideCustomAction, from a real diff", () => {
    const actions = parseCustomActions(DIFF_WITH_ACTIONS);
    expect(actions).toHaveLength(2);

    const add = actions.find((a) => a.kind === "add")!;
    expect(add.id).toBe("ad.account.Foo.CustomAction");
    expect(add.location).toBe("Mscrm.Form.account.MainTab.Actions.Controls._children");
    expect(add.buttonLabelText).toBe("Foo");
    expect(add.buttonCommand).toBe("ad.account.Foo.Command");

    const hide = actions.find((a) => a.kind === "hide")!;
    expect(hide.id).toBe("ad.account.HideBar");
    expect(hide.location).toBe("Mscrm.Form.account.SomeExistingButton");
  });
});

describe("buildHideCustomAction", () => {
  it("produces a well-formed <HideCustomAction> with HideActionId + Location (not SharePoint's differently-cased Id attribute)", () => {
    const xml = buildHideCustomAction({ hideActionId: "ad.account.HideAssign", location: "Mscrm.Form.account.Actions.Assign" });
    expect(xml).toBe('<HideCustomAction HideActionId="ad.account.HideAssign" Location="Mscrm.Form.account.Actions.Assign" />');
  });

  it("escapes XML-special characters in attribute values", () => {
    const xml = buildHideCustomAction({ hideActionId: 'a"b<c', location: "x&y" });
    expect(xml).toContain("a&quot;b&lt;c");
    expect(xml).toContain("x&amp;y");
  });
});

describe("buildAddButtonCustomAction", () => {
  it("produces a CustomAction/Button/CommandDefinition/JavaScriptFunction shape matching Microsoft's own documented sample field-for-field", () => {
    const { customAction, commandDefinition } = buildAddButtonCustomAction({
      customActionId: "ad.account.SendToPortal.CustomAction",
      location: "Mscrm.Form.account.MainTab.Actions.Controls._children",
      commandId: "ad.account.SendToPortal.Command",
      buttonId: "ad.account.SendToPortal.Button",
      labelText: "Send to Portal",
      toolTipTitle: "Send to Portal",
      webResourceName: "ad_sendtoportal.js",
      functionName: "Ad.SendToPortal.run",
      sequence: 57,
    });

    expect(customAction).toContain('Id="ad.account.SendToPortal.CustomAction"');
    expect(customAction).toContain('Location="Mscrm.Form.account.MainTab.Actions.Controls._children"');
    expect(customAction).toContain('Sequence="57"');
    expect(customAction).toContain('<Button Id="ad.account.SendToPortal.Button" Command="ad.account.SendToPortal.Command"');
    expect(customAction).toContain('TemplateAlias="o1"');

    expect(commandDefinition).toContain('<CommandDefinition Id="ad.account.SendToPortal.Command">');
    expect(commandDefinition).toContain('<JavaScriptFunction FunctionName="Ad.SendToPortal.run" Library="$webresource:ad_sendtoportal.js" />');
  });

  it("omits ToolTipTitle entirely when not provided, rather than emitting an empty attribute", () => {
    const { customAction } = buildAddButtonCustomAction({
      customActionId: "x", location: "y", commandId: "z", buttonId: "b",
      labelText: "L", webResourceName: "w.js", functionName: "f",
    });
    expect(customAction).not.toContain("ToolTipTitle");
  });

  it("both generated fragments parse as well-formed XML on their own", () => {
    const { customAction, commandDefinition } = buildAddButtonCustomAction({
      customActionId: "x", location: "y", commandId: "z", buttonId: "b",
      labelText: 'Quote "special" & <weird>', webResourceName: "w.js", functionName: "f",
    });
    const parser = new DOMParser();
    expect(parser.parseFromString(customAction, "application/xml").querySelector("parsererror")).toBeNull();
    expect(parser.parseFromString(commandDefinition, "application/xml").querySelector("parsererror")).toBeNull();
  });
});

describe("appendIntoContainer — full round trip against a real save flow", () => {
  it("inserts a HideCustomAction into <CustomActions> and it round-trips through parseCustomActions", () => {
    const fragment = buildHideCustomAction({ hideActionId: "ad.account.HideAssign", location: "Mscrm.Form.account.Actions.Assign" });
    const updated = appendIntoContainer(SKELETON, "CustomActions", [fragment]);
    const actions = parseCustomActions(updated);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("hide");
    expect(actions[0].id).toBe("ad.account.HideAssign");
  });

  it("inserts a CustomAction+CommandDefinition pair into their respective containers without disturbing existing ones", () => {
    const { customAction, commandDefinition } = buildAddButtonCustomAction({
      customActionId: "ad.account.New.CustomAction", location: "Mscrm.Form.account.MainTab.Actions.Controls._children",
      commandId: "ad.account.New.Command", buttonId: "ad.account.New.Button", labelText: "New Button",
      webResourceName: "ad_new.js", functionName: "Ad.New.run",
    });
    let updated = appendIntoContainer(DIFF_WITH_ACTIONS, "CustomActions", [customAction]);
    updated = appendIntoContainer(updated, "CommandDefinitions", [commandDefinition]);

    const actions = parseCustomActions(updated);
    expect(actions).toHaveLength(3); // the 2 pre-existing ones from DIFF_WITH_ACTIONS + the new one
    expect(actions.some((a) => a.id === "ad.account.New.CustomAction")).toBe(true);
    expect(actions.some((a) => a.id === "ad.account.Foo.CustomAction")).toBe(true); // pre-existing, untouched
    expect(actions.some((a) => a.id === "ad.account.HideBar")).toBe(true); // pre-existing, untouched
    expect(commandDefinitionExists(updated, "ad.account.New.Command")).toBe(true);
    expect(commandDefinitionExists(updated, "ad.account.Foo.Command")).toBe(true); // pre-existing, untouched
  });

  it("creates the container if the input RibbonDiffXml doesn't already have one", () => {
    const bareDiff = "<RibbonDiffXml></RibbonDiffXml>";
    const fragment = buildHideCustomAction({ hideActionId: "x", location: "y" });
    const updated = appendIntoContainer(bareDiff, "CustomActions", [fragment]);
    expect(parseCustomActions(updated)).toHaveLength(1);
  });
});

describe("existingCustomActionIds / commandDefinitionExists", () => {
  it("collects every Id/HideActionId already in use, for collision checking before generating a new one", () => {
    const ids = existingCustomActionIds(DIFF_WITH_ACTIONS);
    expect(ids.has("ad.account.Foo.CustomAction")).toBe(true);
    expect(ids.has("ad.account.HideBar")).toBe(true);
    expect(ids.has("ad.account.NotPresent")).toBe(false);
  });

  it("commandDefinitionExists is false for a fresh skeleton and true once one is added", () => {
    expect(commandDefinitionExists(SKELETON, "ad.account.Foo.Command")).toBe(false);
    expect(commandDefinitionExists(DIFF_WITH_ACTIONS, "ad.account.Foo.Command")).toBe(true);
  });
});

describe("applyHideAction — the guided 'hide a button' form's pure core", () => {
  it("returns an error, unchanged input untouched, when the target Id is blank", () => {
    const result = applyHideAction(SKELETON, "   ");
    expect(result).toEqual({ error: expect.stringContaining("要隐藏的按钮") });
  });

  it("applies a real HideCustomAction named '<targetId>.Hide' when there's no collision", () => {
    const result = applyHideAction(SKELETON, "Mscrm.Form.account.Actions.Assign");
    expect("xml" in result).toBe(true);
    const actions = parseCustomActions((result as { xml: string }).xml);
    expect(actions).toEqual([{ kind: "hide", id: "Mscrm.Form.account.Actions.Assign.Hide", location: "Mscrm.Form.account.Actions.Assign" }]);
  });

  it("refuses (with an error, not a silent duplicate) when '<targetId>.Hide' is already in use", () => {
    const once = applyHideAction(SKELETON, "Mscrm.Form.account.Actions.Assign");
    const twice = applyHideAction((once as { xml: string }).xml, "Mscrm.Form.account.Actions.Assign");
    expect(twice).toEqual({ error: expect.stringContaining("已经存在一个 Id 为") });
  });

  it("trims whitespace around the target Id before using it", () => {
    const result = applyHideAction(SKELETON, "  Mscrm.Form.account.Actions.Assign  ");
    const actions = parseCustomActions((result as { xml: string }).xml);
    expect(actions[0].id).toBe("Mscrm.Form.account.Actions.Assign.Hide");
  });
});

describe("applyAddButtonAction — the guided 'add a JS button' form's pure core", () => {
  const baseParams = {
    entityName: "account",
    solutionUniqueName: "ad_MySolution",
    location: "Mscrm.Form.account.MainTab.Actions.Controls._children",
    labelText: "Send to Portal",
    toolTipTitle: "",
    webResourceName: "ad_sendtoportal.js",
    functionName: "Ad.SendToPortal.run",
  };

  it("errors when any required field is blank, without touching the input", () => {
    expect(applyAddButtonAction(SKELETON, { ...baseParams, location: "  " }, "x")).toEqual({
      error: expect.stringContaining("请填写完整"),
    });
    expect(applyAddButtonAction(SKELETON, { ...baseParams, labelText: "" }, "x")).toEqual({
      error: expect.stringContaining("请填写完整"),
    });
    expect(applyAddButtonAction(SKELETON, { ...baseParams, webResourceName: "" }, "x")).toEqual({
      error: expect.stringContaining("请填写完整"),
    });
    expect(applyAddButtonAction(SKELETON, { ...baseParams, functionName: "" }, "x")).toEqual({
      error: expect.stringContaining("请填写完整"),
    });
  });

  it("builds the Id/Command/Button triad from '<solution>.<entity>.<slug-of-label>' with no collision", () => {
    const result = applyAddButtonAction(SKELETON, baseParams, "unused");
    const actions = parseCustomActions((result as { xml: string }).xml);
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("ad_MySolution.account.SendtoPortal.CustomAction");
    expect(commandDefinitionExists((result as { xml: string }).xml, "ad_MySolution.account.SendtoPortal.Command")).toBe(true);
  });

  it("falls back to 'custom' as the base prefix when no solution is selected", () => {
    const result = applyAddButtonAction(SKELETON, { ...baseParams, solutionUniqueName: "" }, "unused");
    const actions = parseCustomActions((result as { xml: string }).xml);
    expect(actions[0].id).toBe("custom.account.SendtoPortal.CustomAction");
  });

  it("only applies the disambiguation suffix when the base triad genuinely collides — not on every call", () => {
    const first = applyAddButtonAction(SKELETON, baseParams, "should-be-unused");
    const actions = parseCustomActions((first as { xml: string }).xml);
    expect(actions[0].id).not.toContain("should-be-unused");
  });

  it("a second button with the same label collides on the base triad and gets disambiguated instead of silently duplicating", () => {
    const first = applyAddButtonAction(SKELETON, baseParams, "ignored");
    const second = applyAddButtonAction((first as { xml: string }).xml, baseParams, "abc123");
    const actions = parseCustomActions((second as { xml: string }).xml);
    expect(actions).toHaveLength(2);
    expect(actions.some((a) => a.id === "ad_MySolution.account.SendtoPortal.CustomAction")).toBe(true); // the first one, untouched
    expect(actions.some((a) => a.id === "ad_MySolution.account.SendtoPortal.abc123.CustomAction")).toBe(true); // the disambiguated second one
    expect(commandDefinitionExists((second as { xml: string }).xml, "ad_MySolution.account.SendtoPortal.abc123.Command")).toBe(true);
  });

  it("non-alphanumeric characters in the label are stripped from the slug, and an all-symbol label falls back to 'Button'", () => {
    const symbols = applyAddButtonAction(SKELETON, { ...baseParams, labelText: "!!!" }, "x");
    const actions = parseCustomActions((symbols as { xml: string }).xml);
    expect(actions[0].id).toBe("ad_MySolution.account.Button.CustomAction");

    const mixed = applyAddButtonAction(SKELETON, { ...baseParams, labelText: "Save & Close!" }, "x");
    const mixedActions = parseCustomActions((mixed as { xml: string }).xml);
    expect(mixedActions[0].id).toBe("ad_MySolution.account.SaveClose.CustomAction");
  });

  it("omits ToolTipTitle when blank, and includes it when provided, in the generated CustomAction", () => {
    const withoutTooltip = applyAddButtonAction(SKELETON, baseParams, "x");
    expect((withoutTooltip as { xml: string }).xml).not.toContain("ToolTipTitle");

    const withTooltip = applyAddButtonAction(SKELETON, { ...baseParams, toolTipTitle: "Send" }, "x");
    expect((withTooltip as { xml: string }).xml).toContain('ToolTipTitle="Send"');
  });
});
