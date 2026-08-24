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
 *  Dataverse query results uses one implementation instead of independently-drifting copies. Just
 *  the `fields` half of unwrapODataRowWithFormatting below — callers that never asked for
 *  `includeFormattedValues` (so there are no annotations to keep anyway) can keep using this
 *  simpler shape unchanged. */
export function unwrapODataRow(row: Record<string, unknown>): Record<string, unknown> {
  return unwrapODataRowWithFormatting(row).fields;
}

/** Same unwrapping as unwrapODataRow, but also keeps each column's `...@OData.Community.Display.
 *  V1.FormattedValue` annotation (the human-readable label Dataverse sends alongside a Lookup's
 *  GUID or an OptionSet's numeric code) instead of discarding it — only present at all when the
 *  request that produced `row` asked for it via `includeFormattedValues: true` (see
 *  DataverseApiClient.cs's own `Prefer: odata.include-annotations=...`). `fields` is exactly what
 *  a submit/write payload should use (the raw value); `formattedFields` is display-only, keyed by
 *  the same plain attribute name. Same annotation-splitting shape record-merge/dataverseOps.ts's
 *  own (private, unrelated call site) unwrapAnnotatedRecord already used — this is the shared,
 *  reusable version every grid-rendering tool now builds on instead of each keeping its own. */
export function unwrapODataRowWithFormatting(row: Record<string, unknown>): {
  fields: Record<string, unknown>;
  formattedFields: Record<string, string>;
} {
  const fields: Record<string, unknown> = {};
  const formattedFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.includes("@")) {
      const [rawBaseKey, annotation] = key.split("@");
      const baseKey = rawBaseKey.startsWith("_") && rawBaseKey.endsWith("_value") ? rawBaseKey.slice(1, -"_value".length) : rawBaseKey;
      if (annotation === "OData.Community.Display.V1.FormattedValue" && typeof value === "string") formattedFields[baseKey] = value;
      continue;
    }
    const plain = key.startsWith("_") && key.endsWith("_value") ? key.slice(1, -"_value".length) : key;
    fields[plain] = value;
  }
  return { fields, formattedFields };
}
