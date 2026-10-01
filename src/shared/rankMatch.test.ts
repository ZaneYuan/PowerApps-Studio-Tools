import { describe, expect, it } from "vitest";
import { rankByMatch } from "./rankMatch";

const id = (s: string) => s;

describe("rankByMatch", () => {
  it("returns everything in original order for an empty query", () => {
    expect(rankByMatch(["b", "a"], "  ", id)).toEqual(["b", "a"]);
  });

  it("drops non-matches", () => {
    expect(rankByMatch(["Create", "Delete"], "upd", id)).toEqual([]);
  });

  it("ranks exact, then prefix, then word-start, then plain substring", () => {
    const items = ["Xupdatex", "bupa_UpdateFoo", "UpdateAll", "Update", "ApplyUpdateRule"];
    expect(rankByMatch(items, "update", id)).toEqual([
      "Update",
      "UpdateAll",
      "bupa_UpdateFoo",
      "ApplyUpdateRule",
      "Xupdatex",
    ]);
  });

  it("breaks ties by shorter text then alphabetical", () => {
    expect(rankByMatch(["UpdateBB", "UpdateA", "UpdateAA"], "update", id)).toEqual(["UpdateA", "UpdateAA", "UpdateBB"]);
  });
});
