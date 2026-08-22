import { describe, expect, it } from "vitest";
import { serializeFetchXml } from "./serialize";
import { newCondition, newFilterGroup, newLinkEntity, newOrderClause, newQuery, type FetchXmlQuery } from "./types";

function baseQuery(overrides: Partial<FetchXmlQuery> = {}): FetchXmlQuery {
  return { ...newQuery(), entityName: "account", ...overrides };
}

describe("serializeFetchXml — entity name and top-level shape", () => {
  it("errors, with no xml, when entityName is blank (including whitespace-only)", () => {
    expect(serializeFetchXml(baseQuery({ entityName: "" }))).toEqual({ xml: null, error: expect.stringContaining("实体名称") });
    expect(serializeFetchXml(baseQuery({ entityName: "   " }))).toEqual({ xml: null, error: expect.any(String) });
  });

  it("an entity with no attributes/filter/orders/links serializes as a self-closing <entity /> ", () => {
    const { xml, error } = serializeFetchXml(baseQuery());
    expect(error).toBeNull();
    expect(xml).toBe('<fetch>\n  <entity name="account" />\n</fetch>');
  });

  it("top emits a top='n' attribute on <fetch>, trimmed", () => {
    const { xml } = serializeFetchXml(baseQuery({ top: " 50 " }));
    expect(xml).toContain('<fetch top="50">');
  });

  it("a blank top emits no top attribute at all", () => {
    const { xml } = serializeFetchXml(baseQuery({ top: "   " }));
    expect(xml).toBe('<fetch>\n  <entity name="account" />\n</fetch>');
  });

  it("distinct emits distinct='true'", () => {
    const { xml } = serializeFetchXml(baseQuery({ distinct: true }));
    expect(xml).toContain('<fetch distinct="true">');
  });

  it("top and distinct combine into one space-separated attribute list on <fetch>", () => {
    const { xml } = serializeFetchXml(baseQuery({ top: "10", distinct: true }));
    expect(xml).toContain('<fetch top="10" distinct="true">');
  });

  it("entityName is XML-escaped", () => {
    const { xml } = serializeFetchXml(baseQuery({ entityName: 'a"b' }));
    expect(xml).toContain('name="a&quot;b"');
  });
});

describe("serializeFetchXml — attribute list", () => {
  it("allAttributes emits <all-attributes /> and ignores the attributes text entirely", () => {
    const { xml } = serializeFetchXml(baseQuery({ allAttributes: true, attributes: "name, revenue" }));
    expect(xml).toContain("<all-attributes />");
    expect(xml).not.toContain('name="name"');
  });

  it("a comma-separated attribute list becomes one <attribute> per entry, trimmed", () => {
    const { xml } = serializeFetchXml(baseQuery({ attributes: " name , revenue ,telephone1" }));
    expect(xml).toContain('<attribute name="name" />');
    expect(xml).toContain('<attribute name="revenue" />');
    expect(xml).toContain('<attribute name="telephone1" />');
  });

  it("empty entries from stray/trailing commas are dropped, not emitted as blank attributes", () => {
    const { xml } = serializeFetchXml(baseQuery({ attributes: "name,,revenue," }));
    const matches = xml!.match(/<attribute /g);
    expect(matches).toHaveLength(2);
  });

  it("a blank attributes string with allAttributes=false yields no <attribute> elements — falls through to the self-closing entity", () => {
    const { xml } = serializeFetchXml(baseQuery({ attributes: "   " }));
    expect(xml).toBe('<fetch>\n  <entity name="account" />\n</fetch>');
  });
});

