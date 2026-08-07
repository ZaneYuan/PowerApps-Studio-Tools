import {
  MULTI_VALUE_OPERATORS,
  VALUELESS_OPERATORS,
  type Condition,
  type FetchXmlQuery,
  type FilterGroup,
  type LinkEntity,
  type OrderClause,
} from "./types";

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serializeAttributeList(attributes: string, indent: string): string[] {
  return attributes
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => `${indent}<attribute name="${xmlEscape(a)}" />`);
}

function serializeOrders(orders: OrderClause[], indent: string): string[] {
  return orders
    .filter((o) => o.attribute.trim())
    .map(
      (o) =>
        `${indent}<order attribute="${xmlEscape(o.attribute.trim())}"${o.descending ? ' descending="true"' : ""} />`,
    );
}

function serializeCondition(c: Condition, indent: string): string | null {
  const attr = c.attribute.trim();
  if (!attr) return null;

  if (VALUELESS_OPERATORS.includes(c.operator)) {
    return `${indent}<condition attribute="${xmlEscape(attr)}" operator="${c.operator}" />`;
  }

  if (!c.value.trim()) return null;

  if (MULTI_VALUE_OPERATORS.includes(c.operator)) {
    const values = c.value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length === 0) return null;
    const valueLines = values.map((v) => `${indent}  <value>${xmlEscape(v)}</value>`).join("\n");
    return `${indent}<condition attribute="${xmlEscape(attr)}" operator="${c.operator}">\n${valueLines}\n${indent}</condition>`;
  }

  return `${indent}<condition attribute="${xmlEscape(attr)}" operator="${c.operator}" value="${xmlEscape(c.value.trim())}" />`;
}

function serializeFilter(filter: FilterGroup, indent: string): string | null {
  const parts: string[] = [];
  for (const c of filter.conditions) {
    const s = serializeCondition(c, `${indent}  `);
    if (s) parts.push(s);
  }
  for (const g of filter.groups) {
    const s = serializeFilter(g, `${indent}  `);
    if (s) parts.push(s);
  }
  if (parts.length === 0) return null;
  return `${indent}<filter type="${filter.type}">\n${parts.join("\n")}\n${indent}</filter>`;
}

function serializeLinkEntity(link: LinkEntity, indent: string): string | null {
  const name = link.name.trim();
  const from = link.from.trim();
  const to = link.to.trim();
  if (!name || !from || !to) return null;

  const body: string[] = [];
  body.push(...serializeAttributeList(link.attributes, `${indent}  `));
  const filterXml = serializeFilter(link.filter, `${indent}  `);
  if (filterXml) body.push(filterXml);
  for (const nested of link.links) {
    const nestedXml = serializeLinkEntity(nested, `${indent}  `);
    if (nestedXml) body.push(nestedXml);
  }

  const attrs = [
    `name="${xmlEscape(name)}"`,
    `from="${xmlEscape(from)}"`,
    `to="${xmlEscape(to)}"`,
    link.alias.trim() ? `alias="${xmlEscape(link.alias.trim())}"` : null,
    link.linkType === "outer" ? `link-type="outer"` : null,
  ]
    .filter(Boolean)
    .join(" ");

  if (body.length === 0) {
    return `${indent}<link-entity ${attrs} />`;
  }
  return `${indent}<link-entity ${attrs}>\n${body.join("\n")}\n${indent}</link-entity>`;
}

export interface SerializeResult {
  xml: string | null;
  error: string | null;
}

export function serializeFetchXml(query: FetchXmlQuery): SerializeResult {
  const entityName = query.entityName.trim();
  if (!entityName) return { xml: null, error: "请填写实体名称（Logical Name）。" };

  const body: string[] = [];
  if (query.allAttributes) {
    body.push(`    <all-attributes />`);
  } else {
    body.push(...serializeAttributeList(query.attributes, "    "));
  }
  const filterXml = serializeFilter(query.filter, "    ");
  if (filterXml) body.push(filterXml);
  body.push(...serializeOrders(query.orders, "    "));
  for (const link of query.links) {
    const linkXml = serializeLinkEntity(link, "    ");
    if (linkXml) body.push(linkXml);
  }

  const entityXml =
    body.length > 0
      ? `  <entity name="${xmlEscape(entityName)}">\n${body.join("\n")}\n  </entity>`
      : `  <entity name="${xmlEscape(entityName)}" />`;

  const fetchAttrs = [
    query.top.trim() ? `top="${xmlEscape(query.top.trim())}"` : null,
    query.distinct ? `distinct="true"` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const xml = `<fetch${fetchAttrs ? ` ${fetchAttrs}` : ""}>\n${entityXml}\n</fetch>`;
  return { xml, error: null };
}
