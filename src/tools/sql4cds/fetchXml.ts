// A small, purpose-built FetchXML AST + serializer for SQL4CDS's translated output (JOIN /
// GROUP BY / aggregate queries) — deliberately not sharing types/serialize.ts from
// fetchxml-builder, whose `Condition`/`FilterGroup`/`LinkEntity` types carry `id` fields for an
// editable React UI and have no concept of aggregate/groupby/alias. Retrofitting that shape here
// would be more awkward than this ~100-line dedicated serializer.

export type FxAggregateFunc = "count" | "countcolumn" | "sum" | "avg" | "min" | "max";

export interface FxAttribute {
  name: string;
  aggregate?: FxAggregateFunc;
  groupby?: boolean;
  /** Required by FetchXML when `aggregate` or `groupby` is set; optional otherwise. */
  alias?: string;
}

export type FxConditionOperator = "eq" | "ne" | "gt" | "ge" | "lt" | "le" | "like" | "not-like" | "null" | "not-null" | "in" | "not-in";

export interface FxCondition {
  attribute: string;
  operator: FxConditionOperator;
  /** Single value for the comparison/like operators; ignored for null/not-null. */
  value?: string;
  /** Multiple values for in/not-in, rendered as sibling <value> elements. */
  values?: string[];
  /** FetchXML lets any filter (root or nested, inside an "and" or an "or") reference a joined
   *  entity's attribute directly via `entityname="{link alias}"` — so the whole WHERE tree can
   *  stay a single filter at the root, AND/OR structure preserved exactly as SQL wrote it,
   *  instead of having to split it across each link-entity's own nested <filter>. Omitted for
   *  conditions on the root entity itself. */
  entityname?: string;
}

export type FxFilterType = "and" | "or";

export interface FxFilter {
  type: FxFilterType;
  conditions: FxCondition[];
  groups: FxFilter[];
}

export interface FxOrder {
  attribute: string;
  descending: boolean;
}

export type FxLinkType = "inner" | "outer";

export interface FxLink {
  name: string;
  alias: string;
  from: string;
  to: string;
  linkType: FxLinkType;
  attributes: FxAttribute[];
  filter: FxFilter | null;
  links: FxLink[];
}

export interface FxQuery {
  entityName: string;
  attributes: FxAttribute[];
  /** Sets `aggregate="true"` on <fetch> — required whenever any attribute has `aggregate`/`groupby`. */
  aggregate: boolean;
  distinct: boolean;
  top: string | null;
  filter: FxFilter | null;
  links: FxLink[];
  orders: FxOrder[];
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serializeAttribute(a: FxAttribute, indent: string): string {
  const attrs = [
    `name="${xmlEscape(a.name)}"`,
    a.aggregate ? `aggregate="${a.aggregate}"` : null,
    a.groupby ? `groupby="true"` : null,
    a.alias ? `alias="${xmlEscape(a.alias)}"` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `${indent}<attribute ${attrs} />`;
}

function serializeCondition(c: FxCondition, indent: string): string {
  const entityAttr = c.entityname ? ` entityname="${xmlEscape(c.entityname)}"` : "";
  if (c.operator === "null" || c.operator === "not-null") {
    return `${indent}<condition attribute="${xmlEscape(c.attribute)}"${entityAttr} operator="${c.operator}" />`;
  }
  if (c.operator === "in" || c.operator === "not-in") {
    const values = (c.values ?? []).map((v) => `${indent}  <value>${xmlEscape(v)}</value>`).join("\n");
    return `${indent}<condition attribute="${xmlEscape(c.attribute)}"${entityAttr} operator="${c.operator}">\n${values}\n${indent}</condition>`;
  }
  return `${indent}<condition attribute="${xmlEscape(c.attribute)}"${entityAttr} operator="${c.operator}" value="${xmlEscape(c.value ?? "")}" />`;
}

function serializeFilter(filter: FxFilter, indent: string): string | null {
  const parts: string[] = [];
  for (const c of filter.conditions) parts.push(serializeCondition(c, `${indent}  `));
  for (const g of filter.groups) {
    const s = serializeFilter(g, `${indent}  `);
    if (s) parts.push(s);
  }
  if (parts.length === 0) return null;
  return `${indent}<filter type="${filter.type}">\n${parts.join("\n")}\n${indent}</filter>`;
}

function serializeOrders(orders: FxOrder[], indent: string): string[] {
  return orders.map((o) => `${indent}<order attribute="${xmlEscape(o.attribute)}"${o.descending ? ' descending="true"' : ""} />`);
}

function serializeLink(link: FxLink, indent: string): string {
  const body: string[] = [];
  for (const a of link.attributes) body.push(serializeAttribute(a, `${indent}  `));
  const filterXml = link.filter ? serializeFilter(link.filter, `${indent}  `) : null;
  if (filterXml) body.push(filterXml);
  for (const nested of link.links) body.push(serializeLink(nested, `${indent}  `));

  const attrs = [
    `name="${xmlEscape(link.name)}"`,
    `from="${xmlEscape(link.from)}"`,
    `to="${xmlEscape(link.to)}"`,
    `alias="${xmlEscape(link.alias)}"`,
    link.linkType === "outer" ? `link-type="outer"` : null,
  ]
    .filter(Boolean)
    .join(" ");

  if (body.length === 0) return `${indent}<link-entity ${attrs} />`;
  return `${indent}<link-entity ${attrs}>\n${body.join("\n")}\n${indent}</link-entity>`;
}

export function serializeFetchXml(query: FxQuery): string {
  const body: string[] = [];
  for (const a of query.attributes) body.push(serializeAttribute(a, "    "));
  const filterXml = query.filter ? serializeFilter(query.filter, "    ") : null;
  if (filterXml) body.push(filterXml);
  body.push(...serializeOrders(query.orders, "    "));
  for (const link of query.links) body.push(serializeLink(link, "    "));

  const entityXml =
    body.length > 0
      ? `  <entity name="${xmlEscape(query.entityName)}">\n${body.join("\n")}\n  </entity>`
      : `  <entity name="${xmlEscape(query.entityName)}" />`;

  const fetchAttrs = [
    query.top ? `top="${xmlEscape(query.top)}"` : null,
    query.distinct ? `distinct="true"` : null,
    query.aggregate ? `aggregate="true"` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return `<fetch${fetchAttrs ? ` ${fetchAttrs}` : ""}>\n${entityXml}\n</fetch>`;
}
