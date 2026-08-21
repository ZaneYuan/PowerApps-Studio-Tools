/** OData single-quote escaping for a string literal embedded in a `$filter` expression (e.g.
 *  inside `contains(name,'...')`) — doubling `'` is the only escaping OData string literals need.
 *  Shared so every tool building a `contains()`/`eq`-style filter from user-typed search text uses
 *  the exact same rule instead of each keeping its own private copy. */
export function escapeODataString(v: string): string {
  return v.replace(/'/g, "''");
}

/** Dataverse returns a Lookup/Customer/Owner column as `_logicalname_value` (plus `@...`
 *  annotation keys alongside it, e.g. `_x_value@OData.Community.Display.V1.FormattedValue`) —
 *  unwrap every row to plain attribute names so a result table shows the same field names a user
 *  would write in a query, not the raw OData JSON convention. Shared so every tool rendering
 *  Dataverse query results uses one implementation instead of independently-drifting copies. */
export function unwrapODataRow(row: Record<string, unknown>): Record<string, unknown> {
  const unwrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.includes("@")) continue;
    const plain = key.startsWith("_") && key.endsWith("_value") ? key.slice(1, -"_value".length) : key;
    unwrapped[plain] = value;
  }
  return unwrapped;
}
