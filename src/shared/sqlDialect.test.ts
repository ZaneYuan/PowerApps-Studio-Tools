import { describe, expect, it } from "vitest";
import { CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { TSQL } from "./sqlDialect";

function stateFor(doc: string, schema: Record<string, string[]> = {}, defaultTable?: string): EditorState {
  return EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [sql({ dialect: TSQL, schema, defaultTable })] });
}

function nodeNameAt(state: EditorState, pos: number): string {
  return syntaxTree(state).resolveInner(pos, 1).name;
}

async function completionLabels(state: EditorState): Promise<string[]> {
  const pos = state.doc.length;
  const context = new CompletionContext(state, pos, true);
  const sources = state.languageDataAt<CompletionSource>("autocomplete", pos);
  const results = await Promise.all(sources.map((source) => source(context)));
  return results.flatMap((r) => r?.options.map((o) => o.label) ?? []);
}

describe("TSQL dialect", () => {
  it("parses LEFT and RIGHT in a JOIN as keywords, not built-in functions (Bugs/9.9 #3)", () => {
    const doc = "select * from a left join b on a.id = b.id right join c on c.id = a.id";
    const state = stateFor(doc);
    expect(nodeNameAt(state, doc.indexOf("left"))).toBe("Keyword");
    expect(nodeNameAt(state, doc.indexOf("right"))).toBe("Keyword");
  });

  it("completes a JOINed table's columns after its alias while the WHERE is half-typed", async () => {
    const doc =
      "select * from bupa_bupa_offer_product op\n  left join product p on op.productid = p.productid\n left join bupa_offer o on o.bupa_offerid = op.bupa_offerid\nwhere o.";
    const schema = {
      bupa_bupa_offer_product: ["productid", "bupa_offerid"],
      product: ["productid", "productnumber"],
      bupa_offer: ["bupa_offerid", "bupa_name"],
    };
    const labels = await completionLabels(stateFor(doc, schema, "bupa_bupa_offer_product"));
    expect(labels).toEqual(expect.arrayContaining(["bupa_offerid", "bupa_name"]));
    expect(labels).not.toContain("productnumber");
  });

  it("completes the default table's columns without a prefix", async () => {
    const doc = "select top 100 bupa_name from bupa_productbenefittype order by createdon desc\nwhere bupa_under";
    const schema = { bupa_productbenefittype: ["bupa_name", "bupa_underbasicbenefit", "createdon"], bupa_underwritersitemap: [] };
    const labels = await completionLabels(stateFor(doc, schema, "bupa_productbenefittype"));
    expect(labels).toContain("bupa_underbasicbenefit");
  });
});
