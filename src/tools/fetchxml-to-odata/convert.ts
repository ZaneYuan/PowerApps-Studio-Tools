const GUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

export interface AliasParam {
  name: string;
  value: string;
}

export interface ConversionResult {
  entityName: string | null;
  select: string | null;
  filter: string | null;
  orderby: string | null;
  top: string | null;
  expand: string | null;
  aliasParams: AliasParam[];
  warnings: string[];
  error: string | null;
}

interface Ctx {
  warnings: string[];
  aliasParams: AliasParam[];
  nextAlias: () => string;
}

function createCtx(): Ctx {
  let counter = 1;
  return {
    warnings: [],
    aliasParams: [],
    nextAlias: () => `@p${counter++}`,
  };
}

function quoteString(raw: string): string {
  return `'${raw.replace(/'/g, "''")}'`;
}

function inferLiteral(raw: string): string {
  if (GUID_RE.test(raw)) return raw;
  if (NUMBER_RE.test(raw)) return raw;
  return quoteString(raw);
}

function resolveFieldName(attribute: string, rawValue: string, ctx: Ctx): string {
  if (GUID_RE.test(rawValue) && !/^_.*_value$/.test(attribute)) {
    ctx.warnings.push(
      `字段 "${attribute}" 的比较值是 GUID，已按查找字段转换为 "_${attribute}_value"（请核实该字段确实是查找列）。`,
    );
    return `_${attribute}_value`;
  }
  return attribute;
}

function children(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName.toLowerCase() === tag);
}

