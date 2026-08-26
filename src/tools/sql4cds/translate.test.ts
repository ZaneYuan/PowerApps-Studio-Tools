import { describe, expect, it } from "vitest";
import { buildSelectPath, guessEditingTable, literalToJsValue, parseSql, previewSql } from "./translate";

describe("parseSql — simple SELECT", () => {
  it("translates a basic filter/orderby/top", () => {
    const r = parseSql("SELECT name, statuscode FROM contact WHERE firstname = 'Zane' ORDER BY name DESC");
    if (r.kind !== "select-simple") throw new Error(`expected select-simple, got ${r.kind}`);
    expect(r.entityLogicalName).toBe("contact");
    expect(r.entitySetGuess).toBe("contacts");
    expect(r.select).toBe("name,statuscode");
    expect(r.filter).toBe("firstname eq 'Zane'");
    expect(r.orderby).toBe("name desc");
  });

  it("SELECT * yields a null $select (not an explicit column list)", () => {
    const r = parseSql("SELECT * FROM account");
    if (r.kind !== "select-simple") throw new Error(`expected select-simple, got ${r.kind}`);
    expect(r.select).toBeNull();
  });

  it("preserves the _..._value OData wrapper in $select/$orderby as written, does not strip it", () => {
    // Confirmed against a live org (2026-08-22 integration test run): Dataverse's Web API
    // rejects a Lookup column's *bare* name in both $select and $orderby outright ("Could not
    // find a property named ...") — only the `_x_value` shadow-property form works there. An
    // earlier version of this code stripped the wrapper unconditionally on the (wrong) theory
    // that the wrapped form was never valid in $select, which broke every SELECT/ORDER BY —
    // including inside an IN (SELECT ...) subquery — that named a Lookup column correctly.
    const r = parseSql("SELECT _bupa_language_value FROM bupa_translation ORDER BY _bupa_language_value");
    if (r.kind !== "select-simple") throw new Error(`expected select-simple, got ${r.kind}`);
    expect(r.select).toBe("_bupa_language_value");
    expect(r.orderby).toBe("_bupa_language_value");
  });

  it("adds the _..._value wrapper to a $filter comparison only when the literal looks like a GUID", () => {
    const guid = "d345ae8e-c722-f011-8c4d-00224819e439";
    const r1 = parseSql(`SELECT name FROM contact WHERE parentcustomerid = '${guid}'`);
    if (r1.kind !== "select-simple") throw new Error("expected select-simple");
    expect(r1.filter).toBe(`_parentcustomerid_value eq ${guid}`);

    const r2 = parseSql(`SELECT name FROM contact WHERE firstname = 'Zane'`);
    if (r2.kind !== "select-simple") throw new Error("expected select-simple");
    expect(r2.filter).toBe(`firstname eq 'Zane'`);
  });

  it("does not double-wrap a field the user already wrote wrapped", () => {
    const guid = "d345ae8e-c722-f011-8c4d-00224819e439";
    const r = parseSql(`SELECT name FROM contact WHERE _parentcustomerid_value = '${guid}'`);
    if (r.kind !== "select-simple") throw new Error("expected select-simple");
    expect(r.filter).toBe(`_parentcustomerid_value eq ${guid}`);
  });

  it("rejects a query with no WHERE-less UPDATE/DELETE guard bypass, but allows SELECT with no WHERE", () => {
    const r = parseSql("SELECT name FROM account");
    expect(r.kind).toBe("select-simple");
  });

  it("LIKE with leading+trailing % becomes contains()", () => {
    const r = parseSql("SELECT name FROM account WHERE name LIKE '%acme%'");
    if (r.kind !== "select-simple") throw new Error("expected select-simple");
    expect(r.filter).toBe("contains(name,'acme')");
  });

  it("LIKE with only a trailing % becomes startswith()", () => {
    const r = parseSql("SELECT name FROM account WHERE name LIKE 'acme%'");
    if (r.kind !== "select-simple") throw new Error("expected select-simple");
    expect(r.filter).toBe("startswith(name,'acme')");
  });

  it("IN uses Microsoft.Dynamics.CRM.In with the bare field name, even for GUID-like values on a Lookup column", () => {
    // Unlike an ordinary $filter comparison, Microsoft.Dynamics.CRM.In/NotIn's PropertyName always
    // wants the bare attribute logical name — confirmed against a live org (Bugs/8.25.md #2): a
    // genuine non-primary-key Lookup column (bupa_productid) IN (...) 400'd once wrapped to
    // '_bupa_productid_value' ("entity doesn't contain attribute with Name = ...").
    const g1 = "d345ae8e-c722-f011-8c4d-00224819e439";
    const g2 = "5c8ccfc1-462a-f011-9a43-002248ed6f8a";
    const r = parseSql(`SELECT name FROM contact WHERE parentcustomerid IN ('${g1}', '${g2}')`);
    if (r.kind !== "select-simple") throw new Error("expected select-simple");
    expect(r.filter).toBe(`Microsoft.Dynamics.CRM.In(PropertyName='parentcustomerid',PropertyValues=['${g1}','${g2}'])`);
  });

  it("IN strips an explicit _..._value wrapper down to the bare name too", () => {
    const g1 = "d345ae8e-c722-f011-8c4d-00224819e439";
    const r = parseSql(`SELECT name FROM contact WHERE _parentcustomerid_value IN ('${g1}')`);
    if (r.kind !== "select-simple") throw new Error("expected select-simple");
    expect(r.filter).toBe(`Microsoft.Dynamics.CRM.In(PropertyName='parentcustomerid',PropertyValues=['${g1}'])`);
  });

  it("rejects multi-table queries (no table-alias support yet)", () => {
    const r = parseSql("SELECT a.name FROM account a WHERE a.name = 'x'");
    expect(r.kind).toBe("error");
  });
});

