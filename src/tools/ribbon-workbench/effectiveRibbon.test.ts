// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { decompressRibbonXml, parseRibbonTree } from "./effectiveRibbon";

describe("decompressRibbonXml", () => {
  it("reads the RibbonXml.xml part out of a ZipPackage-shaped archive", async () => {
    const zip = new JSZip();
    zip.file("RibbonXml.xml", "<RibbonDefinitions><Tabs /></RibbonDefinitions>");
    const base64 = await zip.generateAsync({ type: "base64" });
    const xml = await decompressRibbonXml(base64);
    expect(xml).toContain("<RibbonDefinitions>");
  });

  it("throws a specific error when the archive has no RibbonXml.xml part (unexpected format, not silently empty)", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types />");
    const base64 = await zip.generateAsync({ type: "base64" });
    await expect(decompressRibbonXml(base64)).rejects.toThrow(/RibbonXml\.xml/);
  });
});

const SAMPLE_RIBBON_XML = `<RibbonDefinitions>
  <Tabs>
    <Tab Id="Mscrm.Form.account.MainTab" LabelText="account_tab">
      <Groups>
        <Group Id="Mscrm.Form.account.MainTab.Save" LabelText="Save Group">
          <Controls>
            <Button Id="Mscrm.Form.account.SaveAndClose" Command="Mscrm.SaveAndCloseFormCommand" LabelText="Save &amp; Close" />
            <SplitButton Id="Mscrm.Form.account.SaveOptions" Command="Mscrm.SaveOptionsCommand" LabelText="Save Options" />
          </Controls>
        </Group>
        <Group Id="Mscrm.Form.account.MainTab.Actions" LabelText="Actions Group">
          <Controls>
            <Button Id="Mscrm.Form.account.Actions.Assign" Command="Mscrm.AssignCommand" LabelText="Assign" />
          </Controls>
        </Group>
      </Groups>
    </Tab>
    <Tab Id="Mscrm.Form.account.RelatedTab" LabelText="Related">
      <Groups>
        <Group Id="Mscrm.Form.account.RelatedTab.Empty" LabelText="Empty Group">
          <Controls />
        </Group>
      </Groups>
    </Tab>
  </Tabs>
</RibbonDefinitions>`;

describe("parseRibbonTree", () => {
  it("builds a Tab -> Group -> Control tree from a realistic RibbonXml.xml document", () => {
    const tabs = parseRibbonTree(SAMPLE_RIBBON_XML);
    expect(tabs).toHaveLength(2);

    const mainTab = tabs[0];
    expect(mainTab.id).toBe("Mscrm.Form.account.MainTab");
    expect(mainTab.labelText).toBe("account_tab");
    expect(mainTab.groups).toHaveLength(2);

    const saveGroup = mainTab.groups[0];
    expect(saveGroup.id).toBe("Mscrm.Form.account.MainTab.Save");
    expect(saveGroup.controls).toHaveLength(2);
    expect(saveGroup.controls[0]).toEqual({
      tag: "Button",
      id: "Mscrm.Form.account.SaveAndClose",
      command: "Mscrm.SaveAndCloseFormCommand",
      labelText: "Save & Close",
    });
    expect(saveGroup.controls[1].tag).toBe("SplitButton");
  });

  it("a group with no controls yields an empty controls array, not a crash", () => {
    const tabs = parseRibbonTree(SAMPLE_RIBBON_XML);
    const emptyGroup = tabs[1].groups[0];
    expect(emptyGroup.controls).toEqual([]);
  });

  it("returns an empty array (not an error) for a ribbon fragment with no Tab elements at all", () => {
    expect(parseRibbonTree("<RibbonDefinitions><Tabs /></RibbonDefinitions>")).toEqual([]);
  });

  it("throws for genuinely malformed XML", () => {
    expect(() => parseRibbonTree("<Tabs><Tab></Tabs>")).toThrow(/合法的 XML/);
  });
});
