import { describe, expect, it } from "vitest";
import {
  buildAttributeBody,
  buildGlobalChoiceAttributeBody,
  buildGlobalOptionSetBody,
  buildOneToManyRelationshipBody,
  buildPublishXmlForEntities,
  suggestSchemaName,
  type NewColumnParams,
} from "./dataverseOps";
import type { BasicColumnType } from "./types";

const BASE_PARAMS: NewColumnParams = {
  schemaName: "ad_testfield",
  displayName: "Test Field",
  description: "",
  required: false,
};

const ALL_TYPES: BasicColumnType[] = [
  "String",
  "Memo",
  "Integer",
  "Decimal",
  "Money",
  "Boolean",
  "DateTime",
  "Picklist",
  "MultiSelectPicklist",
  "BigInt",
];

describe("suggestSchemaName", () => {
  it("strips non-ASCII-alnum characters and prefixes with the publisher prefix", () => {
    expect(suggestSchemaName("ad", "Claude Test Table")).toBe("ad_ClaudeTestTable");
  });

  it("collapses to the bare prefix for a non-ASCII display name", () => {
    expect(suggestSchemaName("ad", "测试表")).toBe("ad_");
  });
});

describe("buildAttributeBody — every one of the 8 basic column types", () => {
  it.each(ALL_TYPES)("%s produces a body with the matching @odata.type", (type) => {
    const body = buildAttributeBody(type, false, BASE_PARAMS);
    expect(body["@odata.type"]).toBe(`Microsoft.Dynamics.CRM.${type}AttributeMetadata`);
    expect(body.SchemaName).toBe("ad_testfield");
  });

  it.each(ALL_TYPES.filter((t) => t !== "MultiSelectPicklist"))("%s's wire AttributeType matches its own type name", (type) => {
    // MultiSelectPicklist is excluded on purpose — its real wire AttributeType is "Virtual", not
    // "MultiSelectPicklist" (confirmed against a real Dataverse 500, then against Microsoft's own
    // docs example — see the dedicated MultiSelectPicklist test below for why).
    const body = buildAttributeBody(type, false, BASE_PARAMS);
    expect(body.AttributeType).toBe(type);
  });

  it("every type body is JSON-serializable (no undefined/circular values leaking into the POST payload)", () => {
    for (const type of ALL_TYPES) {
      const body = buildAttributeBody(type, false, BASE_PARAMS);
      expect(() => JSON.stringify(body)).not.toThrow();
      const roundTripped = JSON.parse(JSON.stringify(body));
      expect(roundTripped["@odata.type"]).toBe(body["@odata.type"]);
    }
  });

  it("String sets IsPrimaryName only when isPrimaryName=true, and defaults MaxLength to 100", () => {
    const primary = buildAttributeBody("String", true, BASE_PARAMS);
    expect(primary.IsPrimaryName).toBe(true);
    expect(primary.MaxLength).toBe(100);

    const normal = buildAttributeBody("String", false, BASE_PARAMS);
    expect(normal.IsPrimaryName).toBeUndefined();
  });

  it("String honors an explicit maxLength override", () => {
    const body = buildAttributeBody("String", false, { ...BASE_PARAMS, maxLength: 250 });
    expect(body.MaxLength).toBe(250);
  });

  it("Memo defaults MaxLength to 2000 (distinct from String's 100)", () => {
    const body = buildAttributeBody("Memo", false, BASE_PARAMS);
    expect(body.MaxLength).toBe(2000);
    expect(body.Format).toBe("TextArea");
  });

  it("Integer defaults to the full Int32 range", () => {
    const body = buildAttributeBody("Integer", false, BASE_PARAMS);
    expect(body.MinValue).toBe(-2147483648);
    expect(body.MaxValue).toBe(2147483647);
  });

  it("Decimal defaults Precision to 2 and honors an override", () => {
    const body = buildAttributeBody("Decimal", false, BASE_PARAMS);
    expect(body.Precision).toBe(2);
    const withPrecision = buildAttributeBody("Decimal", false, { ...BASE_PARAMS, precision: 4 });
    expect(withPrecision.Precision).toBe(4);
  });

  it("Money sets PrecisionSource (required by the Web API for MoneyAttributeMetadata)", () => {
    const body = buildAttributeBody("Money", false, BASE_PARAMS);
    expect(body.PrecisionSource).toBe(2);
  });

  it("Boolean wires up a Boolean-type OptionSet with True/False labels, defaulting to 是/否", () => {
    const body = buildAttributeBody("Boolean", false, BASE_PARAMS) as Record<string, any>;
    // Regression guard for a real 400 confirmed against ZaneTest (2026-08-21 integration test):
    // the nested OptionSet must be the derived BooleanOptionSetMetadata type, not the generic
    // OptionSetMetadata every other OptionSet-bearing type here correctly uses.
    expect(body.OptionSet["@odata.type"]).toBe("Microsoft.Dynamics.CRM.BooleanOptionSetMetadata");
    expect(body.OptionSet.OptionSetType).toBe("Boolean");
    expect(body.OptionSet.TrueOption.Value).toBe(1);
    expect(body.OptionSet.FalseOption.Value).toBe(0);
    expect(body.OptionSet.TrueOption.Label.LocalizedLabels[0].Label).toBe("是");
    expect(body.OptionSet.FalseOption.Label.LocalizedLabels[0].Label).toBe("否");
  });

  it("Boolean honors custom true/false labels", () => {
    const body = buildAttributeBody("Boolean", false, { ...BASE_PARAMS, trueLabel: "Active", falseLabel: "Inactive" }) as Record<string, any>;
    expect(body.OptionSet.TrueOption.Label.LocalizedLabels[0].Label).toBe("Active");
    expect(body.OptionSet.FalseOption.Label.LocalizedLabels[0].Label).toBe("Inactive");
  });

  it("DateTime defaults to DateOnly format", () => {
    const body = buildAttributeBody("DateTime", false, BASE_PARAMS);
    expect(body.Format).toBe("DateOnly");
    const dateAndTime = buildAttributeBody("DateTime", false, { ...BASE_PARAMS, dateFormat: "DateAndTime" });
    expect(dateAndTime.Format).toBe("DateAndTime");
  });

  it("Picklist builds a local (non-global) OptionSet with label-only options (no Value — Dataverse auto-assigns)", () => {
    const body = buildAttributeBody("Picklist", false, { ...BASE_PARAMS, options: ["Red", "Green", "Blue"] }) as Record<string, any>;
    expect(body.OptionSet.IsGlobal).toBe(false);
    expect(body.OptionSet.Options).toHaveLength(3);
    for (const opt of body.OptionSet.Options) {
      expect(opt).not.toHaveProperty("Value");
      expect(opt.Label["@odata.type"]).toBe("Microsoft.Dynamics.CRM.Label");
    }
    expect(body.OptionSet.Options[0].Label.LocalizedLabels[0].Label).toBe("Red");
  });

  it("Picklist with no options given produces an empty Options array, not undefined/crash", () => {
    const body = buildAttributeBody("Picklist", false, BASE_PARAMS) as Record<string, any>;
    expect(body.OptionSet.Options).toEqual([]);
  });

  it("every type's DisplayName/Description are wrapped as a Microsoft.Dynamics.CRM.Label with LanguageCode 1033", () => {
    const body = buildAttributeBody("String", false, { ...BASE_PARAMS, displayName: "Hello" }) as Record<string, any>;
    expect(body.DisplayName["@odata.type"]).toBe("Microsoft.Dynamics.CRM.Label");
    expect(body.DisplayName.LocalizedLabels[0]).toEqual({
      "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel",
      Label: "Hello",
      LanguageCode: 1033,
    });
  });

  it("empty description falls back to the display name", () => {
    const body = buildAttributeBody("String", false, { ...BASE_PARAMS, displayName: "Hello", description: "" }) as Record<string, any>;
    expect(body.Description.LocalizedLabels[0].Label).toBe("Hello");
  });

  it("required=true sets RequiredLevel to ApplicationRequired, required=false to None", () => {
    const required = buildAttributeBody("String", false, { ...BASE_PARAMS, required: true }) as Record<string, any>;
    expect(required.RequiredLevel.Value).toBe("ApplicationRequired");
    const optional = buildAttributeBody("String", false, { ...BASE_PARAMS, required: false }) as Record<string, any>;
    expect(optional.RequiredLevel.Value).toBe("None");
  });

  it("MultiSelectPicklist's wire shape is the well-documented Dataverse quirk: AttributeType=Virtual, OptionSetType=Picklist — NOT their own type names", () => {
    // Regression guard for a real 500 confirmed against ZaneTest (2026-08-21 integration test:
    // "Requested value 'MultiSelectPicklist' was not found"), then confirmed correct against
    // Microsoft's own worked Web API example ("Create a multi-select choice column"). The only
    // place "MultiSelectPicklistType" actually appears on the wire is AttributeTypeName.Value —
    // that's the real discriminator, not AttributeType or OptionSetType.
    const body = buildAttributeBody("MultiSelectPicklist", false, { ...BASE_PARAMS, options: ["A", "B"] }) as Record<string, any>;
    expect(body.AttributeType).toBe("Virtual");
    expect(body.AttributeTypeName.Value).toBe("MultiSelectPicklistType");
    expect(body.OptionSet.OptionSetType).toBe("Picklist");
    expect(body.OptionSet.IsGlobal).toBe(false);
    expect(body.OptionSet.Options).toHaveLength(2);
    expect(body.OptionSet.Options[0]).not.toHaveProperty("Value");
  });

  it("BigInt needs no Format/MinValue/MaxValue — just the common fields", () => {
    const body = buildAttributeBody("BigInt", false, BASE_PARAMS) as Record<string, any>;
    expect(body.AttributeType).toBe("BigInt");
    expect(body).not.toHaveProperty("MinValue");
    expect(body).not.toHaveProperty("Format");
  });
});

