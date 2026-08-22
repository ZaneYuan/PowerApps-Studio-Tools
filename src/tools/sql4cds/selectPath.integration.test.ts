// @vitest-environment jsdom
//
// Real-Dataverse integration tests for SQL4CDS's SELECT path — simple single-table SELECT (→
// OData), JOIN/GROUP BY/aggregates (→ FetchXML), and IN (SELECT ...) subqueries. This is the one
// major SQL4CDS surface that had zero real-API coverage before this file: translate.test.ts
// already unit-tests that the generated FetchXML/OData *text* matches expectations, but never
// confirmed Dataverse actually accepts and executes it correctly. Every scenario here runs the
// real generated query against a throwaway two-table schema with fully controlled data, so
// results can be asserted exactly rather than just "didn't throw".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, testRunSuffix } from "../../testSupport/dataverseTestClient";
import { installMockNativeBridge, uninstallMockNativeBridge } from "../../testSupport/mockNativeBridge";
import { fetchEntityMeta } from "../../native/metadataService";
import { createColumn, createLookupColumn, createTable } from "../solution-editor/dataverseOps";
import { insertRow } from "./writeOps";
import { buildSelectPath, parseSql, resolveSqlSubqueries } from "./translate";

const FAKE_CONNECTION_ID = "integration-test";
const SOLUTION_UNIQUE_NAME = "ad_ClaudeSmokeTest";
const PUBLISHER_PREFIX = "ad";

interface SelectSimple {
  kind: "select-simple";
  select: string | null;
  filter: string | null;
  orderby: string | null;
  top: string | null;
  warnings: string[];
}

async function runSelect(entitySetName: string, sql: string): Promise<{ value: Record<string, unknown>[] }> {
  const parsed = parseSql(sql);
  if (parsed.kind !== "select-simple" && parsed.kind !== "select-complex") {
    throw new Error(`expected a select-simple/select-complex parse, got ${parsed.kind}: ${(parsed as { error?: string }).error ?? ""}`);
  }
  const path = buildSelectPath(parsed, entitySetName);
  const res = await dataverseTestRequest<{ value: Record<string, unknown>[] }>("GET", path);
  return res.body;
}

