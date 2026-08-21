// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findEntityElement, readRibbonDiffXml, writeRibbonDiffXml } from "./ribbonXml";
import JSZip from "jszip";

/** A minimal but structurally realistic customizations.xml, matching the shape Microsoft's own
 *  solution export produces: <ImportExportXml><Entities><Entity><Name>...</Name>...</Entity>.
 *  This is the exact structure the Roadmap doc flagged as "assumed, never verified against a real
 *  export" — findEntityElement/resolveKey's <name> child lookup is what's under test here. */
function buildCustomizationsXml(entities: { name: string; ribbonDiffXml?: string }[]): string {
  const entityBlocks = entities
    .map(
      (e) => `<Entity>
        <Name>${e.name}</Name>
        <ObjectTypeCode>1</ObjectTypeCode>
        ${e.ribbonDiffXml ?? ""}
      </Entity>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<ImportExportXml version="9.2" SolutionPackageVersion="9.2" languagecode="1033" generatedBy="CrmLive">
  <Entities>
    ${entityBlocks}
  </Entities>
  <Roles />
  <Workflows />
</ImportExportXml>`;
}

async function buildZip(customizationsXml: string): Promise<string> {
  const zip = new JSZip();
  zip.file("customizations.xml", customizationsXml);
  zip.file("[Content_Types].xml", "<Types />"); // realistic noise, shouldn't matter
  return zip.generateAsync({ type: "base64" });
}

describe("findEntityElement", () => {
  it("finds the <Entity> whose <Name> matches the logical name (case-insensitive)", async () => {
    const xml = buildCustomizationsXml([{ name: "account" }, { name: "contoso_quote" }]);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const el = findEntityElement(doc, "CONTOSO_QUOTE");
    expect(el).toBeDefined();
    expect(el?.querySelector("Name")?.textContent).toBe("contoso_quote");
  });

  it("returns undefined for an entity not present in the export", async () => {
    const xml = buildCustomizationsXml([{ name: "account" }]);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(findEntityElement(doc, "contact")).toBeUndefined();
  });
});

describe("readRibbonDiffXml", () => {
  it("returns the existing RibbonDiffXml verbatim when the entity already has one", async () => {
    const customRibbon = "<RibbonDiffXml><CustomActions><CustomAction Id=\"x\"/></CustomActions><Templates /><CommandDefinitions /><RuleDefinitions /><LocLabels /></RibbonDiffXml>";
    const xml = buildCustomizationsXml([{ name: "account", ribbonDiffXml: customRibbon }]);
    const zipBase64 = await buildZip(xml);
    const result = await readRibbonDiffXml(zipBase64, "account");
    expect(result).toContain('CustomAction Id="x"');
  });

  it("returns the empty skeleton (not an error) when the table has never been ribbon-customized", async () => {
    // This is the exact v1 assumption flagged as unverified: does an Entity component with no
    // RibbonDiffXml child export cleanly, or does it throw? Confirmed here: it degrades to the
    // documented empty skeleton.
    const xml = buildCustomizationsXml([{ name: "account" }]);
    const zipBase64 = await buildZip(xml);
    const result = await readRibbonDiffXml(zipBase64, "account");
    expect(result).toBe("<RibbonDiffXml><CustomActions /><Templates /><CommandDefinitions /><RuleDefinitions /><LocLabels /></RibbonDiffXml>");
  });

  it("throws a specific, actionable error when the table isn't in the exported solution at all", async () => {
    const xml = buildCustomizationsXml([{ name: "account" }]);
    const zipBase64 = await buildZip(xml);
    await expect(readRibbonDiffXml(zipBase64, "contact")).rejects.toThrow(/contact/);
  });
});

describe("writeRibbonDiffXml — full round trip", () => {
  it("replaces an existing RibbonDiffXml and the change survives a re-read", async () => {
    const oldRibbon = "<RibbonDiffXml><CustomActions /><Templates /><CommandDefinitions /><RuleDefinitions /><LocLabels /></RibbonDiffXml>";
    const xml = buildCustomizationsXml([{ name: "account", ribbonDiffXml: oldRibbon }]);
    const zipBase64 = await buildZip(xml);

    const newRibbon = '<RibbonDiffXml><CustomActions><CustomAction Id="new.button"/></CustomActions><Templates /><CommandDefinitions /><RuleDefinitions /><LocLabels /></RibbonDiffXml>';
    const updatedZipBase64 = await writeRibbonDiffXml(zipBase64, "account", newRibbon);

    const readBack = await readRibbonDiffXml(updatedZipBase64, "account");
    expect(readBack).toContain('CustomAction Id="new.button"');
  });

  it("appends a RibbonDiffXml to an entity that never had one (skeleton case)", async () => {
    const xml = buildCustomizationsXml([{ name: "account" }]);
    const zipBase64 = await buildZip(xml);

    const newRibbon = '<RibbonDiffXml><CustomActions><CustomAction Id="first.button"/></CustomActions><Templates /><CommandDefinitions /><RuleDefinitions /><LocLabels /></RibbonDiffXml>';
    const updatedZipBase64 = await writeRibbonDiffXml(zipBase64, "account", newRibbon);

    const readBack = await readRibbonDiffXml(updatedZipBase64, "account");
    expect(readBack).toContain('CustomAction Id="first.button"');
  });

  it("does not disturb other entities in the same solution export", async () => {
    const ribbonA = "<RibbonDiffXml><CustomActions><CustomAction Id=\"a\"/></CustomActions><Templates /><CommandDefinitions /><RuleDefinitions /><LocLabels /></RibbonDiffXml>";
    const xml = buildCustomizationsXml([
      { name: "account", ribbonDiffXml: ribbonA },
      { name: "contact" },
    ]);
    const zipBase64 = await buildZip(xml);

    const newRibbon = '<RibbonDiffXml><CustomActions><CustomAction Id="b"/></CustomActions><Templates /><CommandDefinitions /><RuleDefinitions /><LocLabels /></RibbonDiffXml>';
    const updatedZipBase64 = await writeRibbonDiffXml(zipBase64, "contact", newRibbon);

    const accountRibbon = await readRibbonDiffXml(updatedZipBase64, "account");
    expect(accountRibbon).toContain('CustomAction Id="a"');
    const contactRibbon = await readRibbonDiffXml(updatedZipBase64, "contact");
    expect(contactRibbon).toContain('CustomAction Id="b"');
  });

  it("rejects a replacement whose root element isn't <RibbonDiffXml>", async () => {
    const xml = buildCustomizationsXml([{ name: "account" }]);
    const zipBase64 = await buildZip(xml);
    await expect(writeRibbonDiffXml(zipBase64, "account", "<NotARibbon />")).rejects.toThrow(/RibbonDiffXml/);
  });

  it("rejects malformed replacement XML outright, before touching the zip", async () => {
    const xml = buildCustomizationsXml([{ name: "account" }]);
    const zipBase64 = await buildZip(xml);
    await expect(writeRibbonDiffXml(zipBase64, "account", "<RibbonDiffXml><Unclosed>")).rejects.toThrow();
  });
});