describe("serializeFetchXml — filter / condition", () => {
  it("an empty filter (no conditions, no groups) is omitted entirely, not emitted as <filter />", () => {
    const { xml } = serializeFetchXml(baseQuery({ filter: newFilterGroup() }));
    expect(xml).not.toContain("<filter");
  });

  it("a filter whose only nested group is itself empty is still omitted (recursion doesn't manufacture content)", () => {
    const filter = newFilterGroup();
    filter.groups.push(newFilterGroup());
    const { xml } = serializeFetchXml(baseQuery({ filter }));
    expect(xml).not.toContain("<filter");
  });

  it("the filter type attribute reflects and/or", () => {
    const andFilter = newFilterGroup("and");
    andFilter.conditions.push({ ...newCondition(), attribute: "statecode", operator: "eq", value: "0" });
    expect(serializeFetchXml(baseQuery({ filter: andFilter })).xml).toContain('<filter type="and">');

    const orFilter = newFilterGroup("or");
    orFilter.conditions.push({ ...newCondition(), attribute: "statecode", operator: "eq", value: "0" });
    expect(serializeFetchXml(baseQuery({ filter: orFilter })).xml).toContain('<filter type="or">');
  });

  it("a condition with a blank attribute is skipped even if it has a value", () => {
    const filter = newFilterGroup();
    filter.conditions.push({ ...newCondition(), attribute: "  ", operator: "eq", value: "0" });
    const { xml } = serializeFetchXml(baseQuery({ filter }));
    expect(xml).not.toContain("<filter");
  });

  it("a non-valueless operator with a blank value is skipped", () => {
    const filter = newFilterGroup();
    filter.conditions.push({ ...newCondition(), attribute: "name", operator: "eq", value: "   " });
    const { xml } = serializeFetchXml(baseQuery({ filter }));
    expect(xml).not.toContain("<filter");
  });

  it("a regular operator (eq/ne/gt/ge/lt/le/like/not-like) emits attribute/operator/value on one self-closing <condition>", () => {
    for (const operator of ["eq", "ne", "gt", "ge", "lt", "le", "like", "not-like"] as const) {
      const filter = newFilterGroup();
      filter.conditions.push({ ...newCondition(), attribute: "name", operator, value: "Contoso" });
      const { xml } = serializeFetchXml(baseQuery({ filter }));
      expect(xml, operator).toContain(`<condition attribute="name" operator="${operator}" value="Contoso" />`);
    }
  });

  it("valueless operators (null/not-null) never emit a value attribute, even if one was typed", () => {
    for (const operator of ["null", "not-null"] as const) {
      const filter = newFilterGroup();
      filter.conditions.push({ ...newCondition(), attribute: "name", operator, value: "ignored" });
      const { xml } = serializeFetchXml(baseQuery({ filter }));
      expect(xml, operator).toContain(`<condition attribute="name" operator="${operator}" />`);
      expect(xml, operator).not.toContain("value=");
    }
  });

  it("multi-value operators (in/not-in) split the comma-separated value into one <value> child per entry", () => {
    for (const operator of ["in", "not-in"] as const) {
      const filter = newFilterGroup();
      filter.conditions.push({ ...newCondition(), attribute: "statuscode", operator, value: " 1, 2 ,3" });
      const { xml } = serializeFetchXml(baseQuery({ filter }));
      expect(xml, operator).toContain(`<condition attribute="statuscode" operator="${operator}">`);
      expect(xml, operator).toContain("<value>1</value>");
      expect(xml, operator).toContain("<value>2</value>");
      expect(xml, operator).toContain("<value>3</value>");
    }
  });

  it("a multi-value operator whose value is only commas/whitespace (no real entries) is skipped entirely", () => {
    const filter = newFilterGroup();
    filter.conditions.push({ ...newCondition(), attribute: "statuscode", operator: "in", value: " , , " });
    const { xml } = serializeFetchXml(baseQuery({ filter }));
    expect(xml).not.toContain("<filter");
  });

  it("nested filter groups serialize recursively inside the parent <filter>", () => {
    const inner = newFilterGroup("or");
    inner.conditions.push({ ...newCondition(), attribute: "statuscode", operator: "eq", value: "1" });
    const outer = newFilterGroup("and");
    outer.conditions.push({ ...newCondition(), attribute: "statecode", operator: "eq", value: "0" });
    outer.groups.push(inner);
    const { xml } = serializeFetchXml(baseQuery({ filter: outer }));
    expect(xml).toContain('<filter type="and">');
    expect(xml).toContain('<filter type="or">');
    expect(xml).toContain('<condition attribute="statecode" operator="eq" value="0" />');
    expect(xml).toContain('<condition attribute="statuscode" operator="eq" value="1" />');
  });

  it("attribute name and value are both XML-escaped", () => {
    const filter = newFilterGroup();
    filter.conditions.push({ ...newCondition(), attribute: 'a"b', operator: "eq", value: "x&y" });
    const { xml } = serializeFetchXml(baseQuery({ filter }));
    expect(xml).toContain('attribute="a&quot;b"');
    expect(xml).toContain('value="x&amp;y"');
  });
});

