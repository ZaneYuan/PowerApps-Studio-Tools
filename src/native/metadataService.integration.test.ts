// @vitest-environment jsdom
//
// Real-Dataverse check for the bulk metadata reads buildEditableGridColumns uses instead of one
// request per column — see fetchEntityOptionSets' own comment for why (a wide `SELECT *` on a
// product-class entity was doing dozens of sequential per-attribute requests).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hasTestCredentials } from "../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../testSupport/mockNativeBridge";
import { fetchEntityDateTimeFormats, fetchEntityOptionSets } from "./metadataService";

describe.skipIf(!hasTestCredentials())("bulk entity metadata", () => {
  beforeAll(() => installMockNativeBridge());
  afterAll(() => uninstallMockNativeBridge());

  it("fetchEntityOptionSets returns every OptionSet attribute's options in one map (systemuser has a few)", async () => {
    const byAttr = await fetchEntityOptionSets("x", "systemuser");
    // statecode / accessmode etc. — at least one, keyed lowercase, with real labels.
    expect(byAttr.size).toBeGreaterThan(0);
    for (const [name, options] of byAttr) {
      expect(name).toBe(name.toLowerCase());
      expect(options.every((o) => typeof o.value === "number" && typeof o.label === "string")).toBe(true);
    }
  }, 60_000);

  it("fetchEntityDateTimeFormats maps every DateTime attribute to DateOnly / DateAndTime", async () => {
    const byAttr = await fetchEntityDateTimeFormats("x", "systemuser");
    expect(byAttr.get("createdon")).toBe("DateAndTime");
    for (const fmt of byAttr.values()) expect(["DateOnly", "DateAndTime"]).toContain(fmt);
  }, 60_000);
});
