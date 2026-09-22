import { describe, expect, it } from "vitest";
import { parseSql } from "../sql4cds/translate";
import { appendSqlStatements, selectCreatedRecordsSql, selectUpdatedRecordsSql } from "./pendingMigrationSql";

const g1 = "d345ae8e-c722-f011-8c4d-00224819e439";
const g2 = "5c8ccfc1-462a-f011-9a43-002248ed6f8a";

describe("selectCreatedRecordsSql", () => {
  it("selects every column of the created records by primary key", () => {
    expect(selectCreatedRecordsSql("account", "accountid", [g1, g2])).toEqual([`select * from account where accountid in ('${g1}','${g2}')`]);
  });

  it("splits long id lists into statements of 100", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    const statements = selectCreatedRecordsSql("account", "accountid", ids);
    expect(statements).toHaveLength(3);
    expect(statements[2]).toContain("000000000249");
  });

  it("returns nothing for no ids", () => {
    expect(selectCreatedRecordsSql("account", "accountid", [])).toEqual([]);
  });

  it("produces SQL that Data Migration's parser accepts", () => {
    const parsed = parseSql(selectCreatedRecordsSql("account", "accountid", [g1])[0]);
    expect(parsed.kind).toBe("select-simple");
  });
});

describe("selectUpdatedRecordsSql", () => {
  it("selects only the updated columns of the updated records", () => {
    expect(selectUpdatedRecordsSql("bupa_product", "bupa_productid", ["bupa_name", "bupa_rate"], [g1])).toEqual([
      `select bupa_name,bupa_rate from bupa_product where bupa_productid in ('${g1}')`,
    ]);
  });

  it("returns nothing when no column changed", () => {
    expect(selectUpdatedRecordsSql("account", "accountid", [], [g1])).toEqual([]);
  });
});

describe("appendSqlStatements", () => {
  it("fills an empty editor", () => {
    expect(appendSqlStatements("  \n", ["select * from a", "select * from b"])).toBe("select * from a;\nselect * from b;");
  });

  it("adds a missing terminator to the existing text before appending", () => {
    expect(appendSqlStatements("select * from a\n", ["select * from b"])).toBe("select * from a;\nselect * from b;");
  });

  it("keeps an existing terminator as-is", () => {
    expect(appendSqlStatements("select * from a;", ["select * from b"])).toBe("select * from a;\nselect * from b;");
  });
});
