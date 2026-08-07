// Import the T-SQL-only build instead of the top-level package — the latter bundles every
// supported dialect's grammar (MySQL, PostgreSQL, BigQuery, ...) into one ~2.4MB chunk even
// though we only ever parse transactsql.
import pkg from "node-sql-parser/build/transactsql";
const { Parser } = pkg;

const GUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Minimal shape of the bits of node-sql-parser's AST this translator actually reads —
 *  the library's own types are broad unions that don't narrow well, so we describe just
 *  what we use and validate everything else explicitly rather than trusting `any`. */
interface SqlNode {
  type: string;
  value?: unknown;
  operator?: string;
  left?: SqlNode;
  right?: SqlNode;
  table?: string | null;
  column?: string;
}

interface ColumnItem {
  expr: SqlNode;
}

interface FromItem {
  table?: string;
  join?: string;
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
  groupby: unknown;
  distinct: unknown;
  top: { value: number } | null;
  orderby: OrderByItem[] | null;
}

export interface TranslationResult {
  entityLogicalName: string | null;
  entitySetGuess: string | null;
  select: string | null;
  filter: string | null;
  orderby: string | null;
  top: string | null;
  warnings: string[];
  error: string | null;
}

const COMPARISON_OPERATORS: Record<string, string> = {
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

function columnName(node: SqlNode): string {
  if (node.type !== "column_ref" || !node.column) {
    throw new Error("这里必须是一个字段名");
  }
  if (node.table) {
    throw new Error(`不支持带表别名的字段引用 "${node.table}.${node.column}"（当前只支持单表查询）`);
  }
  return node.column;
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

export function translateSql(sql: string): TranslationResult {
  const empty: TranslationResult = {
    entityLogicalName: null,
    entitySetGuess: null,
    select: null,
    filter: null,
    orderby: null,
    top: null,
    warnings: [],
    error: null,
  };

  if (!sql.trim()) return empty;

  const parser = new Parser();
  let ast: SelectAst;
  try {
    ast = parser.astify(sql, { database: "transactsql" }) as unknown as SelectAst;
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }

  if (ast.type !== "select") {
    return { ...empty, error: `只支持只读 SELECT 语句，检测到 "${ast.type.toUpperCase()}"。` };
  }
  if (!ast.from || ast.from.length !== 1 || ast.from[0].join) {
    return { ...empty, error: "当前只支持单表查询，检测到 JOIN 或多个表（暂不支持）。" };
  }
  if (ast.groupby) {
    return { ...empty, error: "暂不支持 GROUP BY。" };
  }
  if (ast.distinct) {
    return { ...empty, error: "暂不支持 DISTINCT。" };
  }

  const entityLogicalName = ast.from[0].table ?? null;
  if (!entityLogicalName) {
    return { ...empty, error: "无法识别 FROM 子句中的表名。" };
  }

  const warnings: string[] = [];
  try {
    const select = translateSelectColumns(ast.columns);
    const filter = ast.where ? translateWhere(ast.where, warnings) : null;
    const orderby = translateOrderBy(ast.orderby);
    const top = ast.top ? String(ast.top.value) : null;

    return {
      entityLogicalName,
      entitySetGuess: naivePluralize(entityLogicalName),
      select,
      filter,
      orderby,
      top,
      warnings,
      error: null,
    };
  } catch (err) {
    return { ...empty, entityLogicalName, error: err instanceof Error ? err.message : String(err) };
  }
}