function convertCondition(el: Element, ctx: Ctx): string {
  const attribute = el.getAttribute("attribute") ?? "";
  const operator = (el.getAttribute("operator") ?? "").toLowerCase();
  const rawValue = el.getAttribute("value");
  const entityname = el.getAttribute("entityname");

  if (entityname) {
    ctx.warnings.push(
      `条件引用了关联实体别名 "${entityname}"（属性 "${attribute}"），暂不支持自动转换为跨 $expand 的 $filter，请手动处理。`,
    );
    return `/* 未转换: entityname="${entityname}" attribute="${attribute}" operator="${operator}" */`;
  }

  switch (operator) {
    case "eq":
    case "ne":
    case "gt":
    case "ge":
    case "lt":
    case "le": {
      if (rawValue === null) {
        ctx.warnings.push(`条件 "${attribute} ${operator}" 缺少 value，已跳过。`);
        return `/* 未转换: ${attribute} ${operator} (缺少 value) */`;
      }
      const field = resolveFieldName(attribute, rawValue, ctx);
      return `${field} ${operator} ${inferLiteral(rawValue)}`;
    }

    case "like":
    case "not-like": {
      if (rawValue === null) {
        ctx.warnings.push(`条件 "${attribute} ${operator}" 缺少 value，已跳过。`);
        return `/* 未转换: ${attribute} ${operator} (缺少 value) */`;
      }
      const startsPct = rawValue.startsWith("%");
      const endsPct = rawValue.endsWith("%") && rawValue.length > 1;
      let inner = rawValue;
      if (startsPct) inner = inner.slice(1);
      if (endsPct) inner = inner.slice(0, -1);

      if (!startsPct && !endsPct) {
        ctx.warnings.push(
          `"${operator}" 的值不含通配符 %（属性 "${attribute}"），已按 ${operator === "like" ? "eq" : "ne"} 处理，请确认是否符合预期。`,
        );
        return operator === "like"
          ? `${attribute} eq ${quoteString(inner)}`
          : `${attribute} ne ${quoteString(inner)}`;
      }

      const fn = startsPct && endsPct ? "contains" : startsPct ? "endswith" : "startswith";
      const call = `${fn}(${attribute},${quoteString(inner)})`;
      return operator === "not-like" ? `not ${call}` : call;
    }

    case "null":
      return `${attribute} eq null`;
    case "not-null":
      return `${attribute} ne null`;

    case "in":
    case "not-in": {
      const values = Array.from(el.querySelectorAll("value")).map((v) => v.textContent ?? "");
      if (values.length === 0) {
        ctx.warnings.push(`条件 "${attribute} ${operator}" 没有 <value> 子节点，已跳过。`);
        return `/* 未转换: ${attribute} ${operator} (无 value 列表) */`;
      }
      const p1 = ctx.nextAlias();
      const p2 = ctx.nextAlias();
      ctx.aliasParams.push({ name: p1, value: quoteString(attribute) });
      ctx.aliasParams.push({
        name: p2,
        value: `[${values.map(inferLiteral).join(",")}]`,
      });
      const fn = operator === "in" ? "In" : "NotIn";
      ctx.warnings.push(
        `"${operator}" 已转换为 Microsoft.Dynamics.CRM.${fn}，需要把生成的 ${p1}/${p2} 作为独立查询参数附加到 URL 上（见下方"别名参数"）。`,
      );
      return `Microsoft.Dynamics.CRM.${fn}(PropertyName=${p1},PropertyValues=${p2})`;
    }

    case "on":
    case "on-or-before":
    case "on-or-after": {
      if (rawValue === null) {
        ctx.warnings.push(`条件 "${attribute} ${operator}" 缺少 value，已跳过。`);
        return `/* 未转换: ${attribute} ${operator} (缺少 value) */`;
      }
      const fnMap: Record<string, string> = {
        on: "On",
        "on-or-before": "OnOrBefore",
        "on-or-after": "OnOrAfter",
      };
      ctx.warnings.push(
        `操作符 "${operator}" 转换为 Dataverse 专属函数 Microsoft.Dynamics.CRM.${fnMap[operator]}，属于尽力而为转换，请对照 Microsoft 官方文档核实函数签名。`,
      );
      return `Microsoft.Dynamics.CRM.${fnMap[operator]}(PropertyName=${quoteString(attribute)},PropertyValue=${quoteString(rawValue)})`;
    }

    case "today":
    case "yesterday":
    case "tomorrow": {
      const fnMap: Record<string, string> = {
        today: "Today",
        yesterday: "Yesterday",
        tomorrow: "Tomorrow",
      };
      ctx.warnings.push(
        `操作符 "${operator}" 转换为 Dataverse 专属函数 Microsoft.Dynamics.CRM.${fnMap[operator]}，属于尽力而为转换，请对照 Microsoft 官方文档核实函数签名。`,
      );
      return `Microsoft.Dynamics.CRM.${fnMap[operator]}(PropertyName=${quoteString(attribute)})`;
    }

    case "last-x-days":
    case "next-x-days": {
      if (rawValue === null || !NUMBER_RE.test(rawValue)) {
        ctx.warnings.push(`条件 "${attribute} ${operator}" 缺少有效的数字 value，已跳过。`);
        return `/* 未转换: ${attribute} ${operator} (缺少数字 value) */`;
      }
      const fn = operator === "last-x-days" ? "LastXDays" : "NextXDays";
      ctx.warnings.push(
        `操作符 "${operator}" 转换为 Dataverse 专属函数 Microsoft.Dynamics.CRM.${fn}，属于尽力而为转换，请对照 Microsoft 官方文档核实函数签名。`,
      );
      return `Microsoft.Dynamics.CRM.${fn}(PropertyName=${quoteString(attribute)},PropertyValue=${rawValue})`;
    }

    default:
      ctx.warnings.push(`不支持的操作符 "${operator}"（属性 "${attribute}"），已跳过，请手动转换。`);
      return `/* 未转换: attribute="${attribute}" operator="${operator}" */`;
  }
}

function convertFilter(el: Element, ctx: Ctx): string | null {
  const type = (el.getAttribute("type") ?? "and").toLowerCase() === "or" ? "or" : "and";
  const parts: string[] = [];
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "condition") {
      parts.push(convertCondition(child, ctx));
    } else if (tag === "filter") {
      const nested = convertFilter(child, ctx);
      if (nested) parts.push(nested);
    }
  }
  if (parts.length === 0) return null;
  const joined = parts.join(type === "and" ? " and " : " or ");
  return parts.length > 1 ? `(${joined})` : joined;
}

function convertSelect(entityEl: Element): string | null {
  if (children(entityEl, "all-attributes").length > 0) return null;
  const attrs = children(entityEl, "attribute")
    .map((c) => c.getAttribute("name"))
    .filter((n): n is string => !!n);
  return attrs.length > 0 ? attrs.join(",") : null;
}

