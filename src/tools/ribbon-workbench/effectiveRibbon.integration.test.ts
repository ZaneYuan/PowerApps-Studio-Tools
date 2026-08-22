// @vitest-environment jsdom
//
// Real-Dataverse integration test for the previously entirely-unverified RetrieveEntityRibbon +
// JSZip decompression chain (see 03-Roadmap-待办.md's Ribbon Workbench section — this was flagged
// "还没有对真实 Dataverse 环境跑过" as recently as 2026-08-21, before this test existed). Targets
// the standard `account` table, which every real Dataverse org has real ribbon customizations for
// (system tabs/groups/buttons at minimum), so a correct parse should never come back empty.
import { describe, expect, it } from "vitest";
import { hasTestCredentials } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { fetchEffectiveRibbonCompressed } from "./dataverseOps";
import { decompressRibbonXml, parseRibbonTree } from "./effectiveRibbon";

describe.skipIf(!hasTestCredentials())("Ribbon Workbench — RetrieveEntityRibbon + JSZip (real ZaneTest)", () => {
  it("fetches, decompresses, and parses account's real effective ribbon into a non-empty Tab tree", async () => {
    installMockNativeBridge();
    try {
      const compressed = await fetchEffectiveRibbonCompressed("integration-test", "account");
      expect(compressed.length, "CompressedEntityXml should be a non-trivial base64 payload").toBeGreaterThan(100);

      const xml = await decompressRibbonXml(compressed);
      expect(xml, "the decompressed part should actually be XML, not something else JSZip happened to unzip").toContain("<");
      expect(xml.toLowerCase()).toContain("tab");

      const tabs = parseRibbonTree(xml);
      expect(tabs.length, "account's real ribbon should have at least one Tab (Form/HomepageGrid/SubGrid all contribute tabs)").toBeGreaterThan(0);

      // At least one tab should carry at least one real button somewhere in its group tree —
      // proves the Group/Controls walk isn't just finding empty shells.
      const anyControlsFound = tabs.some((t) => t.groups.some((g) => g.controls.length > 0));
      expect(anyControlsFound, "expected at least one real button/control somewhere in account's ribbon tree").toBe(true);
    } finally {
      uninstallMockNativeBridge();
    }
  }, 60_000);
});
