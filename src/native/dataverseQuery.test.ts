import { describe, expect, it, vi, beforeEach } from "vitest";

const callNative = vi.fn();
vi.mock("./bridge", () => ({
  callNative: (...args: unknown[]) => callNative(...args),
  QUERY_TIMEOUT_MS: 60_000,
}));

const { nextFetchXmlPath, runPagedQuery } = await import("./dataverseQuery");

describe("nextFetchXmlPath", () => {
  // A real paging-cookie annotation from a live org — double-URL-encoded inside pagingcookie="…".
  const annotation =
    '<cookie pagenumber="2" pagingcookie="%253ccookie%2520page%253d%25221%2522%253e%253cid%2520last%253d%2522%257bAAA%257d%2522%2520first%253d%2522%257bBBB%257d%2522%2520%252f%253e%253c%252fcookie%253e" istracking="False" />';

  it("splices page + a double-decoded, XML-escaped paging-cookie into <fetch>", () => {
    const initial = "accounts?fetchXml=" + encodeURIComponent("<fetch><entity name=\"account\"><attribute name=\"accountid\"/></entity></fetch>");
    const next = decodeURIComponent(nextFetchXmlPath(initial, annotation, 2).replace(/^accounts\?fetchXml=/, ""));
    expect(next).toContain('page="2"');
    // cookie decoded twice → <cookie page="1">…</cookie>, then XML-attr-escaped
    expect(next).toContain('paging-cookie="&lt;cookie page=&quot;1&quot;&gt;');
    expect(next).toContain("&lt;/cookie&gt;");
    expect(next).toContain('<entity name="account">');
  });

  it("replaces an existing page / paging-cookie rather than stacking them", () => {
    const initial =
      "accounts?fetchXml=" +
      encodeURIComponent('<fetch page="1" paging-cookie="old"><entity name="account"><attribute name="accountid"/></entity></fetch>');
    const next = decodeURIComponent(nextFetchXmlPath(initial, annotation, 3).replace(/^accounts\?fetchXml=/, ""));
    expect(next).toContain('<fetch page="3"');
    expect(next).not.toContain('paging-cookie="old"');
    // exactly one real `page="` attribute on <fetch> (the escaped cookie has `page=&quot;`, not `page="`)
    expect((next.match(/\bpage="/g) ?? []).length).toBe(1);
  });
});

describe("runPagedQuery", () => {
  beforeEach(() => callNative.mockReset());

  it("OData: follows @odata.nextLink, concatenates pages, reports pages fetched", async () => {
    callNative
      .mockResolvedValueOnce({
        value: [{ id: 1 }, { id: 2 }],
        "@odata.nextLink": "https://org.crm5.dynamics.com/api/data/v9.2/accounts?$skiptoken=abc",
      })
      .mockResolvedValueOnce({ value: [{ id: 3 }] });

    const res = await runPagedQuery("conn", "accounts?$select=name", { maxRows: 100 });
    expect(res.value).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(res.truncated).toBe(false);
    expect(res.pages).toBe(2);
    // page 2 was requested with the nextLink stripped to a relative path
    expect(callNative.mock.calls[1][1].path).toBe("accounts?$skiptoken=abc");
  });

  it("OData: stops at maxRows and flags truncated when there's still a nextLink", async () => {
    callNative.mockResolvedValue({
      value: [{ id: 1 }, { id: 2 }, { id: 3 }],
      "@odata.nextLink": "https://x/api/data/v9.2/accounts?$skiptoken=more",
    });
    const res = await runPagedQuery("conn", "accounts", { maxRows: 2 });
    expect(res.value).toHaveLength(2);
    expect(res.truncated).toBe(true);
    expect(callNative).toHaveBeenCalledTimes(1);
  });

  it("FetchXML: follows the paging cookie until morerecords is false", async () => {
    const cookie = '<cookie pagenumber="2" pagingcookie="%253ccookie%2520%252f%253e" istracking="False" />';
    callNative
      .mockResolvedValueOnce({
        value: [{ id: 1 }],
        "@Microsoft.Dynamics.CRM.morerecords": true,
        "@Microsoft.Dynamics.CRM.fetchxmlpagingcookie": cookie,
      })
      .mockResolvedValueOnce({ value: [{ id: 2 }], "@Microsoft.Dynamics.CRM.morerecords": false });

    const res = await runPagedQuery(
      "conn",
      "accounts?fetchXml=" + encodeURIComponent("<fetch><entity name=\"account\"/></fetch>"),
      { maxRows: 0 },
    );
    expect(res.value).toEqual([{ id: 1 }, { id: 2 }]);
    expect(res.truncated).toBe(false);
    expect(decodeURIComponent(callNative.mock.calls[1][1].path)).toContain('<fetch page="2"');
  });

  it("calls onProgress with the running total after each page", async () => {
    callNative
      .mockResolvedValueOnce({ value: [{}, {}], "@odata.nextLink": "https://x/api/data/v9.2/accounts?$skiptoken=t" })
      .mockResolvedValueOnce({ value: [{}] });
    const seen: number[] = [];
    await runPagedQuery("conn", "accounts", { maxRows: 0, onProgress: (n) => seen.push(n) });
    expect(seen).toEqual([2, 3]);
  });

  it("passes the abort signal and the long query timeout through to callNative", async () => {
    callNative.mockResolvedValue({ value: [] });
    const ac = new AbortController();
    await runPagedQuery("conn", "accounts", { maxRows: 100, signal: ac.signal });
    expect(callNative.mock.calls[0][2]).toEqual({ timeoutMs: 60_000, signal: ac.signal });
  });
});
