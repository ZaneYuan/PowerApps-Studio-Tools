// Import the T-SQL-only build instead of the top-level package — the latter bundles every
// supported dialect's grammar (MySQL, PostgreSQL, BigQuery, ...) into one ~2.4MB chunk even
// though we only ever parse transactsql.
import pkg from "node-sql-parser/build/transactsql";
import { serializeFetchXml, type FxAggregateFunc, type FxAttribute, type FxCondition, type FxFilter, type FxFilterType, type FxLink, type FxLinkType, type FxOrder, type FxQuery } from "./fetchXml";
const { Parser } = pkg;

const GUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Minimal shape of the bits of node-sql-parser's AST this translator actually reads — the
 *  library's own types are broad unions that don't narrow well, so we describe just what we use
 *  and validate everything else explicitly rather than trusting `any`. Shapes below were
 *  confirmed by running the real parser against representative SQL (JOIN/GROUP BY/aggregate/
 *  INSERT/UPDATE/DELETE), not guessed from docs. */
export interface SqlNode {
  type: string;
  value?: unknown;
  operator?: string;
  left?: SqlNode;
  right?: SqlNode;
  table?: string | null;
  column?: string;
  /** aggr_func only */
  name?: string;
  /** aggr_func only — always a single arg (COUNT/SUM/AVG/MIN/MAX each take exactly one). */
  args?: { expr: SqlNode };
}

interface ColumnItem {
  expr: SqlNode;
  as?: string | null;
}

interface FromItem {
  table?: string;
  as?: string | null;
  join?: string | null;
  on?: SqlNode | null;
}

interface OrderByItem {
  expr: SqlNode;
  type: "ASC" | "DESC" | null;
}

interface SelectAst {
  type: string;
  columns: ColumnItem[] | string;
  from: FromItem[] | null;
  where: SqlNode | null;
  groupby: { columns: SqlNode[] } | null;
  having: SqlNode | null;
  distinct: unknown;
  top: { value: number } | null;
  orderby: OrderByItem[] | null;
}

interface InsertAst {
  type: "insert";
  table: { table: string }[];
  columns: string[] | null;
  values: { values: { value: SqlNode[] }[] };
}

interface SetClauseAst {
  column: string;
  value: SqlNode;
  table: string | null;
}

interface UpdateAst {
  type: "update";
  table: { table: string }[];
  set: SetClauseAst[];
  where: SqlNode | null;
}

interface DeleteAst {
  type: "delete";
  table: { table: string }[] | null;
  from: { table: string }[] | null;
  where: SqlNode | null;
}

export interface SelectSimpleResult {
  kind: "select-simple";
  entityLogicalName: string;
  entitySetGuess: string;
  select: string | null;
  filter: string | null;
  orderby: string | null;
  top: string | null;
  warnings: string[];
}

export interface SelectComplexResult {
  kind: "select-complex";
  entityLogicalName: string;
  entitySetGuess: string;
  fetchXml: string;
  warnings: string[];
}

export interface InsertResult {
  kind: "insert";
  entityLogicalName: string;
  entitySetGuess: string;
  columns: string[];
  /** One array of literal AST nodes per VALUES tuple — converted to plain JS values (and, for
   *  Lookup columns, `@odata.bind` payloads) by writeOps.ts at execution time, once entity
   *  attribute metadata is available. */
  rows: SqlNode[][];
  warnings: string[];
}

export interface SetClause {
  column: string;
  value: SqlNode;
}

export interface MutateResult {
  kind: "mutate";
  action: "update" | "delete";
  entityLogicalName: string;
  entitySetGuess: string;
  /** OData $filter — WHERE is mandatory for both update and delete (enforced below). */
  filter: string;
  setClauses?: SetClause[];
  warnings: string[];
}

export interface ErrorResult {
  kind: "error";
  error: string;
}

export interface EmptyResult {
  kind: "empty";
}

export type ParsedStatement = SelectSimpleResult | SelectComplexResult | InsertResult | MutateResult | ErrorResult | EmptyResult;

