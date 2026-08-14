/** OData single-quote escaping for a string literal embedded in a `$filter` expression (e.g.
 *  inside `contains(name,'...')`) — doubling `'` is the only escaping OData string literals need.
 *  Shared so every tool building a `contains()`/`eq`-style filter from user-typed search text uses
 *  the exact same rule instead of each keeping its own private copy. */
export function escapeODataString(v: string): string {
  return v.replace(/'/g, "''");
}
