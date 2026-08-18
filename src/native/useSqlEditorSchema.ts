import { useEffect, useMemo, useState } from "react";
import { fetchAttributes, fetchEntityList } from "./metadataService";
import { guessEditingTable } from "../tools/sql4cds/translate";

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
 *  logical name (for table-name completion, fetched once per connection) plus the current
 *  statement's table's columns (fetched lazily as the FROM/INTO/UPDATE table becomes known) —
 *  both via metadataService's existing caches, so switching between tables already visited in
 *  this session is instant. Uses `guessEditingTable` (a lenient re-parse — only needs the SQL to
 *  be syntactically valid, not translatable) rather than a strict full-statement parse, so column
 *  completion stays available while a WHERE/SET clause is still mid-edit, which is exactly when
 *  it's wanted most.
 *
 *  Originally built inline in SQL4CDS (`Sql4Cds.tsx`); extracted so every tool with a `SqlEditor`
 *  against a real connection — Data Copy, Data Migration — gets the same completion instead of
 *  each wiring its own copy (or passing `schema={{}}` and getting keyword-only completion). */
export function useSqlEditorSchema(connectionId: string | null, sql: string): SqlEditorSchemaResult {
  const editingTable = useMemo(() => guessEditingTable(sql), [sql]);
  const [tables, setTables] = useState<string[]>([]);
  const [columns, setColumns] = useState<Record<string, string[]>>({});

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
    if (!connectionId || !editingTable || columns[editingTable]) return;
    let cancelled = false;
    fetchAttributes(connectionId, editingTable)
      .then((attrs) => {
        if (!cancelled) setColumns((prev) => ({ ...prev, [editingTable]: attrs.map((a) => a.logicalName) }));
      })
      .catch(() => {
        /* autocomplete is best-effort — just falls back to the bare table name with no columns */
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, editingTable, columns]);

  const schema = useMemo(() => {
    const s: Record<string, string[]> = {};
    for (const table of tables) s[table] = columns[table] ?? [];
    if (editingTable && !s[editingTable]) s[editingTable] = columns[editingTable] ?? [];
    return s;
  }, [tables, columns, editingTable]);

  return { schema, defaultTable: editingTable ?? undefined };
}
