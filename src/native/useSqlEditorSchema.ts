import { useEffect, useMemo, useState } from "react";
import { fetchAttributes, fetchEntityList } from "./metadataService";
import { guessEditingTable, scanReferencedTables } from "../tools/sql4cds/translate";

export interface SqlEditorSchemaResult {
  /** table (entity logical name) -> known column (attribute logical name) list, "[]" for a table
   *  whose columns haven't been fetched yet — still enough for table-name completion. Pass
   *  straight through to SqlEditor's `schema` prop. */
  schema: Record<string, string[]>;
  /** The entity currently in FROM/INTO/UPDATE, if any — pass straight through to SqlEditor's
   *  `defaultTable` prop so its own columns complete without a table-name prefix. */
  defaultTable?: string;
}

/** Powers a `SqlEditor`'s table/column-name autocomplete against a live connection: every entity
 *  logical name (for table-name completion, fetched once per connection) plus the columns of every
 *  table the statement names after FROM/JOIN/UPDATE/INTO (fetched lazily as they appear) — both via
 *  metadataService's existing caches, so switching between tables already visited in this session
 *  is instant. The default table comes from `guessEditingTable` (a lenient re-parse) and falls back
 *  to the first scanned table name when the SQL doesn't parse yet, so column completion stays
 *  available while a clause is still mid-edit, which is exactly when it's wanted most.
 *
 *  Originally built inline in SQL4CDS (`Sql4Cds.tsx`); extracted so every tool with a `SqlEditor`
 *  against a real connection — Data Copy, Data Migration — gets the same completion instead of
 *  each wiring its own copy (or passing `schema={{}}` and getting keyword-only completion). */
export function useSqlEditorSchema(connectionId: string | null, sql: string): SqlEditorSchemaResult {
  const parsedTable = useMemo(() => guessEditingTable(sql), [sql]);
  const scannedTables = useMemo(() => scanReferencedTables(sql), [sql]);
  const [tables, setTables] = useState<string[]>([]);
  const [columns, setColumns] = useState<Record<string, string[]>>({});

  // JOINed tables need their columns too, so `alias.` completes; the scan also covers SQL that
  // doesn't parse yet (a half-typed clause), where guessEditingTable gives up.
  const referencedTables = useMemo(() => {
    const known = new Set(tables);
    return scannedTables.filter((t) => known.has(t));
  }, [scannedTables, tables]);
  const editingTable = parsedTable ?? referencedTables[0] ?? null;
  const tablesNeedingColumns = [editingTable, ...referencedTables]
    .filter((t): t is string => !!t && !columns[t])
    .filter((t, i, all) => all.indexOf(t) === i);
  const tablesNeedingColumnsKey = tablesNeedingColumns.join(",");

  useEffect(() => {
    if (!connectionId) {
      setTables([]);
      return;
    }
    let cancelled = false;
    fetchEntityList(connectionId)
      .then((names) => {
        if (!cancelled) setTables(names);
      })
      .catch(() => {
        if (!cancelled) setTables([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || !tablesNeedingColumnsKey) return;
    let cancelled = false;
    for (const table of tablesNeedingColumnsKey.split(",")) {
      fetchAttributes(connectionId, table)
        .then((attrs) => {
          if (!cancelled) setColumns((prev) => ({ ...prev, [table]: attrs.map((a) => a.logicalName) }));
        })
        .catch(() => {
          /* autocomplete is best-effort — just falls back to the bare table name with no columns */
        });
    }
    return () => {
      cancelled = true;
    };
  }, [connectionId, tablesNeedingColumnsKey]);

  const schema = useMemo(() => {
    const s: Record<string, string[]> = {};
    for (const table of tables) s[table] = columns[table] ?? [];
    if (editingTable && !s[editingTable]) s[editingTable] = columns[editingTable] ?? [];
    return s;
  }, [tables, columns, editingTable]);

  return { schema, defaultTable: editingTable ?? undefined };
}