describe("serializeFetchXml — order", () => {
  it("skips an order clause with a blank attribute", () => {
    const { xml } = serializeFetchXml(baseQuery({ orders: [{ ...newOrderClause(), attribute: "  " }] }));
    expect(xml).not.toContain("<order");
  });

  it("emits <order attribute=.../> with no descending flag by default", () => {
    const { xml } = serializeFetchXml(baseQuery({ orders: [{ ...newOrderClause(), attribute: "name" }] }));
    expect(xml).toContain('<order attribute="name" />');
  });

  it("descending=true adds descending='true'", () => {
    const { xml } = serializeFetchXml(baseQuery({ orders: [{ ...newOrderClause(), attribute: "name", descending: true }] }));
    expect(xml).toContain('<order attribute="name" descending="true" />');
  });

  it("multiple order clauses serialize in the given order, each on its own line", () => {
    const { xml } = serializeFetchXml(
      baseQuery({
        orders: [
          { ...newOrderClause(), attribute: "name" },
          { ...newOrderClause(), attribute: "revenue", descending: true },
        ],
      }),
    );
    const nameIdx = xml!.indexOf('attribute="name"');
    const revenueIdx = xml!.indexOf('attribute="revenue"');
    expect(nameIdx).toBeGreaterThan(-1);
    expect(revenueIdx).toBeGreaterThan(nameIdx);
  });
});

describe("serializeFetchXml — link-entity", () => {
  it("a link missing name, from, or to is dropped entirely — not emitted as a partial tag", () => {
    const missingName = { ...newLinkEntity(), from: "accountid", to: "parentaccountid" };
    expect(serializeFetchXml(baseQuery({ links: [missingName] })).xml).not.toContain("link-entity");

    const missingFrom = { ...newLinkEntity(), name: "contact", to: "parentaccountid" };
    expect(serializeFetchXml(baseQuery({ links: [missingFrom] })).xml).not.toContain("link-entity");

    const missingTo = { ...newLinkEntity(), name: "contact", from: "accountid" };
    expect(serializeFetchXml(baseQuery({ links: [missingTo] })).xml).not.toContain("link-entity");
  });

  it("a well-formed link with no body serializes as self-closing", () => {
    const link = { ...newLinkEntity(), name: "contact", from: "parentcustomerid", to: "accountid" };
    const { xml } = serializeFetchXml(baseQuery({ links: [link] }));
    expect(xml).toContain('<link-entity name="contact" from="parentcustomerid" to="accountid" />');
  });

  it("alias is included only when non-blank", () => {
    const withAlias = { ...newLinkEntity(), name: "contact", from: "parentcustomerid", to: "accountid", alias: "c" };
    expect(serializeFetchXml(baseQuery({ links: [withAlias] })).xml).toContain('alias="c"');

    const withoutAlias = { ...newLinkEntity(), name: "contact", from: "parentcustomerid", to: "accountid" };
    expect(serializeFetchXml(baseQuery({ links: [withoutAlias] })).xml).not.toContain("alias=");
  });

  it("linkType 'outer' emits link-type=\"outer\"; the default 'inner' emits nothing (fetchXML's own default)", () => {
    const outer = { ...newLinkEntity(), name: "contact", from: "parentcustomerid", to: "accountid", linkType: "outer" as const };
    expect(serializeFetchXml(baseQuery({ links: [outer] })).xml).toContain('link-type="outer"');

    const inner = { ...newLinkEntity(), name: "contact", from: "parentcustomerid", to: "accountid", linkType: "inner" as const };
    expect(serializeFetchXml(baseQuery({ links: [inner] })).xml).not.toContain("link-type");
  });

  it("a link's own attributes/filter/nested links all serialize inside the <link-entity> body", () => {
    const nestedFilter = newFilterGroup();
    nestedFilter.conditions.push({ ...newCondition(), attribute: "statecode", operator: "eq", value: "0" });
    const doublyNestedLink = { ...newLinkEntity(), name: "systemuser", from: "systemuserid", to: "ownerid" };
    const link = {
      ...newLinkEntity(),
      name: "contact",
      from: "parentcustomerid",
      to: "accountid",
      attributes: "fullname, emailaddress1",
      filter: nestedFilter,
      links: [doublyNestedLink],
    };
    const { xml } = serializeFetchXml(baseQuery({ links: [link] }));
    expect(xml).toContain('<link-entity name="contact" from="parentcustomerid" to="accountid">');
    expect(xml).toContain('<attribute name="fullname" />');
    expect(xml).toContain('<attribute name="emailaddress1" />');
    expect(xml).toContain('<filter type="and">');
    expect(xml).toContain('<condition attribute="statecode" operator="eq" value="0" />');
    expect(xml).toContain('<link-entity name="systemuser" from="systemuserid" to="ownerid" />');
  });

  it("multiple top-level links on the root entity all serialize, each independently valid/invalid", () => {
    const valid = { ...newLinkEntity(), name: "contact", from: "parentcustomerid", to: "accountid" };
    const invalid = { ...newLinkEntity(), name: "", from: "x", to: "y" };
    const { xml } = serializeFetchXml(baseQuery({ links: [valid, invalid] }));
    const matches = xml!.match(/<link-entity/g);
    expect(matches).toHaveLength(1);
  });

  it("name/from/to/alias are all XML-escaped", () => {
    const link = { ...newLinkEntity(), name: 'a"b', from: "x&y", to: "p<q", alias: 'r"s' };
    const { xml } = serializeFetchXml(baseQuery({ links: [link] }));
    expect(xml).toContain('name="a&quot;b"');
    expect(xml).toContain('from="x&amp;y"');
    expect(xml).toContain('to="p&lt;q"');
    expect(xml).toContain('alias="r&quot;s"');
  });
});

