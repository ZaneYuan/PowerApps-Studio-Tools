import { fetchEntityMeta } from "../../native/metadataService";
import { literalToJsValue, type InsertResult, type MutateResult, type SqlNode } from "./translate";

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** Non-anchored, global — for pulling every GUID-shaped substring out of a MutateResult's
 *  already-rendered $filter text. `IN(...)` renders each value quoted (translateWhere's IN
 *  branch always calls quoteString, unlike the eq/ne/... branch which leaves an unquoted GUID
 *  alone) — harmless here since `'` isn't part of this character class, so the GUID substring
 *  still extracts cleanly either way. */
const GUID_SCAN_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

export interface OrderedStatement {
  statement: InsertResult | MutateResult;
  /** Index into the original, as-parsed statements array. */
  originalIndex: number;
  /** Only set for an INSERT whose own rows reference each other's primary key (e.g.
   *  `product.parentproductid` pointing at another row in the same multi-row VALUES) — original
   *  row indices in dependency-safe order. Absent for every statement without such a self-
   *  reference, which is the overwhelming majority. */
  rowOrder?: number[];
  /** Set instead of rowOrder when this statement's own rows have an unresolvable mutual
   *  reference — blocks execution the same way a statement-level cycleError does. */
  rowCycleError?: string;
}

export interface DependencyOrderResult {
  ordered: OrderedStatement[];
  /** True if execution order differs from parse order at either the statement or row level —
   *  drives the "已按依赖关系自动排序" UI note. */
  reordered: boolean;
  /** Statement-level circular dependency — set instead of a usable order; UI should block
   *  execution entirely rather than run a partial/best-effort order. */
  cycleError: string | null;
}

interface Creator {
  statementIndex: number;
  rowIndex: number;
}

function describeForError(stmt: InsertResult | MutateResult): string {
  return stmt.kind === "insert" ? `INSERT INTO ${stmt.entityLogicalName}` : `${stmt.action.toUpperCase()} ${stmt.entityLogicalName}`;
}

/** Dependency scanning runs eagerly on every literal in the batch, before the user has clicked
 *  "执行全部" — a malformed literal anywhere shouldn't break the whole ordering pass (and hence
 *  the batch preview) before that point. Treated as "not a GUID, no edge"; the real error still
 *  surfaces later at actual execution time via the existing per-row try/catch in handleBatch. */