function convertOrder(entityEl: Element): string | null {
  const orders = children(entityEl, "order");
  if (orders.length === 0) return null;
  return orders
    .map((o) => {
      const attr = o.getAttribute("attribute") ?? "";
      const desc = (o.getAttribute("descending") ?? "false").toLowerCase() === "true";
      return desc ? `${attr} desc` : attr;
    })
    .join(",");
}

function convertLinkEntities(entityEl: Element, ctx: Ctx): string | null {
  const links = children(entityEl, "link-entity");
  if (links.length === 0) return null;

  const parts = links.map((link) => {
    const name = link.getAttribute("name") ?? "";
    const alias = link.getAttribute("alias");
    const navProp = alias ?? name;
    ctx.warnings.push(
      `link-entity "${name}"${alias ? `（alias: ${alias}）` : ""} 已转换为 $expand=${navProp}，但导航属性名称无法从 FetchXML 可靠推导，请对照实际 Web API 元数据（响应中的 @Microsoft.Dynamics.CRM.associatednavigationproperty）核实后替换。`,
    );

    if (children(link, "link-entity").length > 0) {
      ctx.warnings.push(`link-entity "${name}" 下还有嵌套 link-entity，暂不支持多层 $expand 自动转换，已忽略嵌套部分。`);
    }

    const nestedSelect = convertSelect(link);
    const filterEl = children(link, "filter")[0];
    const nestedFilter = filterEl ? convertFilter(filterEl, ctx) : null;

    const inner: string[] = [];
    if (nestedSelect) inner.push(`$select=${nestedSelect}`);
    if (nestedFilter) inner.push(`$filter=${nestedFilter}`);

    return inner.length > 0 ? `${navProp}(${inner.join(";")})` : navProp;
  });

  return parts.join(",");
}

export function convertFetchXmlToOData(fetchXml: string): ConversionResult {
  const empty: ConversionResult = {
    entityName: null,
    select: null,
    filter: null,
    orderby: null,
    top: null,
    expand: null,
    aliasParams: [],
    warnings: [],
    error: null,
  };

  if (!fetchXml.trim()) return empty;

  const doc = new DOMParser().parseFromString(fetchXml, "application/xml");
  if (doc.querySelector("parsererror")) {
    return { ...empty, error: "XML 解析失败，请检查 FetchXML 格式是否正确。" };
  }

  const fetchEl = doc.documentElement;
  if (fetchEl.tagName.toLowerCase() !== "fetch") {
    return { ...empty, error: "根节点不是 <fetch>，请确认粘贴的是完整的 FetchXML。" };
  }

  const entityEl = children(fetchEl, "entity")[0];
  if (!entityEl) {
    return { ...empty, error: "未找到 <entity> 节点。" };
  }

  const ctx = createCtx();

  const top = fetchEl.getAttribute("top") ?? fetchEl.getAttribute("count");
  const page = fetchEl.getAttribute("page");
  if (page && Number(page) > 1) {
    ctx.warnings.push(
      "检测到 page > 1：OData 分页需使用 @odata.nextLink / skiptoken 机制，无法直接用 $top 表达，请手动处理分页。",
    );
  }
  if ((fetchEl.getAttribute("distinct") ?? "").toLowerCase() === "true") {
    ctx.warnings.push('FetchXML distinct="true" 在 Web API 中没有直接等价的查询参数，已忽略。');
  }

  const select = convertSelect(entityEl);
  const orderby = convertOrder(entityEl);
  const filterEl = children(entityEl, "filter")[0];
  const filter = filterEl ? convertFilter(filterEl, ctx) : null;
  const expand = convertLinkEntities(entityEl, ctx);

  return {
    entityName: entityEl.getAttribute("name"),
    select,
    filter,
    orderby,
    top,
    expand,
    aliasParams: ctx.aliasParams,
    warnings: ctx.warnings,
    error: null,
  };
}

/** Very naive English pluralization used only as a starting guess for the entity set name — Dataverse's real plural names can be irregular and should be verified. */
export function naivePluralize(name: string): string {
  if (/[sxz]$|[cs]h$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}
