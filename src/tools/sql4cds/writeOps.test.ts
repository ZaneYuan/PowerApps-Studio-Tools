import { describe, expect, it } from "vitest";
import { resolveIntersectRowValues, type IntersectRowValues } from "./writeOps";
import type { ManyToManyInfo } from "../../native/metadataService";

const REL: ManyToManyInfo = {
  intersectEntityName: "contoso_paymentfrequency_product",
  entity1LogicalName: "contoso_paymentfrequency",
  entity1IntersectAttribute: "contoso_paymentfrequencyid",
  entity1NavigationPropertyName: "contoso_paymentfrequency_product",
  entity2LogicalName: "product",
  entity2IntersectAttribute: "productid",
  entity2NavigationPropertyName: "product_contoso_paymentfrequency",
};

describe("resolveIntersectRowValues", () => {
  it("matches exact lowercase logical-name columns", () => {
    const result = resolveIntersectRowValues(REL, {
      contoso_paymentfrequencyid: "11111111-1111-1111-1111-111111111111",
      productid: "22222222-2222-2222-2222-222222222222",
    });
    const expected: IntersectRowValues = {
      entity1Value: "11111111-1111-1111-1111-111111111111",
      entity2Value: "22222222-2222-2222-2222-222222222222",
    };
    expect(result).toEqual(expected);
  });

  it("tolerates a display-ish PascalCase/underscore variant of the same column name", () => {
    const result = resolveIntersectRowValues(REL, {
      ContosoPaymentFrequencyId: "11111111-1111-1111-1111-111111111111",
      ProductId: "22222222-2222-2222-2222-222222222222",
    });
    expect(result).toEqual({
      entity1Value: "11111111-1111-1111-1111-111111111111",
      entity2Value: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("throws a clear, actionable error naming both real attribute names when a column matches neither side", () => {
    expect(() => resolveIntersectRowValues(REL, { SomeUnrelatedColumn: "x", productid: "22222222-2222-2222-2222-222222222222" })).toThrow(
      /contoso_paymentfrequencyid.*productid|productid.*contoso_paymentfrequencyid/s,
    );
  });

  it("does NOT match across a genuinely missing prefix (e.g. bare 'PaymentFrequencyId' for the real 'contoso_paymentfrequencyid')", () => {
    expect(() => resolveIntersectRowValues(REL, { PaymentFrequencyId: "x", productid: "22222222-2222-2222-2222-222222222222" })).toThrow();
  });
});
