// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { splitStatements } from "./DataMigration";

describe("splitStatements", () => {
  it("splits a simple multi-statement batch on `;`", () => {
    expect(splitStatements("SELECT a FROM t1; SELECT b FROM t2;")).toEqual(["SELECT a FROM t1", "SELECT b FROM t2"]);
  });

  it("ignores a trailing statement with no closing `;`", () => {
    expect(splitStatements("SELECT a FROM t1; SELECT b FROM t2")).toEqual(["SELECT a FROM t1", "SELECT b FROM t2"]);
  });

  it("does not split on a `;` inside a single-quoted string literal", () => {
    expect(splitStatements("INSERT INTO t (name) VALUES ('a;b'); SELECT 1;")).toEqual(["INSERT INTO t (name) VALUES ('a;b')", "SELECT 1"]);
  });

  it("does not split on a `;` inside a `--` line comment (regression: 8.19.md #2)", () => {
    const sql = `-- 2. contoso_productroomtype -- Room Type (single room type per product; WW/PTL label pair...)\nINSERT INTO t (id) VALUES (1);\nSELECT 1;`;
    expect(splitStatements(sql)).toEqual([
      "-- 2. contoso_productroomtype -- Room Type (single room type per product; WW/PTL label pair...)\nINSERT INTO t (id) VALUES (1)",
      "SELECT 1",
    ]);
  });

  it("resumes normal `;` splitting once a line comment ends", () => {
    const sql = "SELECT 1; -- comment with a ; inside\nSELECT 2;";
    expect(splitStatements(sql)).toEqual(["SELECT 1", "-- comment with a ; inside\nSELECT 2"]);
  });

  it("returns an empty array for blank input", () => {
    expect(splitStatements("   \n  ")).toEqual([]);
  });
});