describe("serializeFetchXml — a full composite query exercises every piece together", () => {
  it("produces the exact expected XML for attributes + filter (with a nested group) + orders + a link-entity with its own filter", () => {
    const filter = newFilterGroup("and");
    filter.conditions.push({ ...newCondition(), attribute: "statecode", operator: "eq", value: "0" });
    const orGroup = newFilterGroup("or");
    orGroup.conditions.push({ ...newCondition(), attribute: "industrycode", operator: "in", value: "1,2" });
    orGroup.conditions.push({ ...newCondition(), attribute: "revenue", operator: "gt", value: "1000" });
    filter.groups.push(orGroup);

    const linkFilter = newFilterGroup();
    linkFilter.conditions.push({ ...newCondition(), attribute: "statecode", operator: "eq", value: "0" });
    const link = {
      ...newLinkEntity(),
      name: "contact",
      from: "parentcustomerid",
      to: "accountid",
      alias: "c",
      linkType: "outer" as const,
      attributes: "fullname",
      filter: linkFilter,
    };

    const query = baseQuery({
      attributes: "name,revenue",
      top: "25",
      distinct: true,
      filter,
      orders: [{ ...newOrderClause(), attribute: "name", descending: true }],
      links: [link],
    });

    const { xml, error } = serializeFetchXml(query);
    expect(error).toBeNull();
    expect(xml).toBe(
      [
        '<fetch top="25" distinct="true">',
        '  <entity name="account">',
        '    <attribute name="name" />',
        '    <attribute name="revenue" />',
        '    <filter type="and">',
        '      <condition attribute="statecode" operator="eq" value="0" />',
        '      <filter type="or">',
        '        <condition attribute="industrycode" operator="in">',
        "          <value>1</value>",
        "          <value>2</value>",
        "        </condition>",
        '        <condition attribute="revenue" operator="gt" value="1000" />',
        "      </filter>",
        "    </filter>",
        '    <order attribute="name" descending="true" />',
        '    <link-entity name="contact" from="parentcustomerid" to="accountid" alias="c" link-type="outer">',
        '      <attribute name="fullname" />',
        '      <filter type="and">',
        '        <condition attribute="statecode" operator="eq" value="0" />',
        "      </filter>",
        "    </link-entity>",
        "  </entity>",
        "</fetch>",
      ].join("\n"),
    );
  });
});