const COMPARISON_OPERATORS: Record<string, string> = {
  "=": "eq",
  "<>": "ne",
  "!=": "ne",
  ">": "gt",
  ">=": "ge",
  "<": "lt",
  "<=": "le",
};

const FX_COMPARISON_OPERATORS: Record<string, FxCondition["operator"]> = {
  "=": "eq",
  "<>": "ne",
  "!=": "ne",
  ">": "gt",
  ">=": "ge",
  "<": "lt",
  "<=": "le",
};

function quoteString(raw: string): string {
  return `'${raw.replace(/'/g, "''")}'`;
}

function formatLiteral(node: SqlNode): string {
  if (node.type === "number") return String(node.value);
  if (node.type === "single_quote_string" || node.type === "string") {
    const raw = String(node.value);
    return GUID_RE.test(raw) ? raw : quoteString(raw);
  }
  if (node.type === "bool") return node.value ? "true" : "false";
  throw new Error(`不支持的字面量类型: ${node.type}`);
}

/** Raw text for a FetchXML condition/order value — unlike formatLiteral (OData string syntax),
 *  XML attribute values need no SQL-style quoting, just XML-escaping (done by the serializer). */
function formatFxLiteral(node: SqlNode): string {
  if (node.type === "number") return String(node.value);
  if (node.type === "single_quote_string" || node.type === "string") return String(node.value);
  if (node.type === "bool") return node.value ? "1" : "0";
  throw new Error(`不支持的字面量类型: ${node.type}`);
}

/** Converts a literal AST node to a plain JS value for a write payload (INSERT/UPDATE) — distinct
 *  from formatLiteral/formatFxLiteral, which both produce *query-string* text. */
export function literalToJsValue(node: SqlNode): string | number | boolean | null {
  if (node.type === "number") return node.value as number;
  if (node.type === "single_quote_string" || node.type === "string") return node.value as string;
  if (node.type === "bool") return node.value as boolean;
  if (node.type === "null") return null;
  throw new Error(`不支持的字面量类型: ${node.type}`);
}

function columnName(node: SqlNode): string {
  if (node.type !== "column_ref" || !node.column) {
    throw new Error("这里必须是一个字段名");
  }
  if (node.table) {
    throw new Error(`不支持带表别名的字段引用 "${node.table}.${node.column}"（当前只支持单表查询）`);
  }
  return node.column;
}

function parseColumnRef(node: SqlNode): { table: string | null; column: string } {
  if (node.type !== "column_ref" || !node.column) {
    throw new Error("这里必须是一个字段名");
  }
  return { table: node.table ?? null, column: node.column };
}

function translateWhere(node: SqlNode, warnings: string[]): string {
  const op = node.operator;

  if (op === "AND" || op === "OR") {
    const left = translateWhere(node.left!, warnings);
    const right = translateWhere(node.right!, warnings);
    return `(${left} ${op.toLowerCase()} ${right})`;
  }

  if (op && op in COMPARISON_OPERATORS) {
    const field = columnName(node.left!);
    const lit = formatLiteral(node.right!);
    return `${field} ${COMPARISON_OPERATORS[op]} ${lit}`;
  }

  if (op === "LIKE" || op === "NOT LIKE") {
    const field = columnName(node.left!);
    const raw = String(node.right!.value ?? "");
    const startsPct = raw.startsWith("%");
    const endsPct = raw.endsWith("%") && raw.length > 1;
    let inner = raw;
    if (startsPct) inner = inner.slice(1);
    if (endsPct) inner = inner.slice(0, -1);
    const quoted = quoteString(inner);

    let call: string;
    if (startsPct && endsPct) call = `contains(${field},${quoted})`;
    else if (startsPct) call = `endswith(${field},${quoted})`;
    else if (endsPct) call = `startswith(${field},${quoted})`;
    else {
      warnings.push(`LIKE 的值 "${raw}" 不含通配符 %，已按等值 (=) 处理`);
      return op === "NOT LIKE" ? `${field} ne ${quoted}` : `${field} eq ${quoted}`;
    }
    return op === "NOT LIKE" ? `not ${call}` : call;
  }

  if (op === "IS" || op === "IS NOT") {
    const field = columnName(node.left!);
    return op === "IS" ? `${field} eq null` : `${field} ne null`;
  }

  if (op === "IN" || op === "NOT IN") {
    const field = columnName(node.left!);
    const right = node.right as unknown as { value: SqlNode[] };
    // Microsoft.Dynamics.CRM.In/NotIn's PropertyValues is always Edm.String, regardless of
    // the target field's real type — confirmed against a live org (int/picklist values sent
    // unquoted come back "Cannot convert the literal '0' to the expected type 'Edm.String'").
    const values = right.value.map((v) => quoteString(String(v.value))).join(",");
    const fn = op === "IN" ? "In" : "NotIn";
    return `Microsoft.Dynamics.CRM.${fn}(PropertyName='${field}',PropertyValues=[${values}])`;
  }

  throw new Error(`不支持的操作符 "${op ?? node.type}"`);
}

