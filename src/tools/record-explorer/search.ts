import { FIELD_MATCH_BLACKLIST, type RecordSnapshot } from "./types";

/** Field logical names whose value contains `searchText` (case-insensitive substring), used to
 *  drive both visibility filtering and the yellow-highlight rendering. Empty `searchText`
 *  yields an empty set — callers treat that as "no filtering, no highlighting" rather than
 *  matching everything. */
export function matchedFields(snapshot: RecordSnapshot, searchText: string): Set<string> {
  const query = searchText.trim().toLowerCase();
  const matched = new Set<string>();
  if (!query) return matched;

  for (const [field, value] of Object.entries(snapshot.fields)) {
    if (FIELD_MATCH_BLACKLIST.has(field)) continue;
    if (value === null || value === undefined) continue;
    if (String(value).toLowerCase().includes(query)) matched.add(field);
  }
  return matched;
}

export function recordMatches(snapshot: RecordSnapshot, searchText: string): boolean {
  return matchedFields(snapshot, searchText).size > 0;
}