describe("parseSql — JOIN / GROUP BY (complex select -> FetchXML)", () => {
  it("LEFT OUTER JOIN is accepted regardless of case (was previously rejected due to case mismatch)", () => {
    const sql = "select p.name from product p LEFT outer JOIN uom u on p.uomid = u.uomid";
    const r = parseSql(sql);
    expect(r.kind).toBe("select-complex");
  });

  it("LEFT JOIN (short form) is accepted", () => {
    const r = parseSql("select p.name from product p LEFT JOIN uom u on p.uomid = u.uomid");
    expect(r.kind).toBe("select-complex");
  });

  it("plain JOIN / INNER JOIN both produce a link-entity with no link-type attribute (inner is FetchXML's implicit default)", () => {
    const r = parseSql("select p.name from product p JOIN uom u on p.uomid = u.uomid");
    if (r.kind !== "select-complex") throw new Error("expected select-complex");
    expect(r.fetchXml).not.toContain("link-type");
    expect(r.fetchXml).toContain('<link-entity name="uom" from="uomid" to="uomid" alias="u" />');
  });

  it("LEFT JOIN explicitly emits link-type=\"outer\"", () => {
    const r = parseSql("select p.name from product p LEFT JOIN uom u on p.uomid = u.uomid");
    if (r.kind !== "select-complex") throw new Error("expected select-complex");
    expect(r.fetchXml).toContain('link-type="outer"');
  });

  it("RIGHT JOIN is rejected outright with a rewrite hint, before the parser can silently mis-parse it", () => {
    const r = parseSql("select p.name from product p RIGHT JOIN uom u on p.uomid = u.uomid");
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.error).toContain("RIGHT");
  });

  it("RIGHT OUTER JOIN is also rejected", () => {
    const r = parseSql("select p.name from product p RIGHT OUTER JOIN uom u on p.uomid = u.uomid");
    expect(r.kind).toBe("error");
  });

  it("FULL [OUTER] JOIN is rejected — FetchXML has no equivalent", () => {
    const r = parseSql("select p.name from product p FULL JOIN uom u on p.uomid = u.uomid");
    expect(r.kind).toBe("error");
  });

  it("IN (SELECT ...) subquery not yet resolved gives a specific, actionable error — not the old generic crash", () => {
    const sql = "select name from product where productid in (select productid from uomschedule)";
    const r = parseSql(sql);
    // Regression guard for the 2026-08-18/19 bug: parseSql used to throw the generic
    // "不支持的字面量类型: undefined" here. It's still expected to error on a *simple* select
    // (resolveSqlSubqueries must run first, before execution) — but the message must name the
    // real cause, not the old undefined-literal-type crash text.
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.error).not.toContain("不支持的字面量类型: undefined");
      expect(r.error).toContain("resolveSqlSubqueries");
    }
  });
});

describe("previewSql — live/as-you-type preview placeholder", () => {
  it("replaces an IN (SELECT ...) subquery with a distinctive placeholder, not a real value", () => {
    const sql = "select name from product where productid in (select productid from uomschedule)";
    const preview = previewSql(sql);
    expect(preview).toContain("子查询");
    expect(preview).not.toContain("select productid from uomschedule");
  });

  it("leaves SQL with no subquery untouched", () => {
    const sql = "select name from product where productid = 1";
    expect(previewSql(sql)).toBe(sql);
  });
});