describe.skipIf(!hasTestCredentials())("SQL4CDS SELECT path — real Dataverse integration (ZaneTest)", () => {
  const suffix = testRunSuffix();
  const parentSchema = `${PUBLISHER_PREFIX}_Sql4CdsSelectParent${suffix}`;
  const parentLogical = parentSchema.toLowerCase();
  const childSchema = `${PUBLISHER_PREFIX}_Sql4CdsSelectChild${suffix}`;
  const childLogical = childSchema.toLowerCase();
  const revenueField = `${PUBLISHER_PREFIX}_revenue${suffix}`.toLowerCase();
  const activeField = `${PUBLISHER_PREFIX}_active${suffix}`.toLowerCase();
  const notesField = `${PUBLISHER_PREFIX}_notes${suffix}`.toLowerCase();
  const categoryField = `${PUBLISHER_PREFIX}_category${suffix}`.toLowerCase();
  const childLookupField = `${PUBLISHER_PREFIX}_parentlookup${suffix}`.toLowerCase();
  const nameField = `${PUBLISHER_PREFIX}_name`;

  let parentEntitySet = "";
  let childEntitySet = "";
  let parentIdAttr = "";
  let p1: string, p2: string;
  let categoryAlphaValue = -1;

  beforeAll(async () => {
    installMockNativeBridge();
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: parentSchema,
      displayName: `SQL4CDS Select Parent ${suffix}`,
      displayCollectionName: `SQL4CDS Select Parents ${suffix}`,
      description: "自动化集成测试用表（SQL4CDS SELECT 路径），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: nameField,
      primaryFieldDisplayName: "Name",
    });
    await createTable(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: childSchema,
      displayName: `SQL4CDS Select Child ${suffix}`,
      displayCollectionName: `SQL4CDS Select Children ${suffix}`,
      description: "自动化集成测试用表（SQL4CDS SELECT 路径），测试结束后应已自动删除",
      ownershipType: "UserOwned",
      primaryFieldSchemaName: nameField,
      primaryFieldDisplayName: "Name",
    });
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, parentLogical, "Decimal", {
      schemaName: `${PUBLISHER_PREFIX}_Revenue${suffix}`,
      displayName: "Revenue",
      description: "",
      required: false,
      precision: 2,
    });
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, parentLogical, "Boolean", {
      schemaName: `${PUBLISHER_PREFIX}_Active${suffix}`,
      displayName: "Active",
      description: "",
      required: false,
    });
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, parentLogical, "Memo", {
      schemaName: `${PUBLISHER_PREFIX}_Notes${suffix}`,
      displayName: "Notes",
      description: "",
      required: false,
    });
    await createColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, parentLogical, "Picklist", {
      schemaName: `${PUBLISHER_PREFIX}_Category${suffix}`,
      displayName: "Category",
      description: "",
      required: false,
      options: ["Alpha", "Beta"],
    });
    await createLookupColumn(FAKE_CONNECTION_ID, SOLUTION_UNIQUE_NAME, {
      schemaName: `${PUBLISHER_PREFIX}_ParentLookup${suffix}`,
      displayName: "Parent Lookup",
      description: "",
      required: false,
      referencedEntity: parentLogical,
      referencingEntity: childLogical,
      relationshipSchemaName: `${PUBLISHER_PREFIX}_selparent_selchild_${suffix}`,
    });

    const [parentMeta, childMeta] = await Promise.all([
      fetchEntityMeta(FAKE_CONNECTION_ID, parentLogical),
      fetchEntityMeta(FAKE_CONNECTION_ID, childLogical),
    ]);
    parentEntitySet = parentMeta.entitySetName;
    childEntitySet = childMeta.entitySetName;
    parentIdAttr = parentMeta.primaryIdAttribute;

    // Picklist option Values are auto-assigned by Dataverse (createColumn deliberately omits
    // them) — read the real "Alpha" value back rather than guessing 1/2.
    const optionSetRes = await dataverseTestRequest<{ OptionSet: { Options: { Value: number; Label: { UserLocalizedLabel: { Label: string } } }[] } }>(
      "GET",
      `EntityDefinitions(LogicalName='${parentLogical}')/Attributes(LogicalName='${categoryField}')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet`,
    );
    const alphaOption = optionSetRes.body.OptionSet.Options.find((o) => o.Label.UserLocalizedLabel.Label === "Alpha");
    expect(alphaOption, "the Picklist should have a real, readable 'Alpha' option").toBeDefined();
    categoryAlphaValue = alphaOption!.Value;

    const rows = await Promise.all([
      insertRow(FAKE_CONNECTION_ID, parentLogical, parentEntitySet, {
        [nameField]: "Alpha Corp",
        [revenueField]: 100,
        [activeField]: true,
      }),
      insertRow(FAKE_CONNECTION_ID, parentLogical, parentEntitySet, {
        [nameField]: "Beta Inc",
        [revenueField]: 250.5,
        [activeField]: true,
      }),
      insertRow(FAKE_CONNECTION_ID, parentLogical, parentEntitySet, {
        [nameField]: "Gamma LLC",
        [revenueField]: 300,
        [activeField]: false,
      }),
      insertRow(FAKE_CONNECTION_ID, parentLogical, parentEntitySet, {
        [nameField]: "Delta NullCo",
        [activeField]: false,
        [notesField]: null,
      }),
    ]);
    [p1, p2] = rows.map((r) => r.newId!);

    await Promise.all([
      insertRow(FAKE_CONNECTION_ID, childLogical, childEntitySet, { [nameField]: "Child1", [childLookupField]: p1 }),
      insertRow(FAKE_CONNECTION_ID, childLogical, childEntitySet, { [nameField]: "Child2", [childLookupField]: p1 }),
      insertRow(FAKE_CONNECTION_ID, childLogical, childEntitySet, { [nameField]: "Child3", [childLookupField]: p2 }),
    ]);
  }, 300_000);

  afterAll(async () => {
    for (const logical of [childLogical, parentLogical]) {
      try {
        await dataverseTestRequest("DELETE", `EntityDefinitions(LogicalName='${logical}')`);
      } catch (err) {
        console.warn(`[integration test cleanup] 删除测试表失败（可能需要手动清理 ${logical}）：${err instanceof Error ? err.message : err}`);
      }
    }
    uninstallMockNativeBridge();
  }, 180_000);

  // ---------- Simple SELECT (single table -> OData) ----------

  it("SELECT * and SELECT <columns>", async () => {
    const star = await runSelect(parentEntitySet, `SELECT * FROM ${parentLogical}`);
    expect(star.value.length).toBe(4);

    const cols = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${nameField} = 'Alpha Corp'`);
    expect(cols.value).toHaveLength(1);
    // Every real Dataverse record carries "@odata.etag" regardless of $select — not part of the
    // requested column list.
    expect(Object.keys(cols.value[0]).sort()).toEqual([nameField, parentIdAttr, "@odata.etag"].sort());
  }, 30_000);

  it("WHERE comparison operators: = <> > >= < <=", async () => {
    const eq = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${revenueField} = 100`);
    expect(eq.value.map((r) => r[nameField])).toEqual(["Alpha Corp"]);

    const ne = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${revenueField} <> 100 AND ${revenueField} IS NOT NULL`);
    expect(new Set(ne.value.map((r) => r[nameField]))).toEqual(new Set(["Beta Inc", "Gamma LLC"]));

    const gt = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${revenueField} > 200`);
    expect(new Set(gt.value.map((r) => r[nameField]))).toEqual(new Set(["Beta Inc", "Gamma LLC"]));

    const gte = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${revenueField} >= 250.5`);
    expect(new Set(gte.value.map((r) => r[nameField]))).toEqual(new Set(["Beta Inc", "Gamma LLC"]));

    const lt = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${revenueField} < 200`);
    expect(lt.value.map((r) => r[nameField])).toEqual(["Alpha Corp"]);

    const lte = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${revenueField} <= 100`);
    expect(lte.value.map((r) => r[nameField])).toEqual(["Alpha Corp"]);
  }, 30_000);

  it("WHERE AND / OR nested combinations", async () => {
    const and = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${activeField} = true AND ${revenueField} > 200`);
    expect(and.value.map((r) => r[nameField])).toEqual(["Beta Inc"]);

    const or = await runSelect(
      parentEntitySet,
      `SELECT ${nameField} FROM ${parentLogical} WHERE ${nameField} = 'Alpha Corp' OR ${nameField} = 'Gamma LLC'`,
    );
    expect(new Set(or.value.map((r) => r[nameField]))).toEqual(new Set(["Alpha Corp", "Gamma LLC"]));
  }, 30_000);

  it("WHERE LIKE — contains / startswith / endswith / no-wildcard fallback", async () => {
    const contains = parseSql(`SELECT ${nameField} FROM ${parentLogical} WHERE ${nameField} LIKE '%orp%'`) as SelectSimple;
    expect(contains.filter).toContain("contains(");
    const containsRes = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${nameField} LIKE '%orp%'`);
    expect(containsRes.value.map((r) => r[nameField])).toEqual(["Alpha Corp"]);

    const startsRes = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${nameField} LIKE 'Alpha%'`);
    expect(startsRes.value.map((r) => r[nameField])).toEqual(["Alpha Corp"]);

    const endsRes = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${nameField} LIKE '%Inc'`);
    expect(endsRes.value.map((r) => r[nameField])).toEqual(["Beta Inc"]);

    const noWildcard = parseSql(`SELECT ${nameField} FROM ${parentLogical} WHERE ${nameField} LIKE 'Alpha Corp'`) as SelectSimple;
    expect(noWildcard.warnings.some((w) => w.includes("不含通配符"))).toBe(true);
    const noWildcardRes = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${nameField} LIKE 'Alpha Corp'`);
    expect(noWildcardRes.value.map((r) => r[nameField])).toEqual(["Alpha Corp"]);
  }, 30_000);

  it("WHERE NOT LIKE", async () => {
    const res = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${nameField} NOT LIKE '%Corp%' AND ${nameField} NOT LIKE '%NullCo%'`);
    expect(new Set(res.value.map((r) => r[nameField]))).toEqual(new Set(["Beta Inc", "Gamma LLC"]));
  }, 30_000);

  it("WHERE IS NULL / IS NOT NULL", async () => {
    const isNull = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${revenueField} IS NULL`);
    expect(isNull.value.map((r) => r[nameField])).toEqual(["Delta NullCo"]);

    const isNotNull = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${revenueField} IS NOT NULL`);
    expect(new Set(isNotNull.value.map((r) => r[nameField]))).toEqual(new Set(["Alpha Corp", "Beta Inc", "Gamma LLC"]));
  }, 30_000);

  it("WHERE IN / NOT IN literal list", async () => {
    const inRes = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${nameField} IN ('Alpha Corp', 'Gamma LLC')`);
    expect(new Set(inRes.value.map((r) => r[nameField]))).toEqual(new Set(["Alpha Corp", "Gamma LLC"]));

    const notInRes = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${nameField} NOT IN ('Alpha Corp', 'Gamma LLC', 'Delta NullCo')`);
    expect(notInRes.value.map((r) => r[nameField])).toEqual(["Beta Inc"]);
  }, 30_000);

  it("a table-alias-qualified field in a simple (non-JOIN) SELECT is rejected at parse time", () => {
    const parsed = parseSql(`SELECT p.${nameField} FROM ${parentLogical} p`);
    expect(parsed.kind).toBe("error");
  });

  it("ORDER BY + TOP", async () => {
    const res = await runSelect(parentEntitySet, `SELECT TOP 2 ${nameField} FROM ${parentLogical} WHERE ${revenueField} IS NOT NULL ORDER BY ${revenueField} DESC`);
    expect(res.value.map((r) => r[nameField])).toEqual(["Gamma LLC", "Beta Inc"]);
  }, 30_000);

  it("DISTINCT is rejected at parse time", () => {
    const parsed = parseSql(`SELECT DISTINCT ${activeField} FROM ${parentLogical}`);
    expect(parsed.kind).toBe("error");
  });

  it("string literal with an escaped quote, and a Unicode (N'...') literal, round-trip through INSERT and WHERE", async () => {
    const created = await insertRow(FAKE_CONNECTION_ID, parentLogical, parentEntitySet, {
      [nameField]: "O'Brien 卓越",
      [activeField]: true,
    });
    const res = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${nameField} = N'O''Brien 卓越'`);
    expect(res.value.map((r) => r[parentIdAttr])).toEqual([created.newId]);
  }, 30_000);

  it("GUID literal in a Lookup WHERE clause is auto-wrapped to the _field_value OData shadow property", async () => {
    const res = await runSelect(childEntitySet, `SELECT ${nameField} FROM ${childLogical} WHERE ${childLookupField} = '${p1}'`);
    expect(new Set(res.value.map((r) => r[nameField]))).toEqual(new Set(["Child1", "Child2"]));
  }, 30_000);

  // ---------- JOIN / GROUP BY / aggregates (-> FetchXML) ----------

  it("INNER JOIN / JOIN only returns matched rows", async () => {
    const res = await runSelect(
      parentEntitySet,
      `SELECT p.${nameField} FROM ${parentLogical} p JOIN ${childLogical} c ON p.${parentIdAttr} = c.${childLookupField}`,
    );
    expect(res.value).toHaveLength(3); // C1,C2 -> P1; C3 -> P2; P3/P4 have no children
  }, 30_000);

  it("LEFT JOIN / LEFT OUTER JOIN includes unmatched left-side rows", async () => {
    // Scoped to the 4 original controlled rows by name — other `it`s in this file insert
    // additional parent rows later (string-escaping, Picklist tests), and this file's `it`s share
    // one fixture table, so an unscoped query here would also start seeing that data as soon as
    // this test runs after one of those (already caught once: a real, if unrelated, test-design
    // bug, not a product bug).
    const res = await runSelect(
      parentEntitySet,
      `SELECT p.${nameField} FROM ${parentLogical} p LEFT OUTER JOIN ${childLogical} c ON p.${parentIdAttr} = c.${childLookupField} ` +
        `WHERE p.${nameField} IN ('Alpha Corp', 'Beta Inc', 'Gamma LLC', 'Delta NullCo')`,
    );
    // 3 matched (P1x2, P2x1) + 2 unmatched (P3, P4) = 5
    expect(res.value).toHaveLength(5);
    const names = res.value.map((r) => r[nameField]);
    expect(names.filter((n) => n === "Alpha Corp")).toHaveLength(2);
    expect(names).toContain("Gamma LLC");
    expect(names).toContain("Delta NullCo");
  }, 30_000);

  it("RIGHT JOIN and FULL JOIN are rejected at parse time, before any network call", () => {
    const right = parseSql(`SELECT p.${nameField} FROM ${parentLogical} p RIGHT JOIN ${childLogical} c ON p.${parentIdAttr} = c.${childLookupField}`);
    expect(right.kind).toBe("error");
    const full = parseSql(`SELECT p.${nameField} FROM ${parentLogical} p FULL JOIN ${childLogical} c ON p.${parentIdAttr} = c.${childLookupField}`);
    expect(full.kind).toBe("error");
  });

  it("JOIN error paths: unknown ON alias, comma-joined tables, SELECT * with JOIN", () => {
    const unknownAlias = parseSql(`SELECT p.${nameField} FROM ${parentLogical} p JOIN ${childLogical} c ON p.${parentIdAttr} = x.${childLookupField}`);
    expect(unknownAlias.kind).toBe("error");

    const commaJoin = parseSql(`SELECT p.${nameField} FROM ${parentLogical} p, ${childLogical} c WHERE p.${parentIdAttr} = c.${childLookupField}`);
    expect(commaJoin.kind).toBe("error");

    const starWithJoin = parseSql(`SELECT * FROM ${parentLogical} p JOIN ${childLogical} c ON p.${parentIdAttr} = c.${childLookupField}`);
    expect(starWithJoin.kind).toBe("error");
  });

  it("aggregates: COUNT(*), COUNT(col), SUM, AVG, MIN, MAX", async () => {
    // Scoped to the 4 original controlled rows by name — see the LEFT JOIN test's comment for why.
    const res = await runSelect(
      parentEntitySet,
      `SELECT COUNT(*) AS cnt, SUM(${revenueField}) AS total, AVG(${revenueField}) AS avgv, MIN(${revenueField}) AS minv, MAX(${revenueField}) AS maxv ` +
        `FROM ${parentLogical} WHERE ${activeField} = true AND ${nameField} IN ('Alpha Corp', 'Beta Inc', 'Gamma LLC', 'Delta NullCo')`,
    );
    expect(res.value).toHaveLength(1);
    const row = res.value[0];
    expect(row.cnt).toBe(2);
    expect(row.total).toBeCloseTo(350.5, 2);
    expect(row.avgv).toBeCloseTo(175.25, 2);
    expect(row.minv).toBeCloseTo(100, 2);
    expect(row.maxv).toBeCloseTo(250.5, 2);
  }, 30_000);

  it("GROUP BY groups rows by a real column with correct per-group counts", async () => {
    // Scoped to the 4 original controlled rows by name — see the LEFT JOIN test's comment for why.
    const res = await runSelect(
      parentEntitySet,
      `SELECT ${activeField}, COUNT(*) AS cnt FROM ${parentLogical} WHERE ${nameField} IN ('Alpha Corp', 'Beta Inc', 'Gamma LLC', 'Delta NullCo') GROUP BY ${activeField}`,
    );
    expect(res.value).toHaveLength(2);
    const byActive = new Map(res.value.map((r) => [r[activeField], r.cnt]));
    expect(byActive.get(true)).toBe(2);
    expect(byActive.get(false)).toBe(2);
  }, 30_000);

  it("GROUP BY validation errors: ungrouped non-aggregate field, GROUP BY field missing from SELECT", () => {
    const ungrouped = parseSql(`SELECT ${nameField}, COUNT(*) FROM ${parentLogical} GROUP BY ${activeField}`);
    expect(ungrouped.kind).toBe("error");

    const missingFromSelect = parseSql(`SELECT COUNT(*) FROM ${parentLogical} GROUP BY ${activeField}`);
    expect(missingFromSelect.kind).toBe("error");
  });

  it("HAVING is rejected at parse time", () => {
    const parsed = parseSql(`SELECT ${activeField}, COUNT(*) FROM ${parentLogical} GROUP BY ${activeField} HAVING COUNT(*) > 1`);
    expect(parsed.kind).toBe("error");
  });

  it("ORDER BY referencing a JOIN'd table's field is rejected at parse time", () => {
    const parsed = parseSql(
      `SELECT p.${nameField} FROM ${parentLogical} p JOIN ${childLogical} c ON p.${parentIdAttr} = c.${childLookupField} ORDER BY c.${nameField}`,
    );
    expect(parsed.kind).toBe("error");
  });

  it("Picklist column: create with auto-assigned option values, insert, and filter by the real value", async () => {
    const created = await insertRow(FAKE_CONNECTION_ID, parentLogical, parentEntitySet, {
      [nameField]: "Category Test Row",
      [categoryField]: categoryAlphaValue,
    });
    const res = await runSelect(parentEntitySet, `SELECT ${nameField} FROM ${parentLogical} WHERE ${categoryField} = ${categoryAlphaValue}`);
    expect(res.value.map((r) => r[parentIdAttr])).toContain(created.newId);
  }, 30_000);

  // ---------- Subqueries ----------

  it("WHERE x IN (SELECT ...) resolves and executes against real data", async () => {
    // Lookup columns require the wrapped `_x_value` form in $select (see translateSelectColumns'
    // own doc comment — a bare Lookup name 400s: "Could not find a property named ...").
    const sql = `SELECT ${nameField} FROM ${parentLogical} WHERE ${parentIdAttr} IN (SELECT _${childLookupField}_value FROM ${childLogical} WHERE ${nameField} = 'Child1')`;
    const resolved = await resolveSqlSubqueries(FAKE_CONNECTION_ID, sql);
    expect(resolved).not.toContain("(SELECT"); // the subquery itself was spliced away — the outer SELECT keyword still legitimately remains
    const res = await runSelect(parentEntitySet, resolved);
    expect(res.value.map((r) => r[nameField])).toEqual(["Alpha Corp"]);
  }, 30_000);

  it("WHERE x NOT IN (SELECT ...)", async () => {
    const sql = `SELECT ${nameField} FROM ${parentLogical} WHERE ${revenueField} IS NOT NULL AND ${parentIdAttr} NOT IN (SELECT _${childLookupField}_value FROM ${childLogical})`;
    const resolved = await resolveSqlSubqueries(FAKE_CONNECTION_ID, sql);
    const res = await runSelect(parentEntitySet, resolved);
    expect(res.value.map((r) => r[nameField])).toEqual(["Gamma LLC"]);
  }, 30_000);

  it("nested subqueries resolve depth-first", async () => {
    const sql =
      `SELECT ${nameField} FROM ${parentLogical} WHERE ${parentIdAttr} IN (` +
      `SELECT _${childLookupField}_value FROM ${childLogical} WHERE ${nameField} IN (SELECT ${nameField} FROM ${childLogical} WHERE ${nameField} = 'Child1'))`;
    const resolved = await resolveSqlSubqueries(FAKE_CONNECTION_ID, sql);
    const res = await runSelect(parentEntitySet, resolved);
    expect(res.value.map((r) => r[nameField])).toEqual(["Alpha Corp"]);
  }, 30_000);

  it("a subquery with zero matching rows resolves to the nil-GUID fallback, not an error or empty filter", async () => {
    const sql = `SELECT ${nameField} FROM ${parentLogical} WHERE ${parentIdAttr} IN (SELECT _${childLookupField}_value FROM ${childLogical} WHERE ${nameField} = 'NoSuchChild')`;
    const resolved = await resolveSqlSubqueries(FAKE_CONNECTION_ID, sql);
    expect(resolved).toContain("00000000-0000-0000-0000-000000000000");
    const res = await runSelect(parentEntitySet, resolved);
    expect(res.value).toEqual([]);
  }, 30_000);

  it("invalid subquery shapes are rejected before any network call", async () => {
    const withJoin = `SELECT ${nameField} FROM ${parentLogical} WHERE ${parentIdAttr} IN (SELECT c.${childLookupField} FROM ${childLogical} c JOIN ${parentLogical} p ON c.${childLookupField} = p.${parentIdAttr})`;
    await expect(resolveSqlSubqueries(FAKE_CONNECTION_ID, withJoin)).rejects.toThrow(/简单单表 SELECT/);

    const withStar = `SELECT ${nameField} FROM ${parentLogical} WHERE ${parentIdAttr} IN (SELECT * FROM ${childLogical})`;
    await expect(resolveSqlSubqueries(FAKE_CONNECTION_ID, withStar)).rejects.toThrow(/SELECT \*/);

    const withTwoColumns = `SELECT ${nameField} FROM ${parentLogical} WHERE ${parentIdAttr} IN (SELECT ${nameField}, ${childLookupField} FROM ${childLogical})`;
    await expect(resolveSqlSubqueries(FAKE_CONNECTION_ID, withTwoColumns)).rejects.toThrow(/只能 SELECT 一个字段/);
  }, 30_000);
});