describe("buildGlobalChoiceAttributeBody — Picklist column backed by an existing global choice", () => {
  it("binds GlobalOptionSet via @odata.bind and carries no inline Options array", () => {
    const body = buildGlobalChoiceAttributeBody("00aa00aa-bb11-cc22-dd33-44ee44ee44ee", BASE_PARAMS) as Record<string, any>;
    expect(body["GlobalOptionSet@odata.bind"]).toBe("/GlobalOptionSetDefinitions(00aa00aa-bb11-cc22-dd33-44ee44ee44ee)");
    expect(body["@odata.type"]).toBe("Microsoft.Dynamics.CRM.PicklistAttributeMetadata");
    expect(body).not.toHaveProperty("OptionSet");
  });
});

describe("buildGlobalOptionSetBody", () => {
  it("marks IsGlobal true and leaves every option's Value as null (system-assigned, per Microsoft's own recommendation)", () => {
    const body = buildGlobalOptionSetBody({ name: "ad_colors", displayName: "Colors", description: "", options: ["Red", "Green", "Blue"] }) as Record<string, any>;
    expect(body.IsGlobal).toBe(true);
    expect(body.Name).toBe("ad_colors");
    expect(body.Options).toHaveLength(3);
    for (const opt of body.Options) {
      expect(opt.Value).toBeNull();
    }
    expect(body.Options[0].Label.LocalizedLabels[0].Label).toBe("Red");
  });
});

