// Each id costs ~45 characters once translated into the OData In(...) filter of a GET URL; 100 per
// statement keeps the request URL well inside what the Web API accepts.
const IDS_PER_STATEMENT = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function idList(ids: string[]): string {
  return ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
}

/** SELECTs that re-read records a Data Copy / Data Edit run just created, for the temporary Data
 *  Migration tab (Requirements/9.15 #3). One statement per 100 ids; empty when `ids` is. */
export function selectCreatedRecordsSql(entityLogicalName: string, primaryIdAttribute: string, ids: string[]): string[] {
  return chunk(ids, IDS_PER_STATEMENT).map(
    (part) => `select * from ${entityLogicalName} where ${primaryIdAttribute} in (${idList(part)})`,
  );
}

/** SELECTs that re-read just the columns a Data Edit run updated, for the records it updated. */
export function selectUpdatedRecordsSql(
  entityLogicalName: string,
  primaryIdAttribute: string,
  columns: string[],
  ids: string[],
): string[] {
  if (columns.length === 0) return [];
  return chunk(ids, IDS_PER_STATEMENT).map(
    (part) => `select ${columns.join(",")} from ${entityLogicalName} where ${primaryIdAttribute} in (${idList(part)})`,
  );
}

/** Appends `statements` to the editor text, one per line, each terminated with `;`. */
export function appendSqlStatements(existing: string, statements: string[]): string {
  const added = statements.map((s) => `${s};`).join("\n");
  const trimmed = existing.trimEnd();
  if (!trimmed) return added;
  return `${trimmed.endsWith(";") ? trimmed : `${trimmed};`}\n${added}`;
}
