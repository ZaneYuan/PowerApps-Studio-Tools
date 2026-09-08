// @vitest-environment jsdom
//
// Real-Dataverse check that runPagedQuery's request shape (both the OData `@odata.nextLink` and
// the FetchXML paging-cookie continuation) is actually accepted by the Web API and returns
// contiguous, non-overlapping rows. The ZaneTest org is small so this can't force a >5000-row
// multi-page run — that half was verified by hand against a large org — but it does confirm the
// paths round-trip and that `maxRows` truncation reports correctly.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hasTestCredentials } from "../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../testSupport/mockNativeBridge";
import { runPagedQuery } from "./dataverseQuery";

describe.skipIf(!hasTestCredentials())("runPagedQuery — real Dataverse", () => {
  beforeAll(() => installMockNativeBridge());
  afterAll(() => uninstallMockNativeBridge());

  it("OData path returns rows and stops at maxRows, flagging truncated when more exist", async () => {
    const two = await runPagedQuery("x", "systemusers?$select=fullname", { maxRows: 2 });
    expect(two.value.length).toBeLessThanOrEqual(2);

    const all = await runPagedQuery("x", "systemusers?$select=fullname", { maxRows: 0 });
    // If the org has >2 users, the capped run should have been marked truncated.
    if (all.value.length > 2) expect(two.truncated).toBe(true);
  }, 60_000);

  it("FetchXML path round-trips and de-dupes across pages", async () => {
    const fx = '<fetch><entity name="systemuser"><attribute name="systemuserid"/><order attribute="systemuserid"/></entity></fetch>';
    const res = await runPagedQuery("x", `systemusers?fetchXml=${encodeURIComponent(fx)}`, { maxRows: 0 });
    const ids = res.value.map((r) => r.systemuserid);
    expect(new Set(ids).size).toBe(ids.length);
  }, 120_000);
});