describe("literalToJsValue", () => {
  it("converts an integer literal to a real JS number", () => {
    const r = parseSql("INSERT INTO account (numberoffield) VALUES (5)");
    if (r.kind !== "insert") throw new Error("expected insert");
    expect(literalToJsValue(r.rows[0][0])).toBe(5);
  });

  it("converts a decimal literal (parses as a string in node-sql-parser) to a real JS number, not a string", () => {
    const r = parseSql("INSERT INTO account (amount) VALUES (12699.00)");
    if (r.kind !== "insert") throw new Error("expected insert");
    const v = literalToJsValue(r.rows[0][0]);
    expect(v).toBe(12699);
    expect(typeof v).toBe("number");
  });

  it("unescapes a doubled single-quote exactly once", () => {
    const r = parseSql("INSERT INTO account (name) VALUES (N'O''Brien')");
    if (r.kind !== "insert") throw new Error("expected insert");
    expect(literalToJsValue(r.rows[0][0])).toBe("O'Brien");
  });

  it("converts NULL to null", () => {
    const r = parseSql("INSERT INTO account (name) VALUES (NULL)");
    if (r.kind !== "insert") throw new Error("expected insert");
    expect(literalToJsValue(r.rows[0][0])).toBeNull();
  });
});

describe("UPDATE / DELETE require WHERE", () => {
  it("UPDATE without WHERE is rejected", () => {
    const r = parseSql("UPDATE account SET name = 'x'");
    expect(r.kind).toBe("error");
  });

  it("DELETE without WHERE is rejected", () => {
    const r = parseSql("DELETE FROM account");
    expect(r.kind).toBe("error");
  });

  it("UPDATE with WHERE parses to a mutate result", () => {
    const r = parseSql("UPDATE account SET name = 'x' WHERE accountid = 1");
    expect(r.kind).toBe("mutate");
  });
});

describe("batch (multiple ;-separated statements)", () => {
  it("a batch of INSERT/UPDATE/DELETE parses to kind=batch", () => {
    const r = parseSql("INSERT INTO account (name) VALUES ('a'); UPDATE account SET name='b' WHERE accountid=1;");
    expect(r.kind).toBe("batch");
  });

  it("a batch containing a SELECT is rejected (no single result shape for read+write mix)", () => {
    const r = parseSql("SELECT name FROM account; UPDATE account SET name='b' WHERE accountid=1;");
    expect(r.kind).toBe("error");
  });

  it("`delete x` (no FROM) does not crash on an undefined stmt.type — reports a friendly error instead", () => {
    // Regression test for the whitespace-triggered white-screen bug from 2026-08-15/8.17 bugs:
    // T-SQL parses "delete x" as a variable-assignment statement with no top-level `.type`.
    const r = parseSql("delete x");
    expect(r.kind).toBe("error");
  });
});

describe("buildSelectPath", () => {
  it("builds a plain $select/$filter/$orderby/$top query string", () => {
    const path = buildSelectPath(
      { kind: "select-simple", entityLogicalName: "account", entitySetGuess: "accounts", select: "name", filter: "name eq 'x'", orderby: "name", top: "10", warnings: [] },
      "accounts",
    );
    expect(path).toBe("accounts?$select=name&$filter=name eq 'x'&$orderby=name&$top=10");
  });

  it("builds a bare entity-set path when nothing else is set", () => {
    const path = buildSelectPath(
      { kind: "select-simple", entityLogicalName: "account", entitySetGuess: "accounts", select: null, filter: null, orderby: null, top: null, warnings: [] },
      "accounts",
    );
    expect(path).toBe("accounts");
  });

  it("builds a fetchXml= path for a complex select", () => {
    const path = buildSelectPath({ kind: "select-complex", entityLogicalName: "account", entitySetGuess: "accounts", fetchXml: "<fetch/>", warnings: [] }, "accounts");
    expect(path).toBe("accounts?fetchXml=%3Cfetch%2F%3E");
  });
});

describe("guessEditingTable", () => {
  it("returns the table name even while a WHERE clause is mid-typed", () => {
    // This is the exact scenario documented in the guessEditingTable doc comment: a bare column
    // reference with no operator yet makes parseSql's translateWhere throw, but the editor still
    // needs a table name for autocomplete.
    expect(guessEditingTable("SELECT * FROM contoso_quote WHERE contoso_")).toBe("contoso_quote");
  });

  it("returns null for empty input", () => {
    expect(guessEditingTable("")).toBeNull();
  });

  it("resolves the table for INSERT/UPDATE/DELETE too", () => {
    expect(guessEditingTable("INSERT INTO account (name) VALUES ('x')")).toBe("account");
    expect(guessEditingTable("UPDATE account SET name = 'x'")).toBe("account");
    expect(guessEditingTable("DELETE FROM account")).toBe("account");
  });
});