function tryStringLiteral(node: SqlNode): string | null {
  try {
    const value = literalToJsValue(node);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Finds, for every INSERT statement, which row (if any) creates a record with a given literal
 *  GUID as its own primary key — the "supply" side every dependency edge points at. Only
 *  entities whose metadata actually resolved are considered (a typo'd table name simply
 *  contributes no creator entries instead of failing the whole pass — the real error surfaces at
 *  execution time the same way it always has). */
function registerCreators(
  statements: (InsertResult | MutateResult)[],
  primaryIdByEntity: Map<string, string>,
): Map<string, Creator> {
  const creators = new Map<string, Creator>();
  statements.forEach((stmt, statementIndex) => {
    if (stmt.kind !== "insert") return;
    const pkAttr = primaryIdByEntity.get(stmt.entityLogicalName.toLowerCase());
    if (!pkAttr) return;
    const pkIndex = stmt.columns.findIndex((c) => c.toLowerCase() === pkAttr.toLowerCase());
    if (pkIndex === -1) return;
    stmt.rows.forEach((row, rowIndex) => {
      const raw = tryStringLiteral(row[pkIndex]);
      if (!raw || !GUID_RE.test(raw)) return;
      const key = raw.toLowerCase();
      // First-write-wins: a real duplicate primary key is a bug Dataverse will reject at write
      // time regardless — this just keeps the dependency graph pointing at the first (more
      // likely intended) creator instead of silently flipping to whichever duplicate came later.
      if (!creators.has(key)) creators.set(key, { statementIndex, rowIndex });
    });
  });
  return creators;
}

interface Graph {
  /** statementIndex -> set of statementIndex it must run after. */
  statementDeps: Map<number, Set<number>>;
  /** statementIndex -> (rowIndex -> set of rowIndex, within that same statement, it must run
   *  after) — only populated for INSERTs with an intra-statement self-reference. */
  rowDeps: Map<number, Map<number, Set<number>>>;
}

function buildGraph(statements: (InsertResult | MutateResult)[], creators: Map<string, Creator>): Graph {
  const statementDeps = new Map<number, Set<number>>();
  const rowDeps = new Map<number, Map<number, Set<number>>>();

  function addStatementEdge(from: number, to: number) {
    if (from === to) return;
    if (!statementDeps.has(from)) statementDeps.set(from, new Set());
    statementDeps.get(from)!.add(to);
  }
  function addRowEdge(statementIndex: number, fromRow: number, toRow: number) {
    if (fromRow === toRow) return;
    if (!rowDeps.has(statementIndex)) rowDeps.set(statementIndex, new Map());
    const perRow = rowDeps.get(statementIndex)!;
    if (!perRow.has(fromRow)) perRow.set(fromRow, new Set());
    perRow.get(fromRow)!.add(toRow);
  }
  function considerGuid(raw: string, statementIndex: number, rowIndex: number | null) {
    const creator = creators.get(raw.toLowerCase());
    if (!creator) return;
    if (creator.statementIndex !== statementIndex) {
      addStatementEdge(statementIndex, creator.statementIndex);
    } else if (rowIndex !== null && creator.rowIndex !== rowIndex) {
      addRowEdge(statementIndex, rowIndex, creator.rowIndex);
    }
  }

  statements.forEach((stmt, statementIndex) => {
    if (stmt.kind === "insert") {
      stmt.rows.forEach((row, rowIndex) => {
        for (const node of row) {
          const raw = tryStringLiteral(node);
          if (raw && GUID_RE.test(raw)) considerGuid(raw, statementIndex, rowIndex);
        }
      });
    } else {
      for (const match of stmt.filter.match(GUID_SCAN_RE) ?? []) {
        considerGuid(match, statementIndex, null);
      }
      for (const setClause of stmt.setClauses ?? []) {
        const raw = tryStringLiteral(setClause.value);
        if (raw && GUID_RE.test(raw)) considerGuid(raw, statementIndex, null);
      }
    }
  });

  return { statementDeps, rowDeps };
}

type TopoSortResult = { order: number[] } | { remaining: Set<number> };

/** Kahn's algorithm over integer node ids `0..nodeCount-1`. Among nodes with every dependency
 *  already satisfied, always picks the smallest id next — keeps the result as close to the
 *  original order as the real dependencies allow, instead of an arbitrary valid order, so
 *  statements/rows with no dependency relationship stay where the user put them. */
function topoSort(nodeCount: number, deps: Map<number, Set<number>>): TopoSortResult {
  const indegree = new Array(nodeCount).fill(0);
  const dependents: Set<number>[] = Array.from({ length: nodeCount }, () => new Set());
  for (let n = 0; n < nodeCount; n++) {
    for (const dep of deps.get(n) ?? []) {
      indegree[n]++;
      dependents[dep].add(n);
    }
  }

  const remaining = new Set<number>(Array.from({ length: nodeCount }, (_, i) => i));
  const order: number[] = [];
  while (remaining.size > 0) {
    let next = -1;
    for (const n of remaining) {
      if (indegree[n] === 0 && (next === -1 || n < next)) next = n;
    }
    if (next === -1) return { remaining };
    remaining.delete(next);
    order.push(next);
    for (const dependent of dependents[next]) indegree[dependent]--;
  }
  return { order };
}

/** Finds one concrete cycle among the nodes topoSort couldn't resolve, for a readable error
 *  message — DFS with a recursion-stack check, restricted to `remaining` (nodes outside the
 *  unresolved subgraph can't be part of the cycle that's blocking it). */
function findCyclePath(remaining: Set<number>, deps: Map<number, Set<number>>): number[] {
  const visited = new Set<number>();
  const stack: number[] = [];
  const onStack = new Set<number>();

  function dfs(node: number): number[] | null {
    visited.add(node);
    stack.push(node);
    onStack.add(node);
    for (const dep of deps.get(node) ?? []) {
      if (!remaining.has(dep)) continue;
      if (onStack.has(dep)) return stack.slice(stack.indexOf(dep)).concat(dep);
      if (!visited.has(dep)) {
        const found = dfs(dep);
        if (found) return found;
      }
    }
    stack.pop();
    onStack.delete(node);
    return null;
  }

  for (const n of remaining) {
    if (!visited.has(n)) {
      const found = dfs(n);
      if (found) return found;
    }
  }
  return Array.from(remaining);
}

const STATEMENT_CYCLE_HINT =
  "请仿照“先插入时把导致循环的那个字段留空/NULL，等目标表插完之后再单独用一条 UPDATE 回填”的方式拆开这两条语句。";
const ROW_CYCLE_HINT =
  "请把其中一行的这个字段留空/NULL 单独插入，等另一行插入完成后再用一条 UPDATE 回填该字段。";

/** Analyzes a batch's INSERT/UPDATE/DELETE statements for cross-statement (and, for a single
 *  INSERT's own multiple rows, intra-statement) GUID dependencies — e.g. a Lookup column's
 *  literal value in one statement being exactly the primary-key literal another statement is
 *  about to create — and reorders them into a dependency-safe execution sequence. Purely static
 *  literal matching, not a live capture-and-substitute of server-generated ids: a statement that
 *  omits its own primary-key column (letting Dataverse generate one) can never be a known
 *  "creator" for downstream matching, since there's no literal to match against — consistent
 *  with how this tool's own generated INSERTs (data-migration's buildInsertSql) and hand-written
 *  migration scripts both always write an explicit primary-key literal. */
export async function orderStatementsByDependency(
  connectionId: string,
  statements: (InsertResult | MutateResult)[],
): Promise<DependencyOrderResult> {
  const distinctEntities = Array.from(new Set(statements.filter((s) => s.kind === "insert").map((s) => s.entityLogicalName)));
  const metaResults = await Promise.allSettled(distinctEntities.map((e) => fetchEntityMeta(connectionId, e)));
  const primaryIdByEntity = new Map<string, string>();
  metaResults.forEach((res, i) => {
    if (res.status === "fulfilled") primaryIdByEntity.set(distinctEntities[i].toLowerCase(), res.value.primaryIdAttribute);
  });

  const creators = registerCreators(statements, primaryIdByEntity);
  const graph = buildGraph(statements, creators);

  const statementSort = topoSort(statements.length, graph.statementDeps);
  if ("remaining" in statementSort) {
    const cycle = findCyclePath(statementSort.remaining, graph.statementDeps);
    const path = cycle.map((i) => `第 ${i + 1} 条（${describeForError(statements[i])}）`).join(" → ");
    return {
      ordered: statements.map((s, i) => ({ statement: s, originalIndex: i })),
      reordered: false,
      cycleError: `检测到循环依赖，无法确定安全的执行顺序：${path}。${STATEMENT_CYCLE_HINT}`,
    };
  }

  const ordered: OrderedStatement[] = statementSort.order.map((originalIndex) => {
    const stmt = statements[originalIndex];
    const os: OrderedStatement = { statement: stmt, originalIndex };
    const rowDep = stmt.kind === "insert" ? graph.rowDeps.get(originalIndex) : undefined;
    if (stmt.kind === "insert" && rowDep && rowDep.size > 0) {
      const rowSort = topoSort(stmt.rows.length, rowDep);
      if ("remaining" in rowSort) {
        const cycle = findCyclePath(rowSort.remaining, rowDep);
        os.rowCycleError = `"${stmt.entityLogicalName}" 这条 INSERT 内部的第 ${cycle.map((r) => r + 1).join(" 行 → 第 ")} 行之间存在循环依赖，同一条语句内部的行没法靠重新排序解决。${ROW_CYCLE_HINT}`;
      } else {
        os.rowOrder = rowSort.order;
      }
    }
    return os;
  });

  const statementsMoved = ordered.some((os, i) => os.originalIndex !== i);
  const rowsMoved = ordered.some((os) => os.rowOrder?.some((idx, i) => idx !== i));
  return { ordered, reordered: statementsMoved || rowsMoved, cycleError: null };
}