function translateSelectColumns(columns: ColumnItem[] | string): string | null {
  if (typeof columns === "string") return null; // some dialects use the literal string "*"
  if (columns.length === 1 && isStar(columns[0].expr)) return null;

  return columns
    .map((c) => {
      if (c.expr.type !== "column_ref") {
        throw new Error("SELECT 列表暂不支持函数/聚合（如 COUNT），只支持列名");
      }
      return columnName(c.expr);
    })
    .join(",");
}

function isStar(node: SqlNode): boolean {
  // T-SQL represents bare `*` as a column_ref with column "*", not a dedicated "star" node
  // (that only shows up inside aggregate args like COUNT(*)) — check both to be safe.
  return node.type === "star" || (node.type === "column_ref" && node.column === "*");
}

function translateOrderBy(orderby: OrderByItem[] | null): string | null {
  if (!orderby) return null;
  return orderby
    .map((o) => {
      const col = columnName(o.expr);
      return o.type === "DESC" ? `${col} desc` : col;
    })
    .join(",");
}

/** Same naive pluralization heuristic used by the FetchXML→OData tool — a starting guess
 *  only, Dataverse's real plural entity set names can be irregular. */
function naivePluralize(name: string): string {
  if (/[sxz]$|[cs]h$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

/** Dataverse's overwhelmingly common convention: an entity's primary id attribute is its logical
 *  name + "id" (account -> accountid, contoso_quote -> contoso_quoteid). Used only for COUNT(*), which
 *  FetchXML can't aggregate on a literal "*" — it needs a real, reliably-not-null attribute name.
 *  A guess, same spirit as naivePluralize/entitySetGuess elsewhere in this tool: synchronous, no
 *  metadata round-trip, surfaced as an editable/inspectable warning rather than silently trusted. */
function guessPrimaryIdAttribute(entityLogicalName: string): string {
  return `${entityLogicalName}id`;
}

function resolveLinkType(joinKeyword: string): FxLinkType {
  const kw = joinKeyword.toUpperCase();
  if (kw === "JOIN" || kw === "INNER JOIN") return "inner";
  if (kw === "LEFT JOIN") return "outer";
  throw new Error(`不支持的 JOIN 类型 "${joinKeyword}"（只支持 JOIN / INNER JOIN / LEFT JOIN）。`);
}

function refEntityName(alias: string, rootAlias: string): string | undefined {
  return alias === rootAlias ? undefined : alias;
}

function translateFetchXmlCondition(node: SqlNode, knownAliases: Set<string>, rootAlias: string): FxCondition {
  const op = node.operator;

  function ref(refNode: SqlNode): { attribute: string; entityname?: string } {
    const r = parseColumnRef(refNode);
    const alias = r.table ?? rootAlias;
    if (!knownAliases.has(alias)) throw new Error(`条件里引用了未知的表别名 "${r.table}"。`);
    return { attribute: r.column, entityname: refEntityName(alias, rootAlias) };
  }

  if (op && op in FX_COMPARISON_OPERATORS) {
    return { ...ref(node.left!), operator: FX_COMPARISON_OPERATORS[op]!, value: formatFxLiteral(node.right!) };
  }
  if (op === "LIKE" || op === "NOT LIKE") {
    return { ...ref(node.left!), operator: op === "LIKE" ? "like" : "not-like", value: String(node.right!.value ?? "") };
  }
  if (op === "IS" || op === "IS NOT") {
    return { ...ref(node.left!), operator: op === "IS" ? "null" : "not-null" };
  }
  if (op === "IN" || op === "NOT IN") {
    const right = node.right as unknown as { value: SqlNode[] };
    return { ...ref(node.left!), operator: op === "IN" ? "in" : "not-in", values: right.value.map(formatFxLiteral) };
  }

  throw new Error(`不支持的操作符 "${op ?? node.type}"`);
}

function translateFetchXmlFilter(node: SqlNode, knownAliases: Set<string>, rootAlias: string): FxFilter {
  const op = node.operator;
  if (op === "AND" || op === "OR") {
    const left = translateFetchXmlFilter(node.left!, knownAliases, rootAlias);
    const right = translateFetchXmlFilter(node.right!, knownAliases, rootAlias);
    const type = op.toLowerCase() as FxFilterType;
    // Flatten same-type chains into one filter instead of nesting a group per AND — purely
    // cosmetic (shorter generated FetchXML), identical semantics either way.
    if (left.type === type && right.type === type) {
      return { type, conditions: [...left.conditions, ...right.conditions], groups: [...left.groups, ...right.groups] };
    }
    return { type, conditions: [], groups: [left, right] };
  }
  return { type: "and", conditions: [translateFetchXmlCondition(node, knownAliases, rootAlias)], groups: [] };
}

/** SELECT with JOIN and/or GROUP BY/aggregate — translated to FetchXML instead of OData, since
 *  this codebase has no $apply/analytics support and OData $expand can't express arbitrary join
 *  conditions. `<link-entity from="" to="">` is purely syntactic (just the ON clause's two
 *  attribute names) — no relationship metadata lookup needed, confirmed against FetchXML Builder's
 *  own LinkEntity type (also plain free-text from/to fields). */
function translateComplexSelect(ast: SelectAst): { entityLogicalName: string; fetchXml: string; warnings: string[] } {
  const warnings: string[] = [];
  if (!ast.from || ast.from.length === 0 || !ast.from[0].table) {
    throw new Error("无法识别 FROM 子句中的表名。");
  }
  const root = ast.from[0];
  if (root.join) throw new Error("FROM 子句的第一个表不应该带 JOIN 关键字。");
  const rootEntity = root.table!;
  const rootAlias = root.as ?? rootEntity;

  const rootAttributes: FxAttribute[] = [];
  const rootLinks: FxLink[] = [];
  const attrTargets = new Map<string, FxAttribute[]>([[rootAlias, rootAttributes]]);
  const linkByAlias = new Map<string, FxLink>();

  for (const f of ast.from.slice(1)) {
    if (!f.table) throw new Error("JOIN 子句缺少表名。");
    if (!f.join) throw new Error(`FROM 子句里的表 "${f.table}" 前面缺少 JOIN 关键字（暂不支持逗号并列多表）。`);
    const linkType = resolveLinkType(f.join);
    const joinAlias = f.as ?? f.table;
    if (attrTargets.has(joinAlias)) throw new Error(`表别名 "${joinAlias}" 重复。`);
    if (!f.on || f.on.operator !== "=" || !f.on.left || !f.on.right) {
      throw new Error(`JOIN ${f.table} 的 ON 条件只支持单个等值判断（如 a.col = b.col）。`);
    }

    const leftRef = parseColumnRef(f.on.left);
    const rightRef = parseColumnRef(f.on.right);
    if (!leftRef.table || !rightRef.table) {
      throw new Error(`JOIN ${f.table} 的 ON 条件两侧字段都必须带表别名前缀（如 a.col = b.col）。`);
    }

    let outerAlias: string;
    let outerAttr: string;
    let newAttr: string;
    if (leftRef.table === joinAlias && attrTargets.has(rightRef.table)) {
      outerAlias = rightRef.table;
      outerAttr = rightRef.column;
      newAttr = leftRef.column;
    } else if (rightRef.table === joinAlias && attrTargets.has(leftRef.table)) {
      outerAlias = leftRef.table;
      outerAttr = leftRef.column;
      newAttr = rightRef.column;
    } else {
      throw new Error(`JOIN ${f.table} 的 ON 条件必须引用 "${joinAlias}" 本身和一个已经出现过的表别名。`);
    }

    const newLink: FxLink = {
      name: f.table,
      alias: joinAlias,
      from: newAttr,
      to: outerAttr,
      linkType,
      attributes: [],
      filter: null,
      links: [],
    };
    if (outerAlias === rootAlias) rootLinks.push(newLink);
    else linkByAlias.get(outerAlias)!.links.push(newLink);

    attrTargets.set(joinAlias, newLink.attributes);
    linkByAlias.set(joinAlias, newLink);
  }

  const knownAliases = new Set(attrTargets.keys());

  const groupBySet = new Set<string>();
  if (ast.groupby) {
    for (const g of ast.groupby.columns) {
      const ref = parseColumnRef(g);
      const alias = ref.table ?? rootAlias;
      if (!attrTargets.has(alias)) throw new Error(`GROUP BY 引用了未知的表别名 "${ref.table}"。`);
      groupBySet.add(`${alias}.${ref.column}`);
    }
  }

  if (typeof ast.columns === "string" || ast.columns.some((c) => isStar(c.expr))) {
    throw new Error("使用 JOIN / GROUP BY / 聚合函数时不支持 SELECT *，请显式列出字段。");
  }
  const hasAggregate = ast.columns.some((c) => c.expr.type === "aggr_func");
  const needsGrouping = hasAggregate || !!ast.groupby;

  const selectedKeys = new Set<string>();
  for (const c of ast.columns) {
    const expr = c.expr;

    if (expr.type === "aggr_func") {
      const fnName = (expr.name ?? "").toUpperCase();
      const argsExpr = expr.args?.expr;
      if (!argsExpr) throw new Error(`聚合函数 "${expr.name}" 缺少参数。`);

      let target: FxAttribute[];
      let attrName: string;
      let aggFunc: FxAggregateFunc;

      if (fnName === "COUNT" && isStar(argsExpr)) {
        target = rootAttributes;
        attrName = guessPrimaryIdAttribute(rootEntity);
        aggFunc = "count";
        warnings.push(
          `COUNT(*) 假设 ${rootEntity} 的主键字段名为 "${attrName}"（Dataverse 惯例：{实体名}+id），如果这个实体的主键不是这个格式，请手动修改生成的 FetchXML。`,
        );
      } else if (fnName === "COUNT" || fnName === "SUM" || fnName === "AVG" || fnName === "MIN" || fnName === "MAX") {
        if (argsExpr.type !== "column_ref") throw new Error(`${fnName}(...) 里只支持字段名，不支持表达式。`);
        const ref = parseColumnRef(argsExpr);
        const refAlias = ref.table ?? rootAlias;
        const t = attrTargets.get(refAlias);
        if (!t) throw new Error(`${fnName}(${ref.column}) 引用了未知的表别名 "${ref.table}"。`);
        target = t;
        attrName = ref.column;
        aggFunc = fnName === "COUNT" ? "countcolumn" : (fnName.toLowerCase() as FxAggregateFunc);
      } else {
        throw new Error(`不支持的聚合函数 "${expr.name}"（只支持 COUNT / SUM / AVG / MIN / MAX）。`);
      }

      const alias = c.as ?? `${aggFunc}_${attrName}`;
      target.push({ name: attrName, aggregate: aggFunc, alias });
      continue;
    }

    if (expr.type !== "column_ref") {
      throw new Error("SELECT 列表暂不支持除聚合函数外的表达式，只支持字段名。");
    }
    const ref = parseColumnRef(expr);
    const alias = ref.table ?? rootAlias;
    const target = attrTargets.get(alias);
    if (!target) throw new Error(`SELECT 列表引用了未知的表别名 "${ref.table}"。`);
    const key = `${alias}.${ref.column}`;
    const isGrouped = groupBySet.has(key);
    if (needsGrouping && !isGrouped) {
      throw new Error(`字段 "${ref.table ? ref.table + "." : ""}${ref.column}" 既不是聚合函数，也没有出现在 GROUP BY 里。`);
    }
    target.push({ name: ref.column, groupby: isGrouped || undefined });
    selectedKeys.add(key);
  }

  for (const key of groupBySet) {
    if (!selectedKeys.has(key)) {
      throw new Error(`GROUP BY 用到的字段 "${key}" 没有出现在 SELECT 列表中（暂不支持隐式分组字段）。`);
    }
  }

  if (ast.having) {
    throw new Error("暂不支持 HAVING（FetchXML 没有干净的聚合后过滤等价物），请去掉 HAVING 条件。");
  }

  const filter = ast.where ? translateFetchXmlFilter(ast.where, knownAliases, rootAlias) : null;

  const orders: FxOrder[] = [];
  if (ast.orderby) {
    for (const o of ast.orderby) {
      const ref = parseColumnRef(o.expr);
      if (ref.table && ref.table !== rootAlias) {
        throw new Error(`ORDER BY 暂不支持引用 JOIN 进来的表的字段（"${ref.table}.${ref.column}"），请只对根表字段排序。`);
      }
      orders.push({ attribute: ref.column, descending: o.type === "DESC" });
    }
  }

  const query: FxQuery = {
    entityName: rootEntity,
    attributes: rootAttributes,
    aggregate: needsGrouping,
    distinct: !!ast.distinct,
    top: ast.top ? String(ast.top.value) : null,
    filter,
    links: rootLinks,
    orders,
  };

  return { entityLogicalName: rootEntity, fetchXml: serializeFetchXml(query), warnings };
}

function parseSelect(ast: SelectAst): ParsedStatement {
  if (!ast.from || ast.from.length === 0) {
    return { kind: "error", error: "无法识别 FROM 子句中的表名。" };
  }

  const isComplex =
    !!ast.groupby ||
    ast.from.some((f) => f.join) ||
    (typeof ast.columns !== "string" && ast.columns.some((c) => c.expr.type === "aggr_func"));

  if (isComplex) {
    try {
      const { entityLogicalName, fetchXml, warnings } = translateComplexSelect(ast);
      return { kind: "select-complex", entityLogicalName, entitySetGuess: naivePluralize(entityLogicalName), fetchXml, warnings };
    } catch (err) {
      return { kind: "error", error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (ast.from.length !== 1 || ast.from[0].join) {
    return { kind: "error", error: "当前只支持单表查询，检测到 JOIN 或多个表（暂不支持）。" };
  }
  if (ast.distinct) {
    return { kind: "error", error: "暂不支持 DISTINCT。" };
  }
  const entityLogicalName = ast.from[0].table ?? null;
  if (!entityLogicalName) {
    return { kind: "error", error: "无法识别 FROM 子句中的表名。" };
  }

  const warnings: string[] = [];
  try {
    const select = translateSelectColumns(ast.columns);
    const filter = ast.where ? translateWhere(ast.where, warnings) : null;
    const orderby = translateOrderBy(ast.orderby);
    const top = ast.top ? String(ast.top.value) : null;

    return {
      kind: "select-simple",
      entityLogicalName,
      entitySetGuess: naivePluralize(entityLogicalName),
      select,
      filter,
      orderby,
      top,
      warnings,
    };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

function parseInsert(ast: InsertAst): ParsedStatement {
  const table = ast.table?.[0]?.table;
  if (!table) return { kind: "error", error: "无法识别 INSERT INTO 的表名。" };
  if (!ast.columns || ast.columns.length === 0) {
    return {
      kind: "error",
      error: "INSERT 必须显式列出字段名（INSERT INTO table (col1, col2, ...) VALUES (...)），不支持省略字段列表。",
    };
  }
  const columns = ast.columns;

  try {
    const rows = ast.values.values.map((tuple, i) => {
      if (tuple.value.length !== columns.length) {
        throw new Error(`第 ${i + 1} 行 VALUES 的值数量（${tuple.value.length}）和字段数量（${columns.length}）不一致。`);
      }
      return tuple.value;
    });
    return {
      kind: "insert",
      entityLogicalName: table,
      entitySetGuess: naivePluralize(table),
      columns,
      rows,
      warnings: [],
    };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

function parseUpdate(ast: UpdateAst): ParsedStatement {
  const table = ast.table?.[0]?.table;
  if (!table) return { kind: "error", error: "无法识别 UPDATE 的表名。" };
  if (ast.table.length > 1) return { kind: "error", error: "暂不支持一次 UPDATE 多个表。" };
  if (!ast.set || ast.set.length === 0) return { kind: "error", error: "UPDATE 必须至少有一个 SET 字段。" };
  for (const s of ast.set) {
    if (s.table) {
      return { kind: "error", error: `SET 子句不支持表别名前缀（"${s.table}.${s.column}"）。` };
    }
  }
  if (!ast.where) {
    return {
      kind: "error",
      error: "UPDATE 必须带 WHERE 子句（不支持不写 WHERE 更新整张表；如果确实要更新全表，请自己写一个恒真条件，例如 WHERE statecode >= 0）。",
    };
  }

  const warnings: string[] = [];
  try {
    const filter = translateWhere(ast.where, warnings);
    return {
      kind: "mutate",
      action: "update",
      entityLogicalName: table,
      entitySetGuess: naivePluralize(table),
      filter,
      setClauses: ast.set.map((s) => ({ column: s.column, value: s.value })),
      warnings,
    };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

function parseDelete(ast: DeleteAst): ParsedStatement {
  const fromList = ast.from ?? ast.table ?? [];
  const table = fromList[0]?.table;
  if (!table) return { kind: "error", error: "无法识别 DELETE FROM 的表名。" };
  if (fromList.length > 1) return { kind: "error", error: "暂不支持一次 DELETE 多个表。" };
  if (!ast.where) {
    return {
      kind: "error",
      error: "DELETE 必须带 WHERE 子句（不支持不写 WHERE 删除整张表；如果确实要清空整张表，请自己写一个恒真条件，例如 WHERE statecode >= 0）。",
    };
  }

  const warnings: string[] = [];
  try {
    const filter = translateWhere(ast.where, warnings);
    return {
      kind: "mutate",
      action: "delete",
      entityLogicalName: table,
      entitySetGuess: naivePluralize(table),
      filter,
      warnings,
    };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

export function parseSql(sql: string): ParsedStatement {
  if (!sql.trim()) return { kind: "empty" };

  const parser = new Parser();
  let ast: { type: string };
  try {
    ast = parser.astify(sql, { database: "transactsql" }) as unknown as { type: string };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }

  if (ast.type === "select") return parseSelect(ast as unknown as SelectAst);
  if (ast.type === "insert") return parseInsert(ast as unknown as InsertAst);
  if (ast.type === "update") return parseUpdate(ast as unknown as UpdateAst);
  if (ast.type === "delete") return parseDelete(ast as unknown as DeleteAst);
  return { kind: "error", error: `不支持的语句类型 "${ast.type.toUpperCase()}"（只支持 SELECT / INSERT / UPDATE / DELETE）。` };
}