describe("buildOneToManyRelationshipBody — Lookup field creation", () => {
  const LOOKUP_PARAMS = {
    schemaName: "ad_ParentThing",
    displayName: "Parent Thing",
    description: "",
    required: false,
    referencedEntity: "account",
    referencingEntity: "ad_childthing",
    referencedAttribute: "accountid",
    relationshipSchemaName: "ad_account_ad_childthing",
  };

  it("matches Microsoft's own worked Web API example field-for-field: relationship + nested Lookup in one deep-insert body", () => {
    const body = buildOneToManyRelationshipBody(LOOKUP_PARAMS) as Record<string, any>;
    expect(body["@odata.type"]).toBe("Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata");
    expect(body.SchemaName).toBe("ad_account_ad_childthing");
    expect(body.ReferencedEntity).toBe("account");
    expect(body.ReferencingEntity).toBe("ad_childthing");
    expect(body.ReferencedAttribute).toBe("accountid");
    expect(body.Lookup["@odata.type"]).toBe("Microsoft.Dynamics.CRM.LookupAttributeMetadata");
    expect(body.Lookup.AttributeType).toBe("Lookup");
    expect(body.Lookup.SchemaName).toBe("ad_ParentThing");
  });

  it("uses the safe cascade default (RemoveLink on delete, NoCascade everywhere else) — never Cascade, which would delete children with the parent", () => {
    const body = buildOneToManyRelationshipBody(LOOKUP_PARAMS) as Record<string, any>;
    expect(body.CascadeConfiguration).toEqual({
      Assign: "NoCascade",
      Delete: "RemoveLink",
      Merge: "NoCascade",
      Reparent: "NoCascade",
      Share: "NoCascade",
      Unshare: "NoCascade",
    });
  });

  it("the whole body is JSON-serializable (no undefined leaking into the deep-insert payload)", () => {
    const body = buildOneToManyRelationshipBody(LOOKUP_PARAMS);
    expect(() => JSON.stringify(body)).not.toThrow();
  });
});

describe("buildPublishXmlForEntities — per-solution targeted publish", () => {
  it("lists every given entity inside <importexportxml><entities>", () => {
    const xml = buildPublishXmlForEntities(["account", "ad_childthing"]);
    expect(xml).toBe("<importexportxml><entities><entity>account</entity><entity>ad_childthing</entity></entities></importexportxml>");
  });

  it("produces a valid (if empty) element for zero entities rather than malformed XML", () => {
    const xml = buildPublishXmlForEntities([]);
    expect(xml).toBe("<importexportxml><entities></entities></importexportxml>");
  });
});
