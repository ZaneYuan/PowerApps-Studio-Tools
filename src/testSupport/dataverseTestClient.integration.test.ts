// Proof-of-concept for the whole real-Dataverse test mechanism itself (auth cache -> silent token
// -> direct fetch) — every other *.integration.test.ts in this repo builds on the same
// dataverseTestClient and can assume this one already proves the plumbing works.
import { describe, expect, it } from "vitest";
import { dataverseTestRequest, hasTestCredentials, TEST_ORG_URL } from "./dataverseTestClient";

describe.skipIf(!hasTestCredentials())("dataverseTestClient — real ZaneTest connectivity", () => {
  it("WhoAmI succeeds and returns an OrganizationId, proving the cached token is valid and scoped to the right org", async () => {
    const res = await dataverseTestRequest<{ OrganizationId: string; UserId: string; BusinessUnitId: string }>("GET", "WhoAmI");
    expect(res.status).toBe(200);
    expect(res.body.OrganizationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("a plain metadata GET (EntityDefinitions with a tight $select) round-trips real JSON, confirming the API base URL is correct", async () => {
    const res = await dataverseTestRequest<{ value: { LogicalName: string }[] }>(
      "GET",
      "EntityDefinitions?$select=LogicalName&$filter=LogicalName eq 'account'",
    );
    expect(res.body.value).toHaveLength(1);
    expect(res.body.value[0].LogicalName).toBe("account");
  });
});

it("sanity: TEST_ORG_URL matches the known ZaneTest org (guards against someone accidentally pointing this suite at the wrong environment)", () => {
  expect(TEST_ORG_URL).toBe("https://org0475e5da.crm5.dynamics.com");
});
