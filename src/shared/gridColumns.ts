import { fetchDateTimeFormat, fetchOptionSetValuesForType, isLookupAttributeType, isSystemAuditField } from "../native/metadataService";
import type { GridColumn } from "./CheckableGrid";

const NUMBER_ATTRIBUTE_TYPES = new Set(["Integer", "BigInt", "Decimal", "Double", "Money"]);

/** Builds one GridColumn per column name, assigning an editor for every Dataverse attribute type
 *  that has a safe, well-defined write path. Three kinds stay intentionally read-only: PartyList
 *  (an array of `{partyid, participationtypemask}` recipient objects — no single-value text/select
 *  widget can represent that safely), anything this app doesn't otherwise recognize (EntityName,
 *  ManagedProperty, or a type fetchAttributes hasn't already filtered out, like Virtual), and the
 *  entity's own primary key — its raw `Uniqueidentifier` type would otherwise get the normal text
 *  editor, but every write path in every caller (Data Edit's 更新/创建 body, Data Copy's create
 *  body, Data Migration's phase1Body/phase2Body) already strips this exact column unconditionally
 *  and instead always PATCHes/upserts at `row.id` — set once when the row loads and never touched
 *  by `handleEditCell` (which only ever writes into `row.values`). A live, focus-and-type text
 *  input on this cell was pure UI theater: it accepted keystrokes and looked like any other edit,
 *  but nothing downstream ever read the result — see Bugs/8.24.md #4.
 *
 *  Shared by every tool that renders a query result as an editable CheckableGrid (Data Copy, Data
 *  Edit, Data Migration) — this exact type→editor switch used to be copied near-verbatim into all
 *  three and had already started drifting (only Data Copy/Data Edit resolved Lookup columns to
 *  editable cells; Data Migration's own copy was otherwise identical) — one shared place instead
 *  of three to keep in sync when a new type gets an editor. */
export async function buildEditableGridColumns(
  connectionId: string,
  entityLogicalName: string,
  columnNames: string[],
  typeByName: Map<string, string>,
  primaryIdAttribute: string,
): Promise<GridColumn[]> {
  const columns: GridColumn[] = [];
  for (const name of columnNames) {
    const attrType = typeByName.get(name.toLowerCase());
    const checked = !isSystemAuditField(name);
    const base = { key: name, attributeType: attrType, checked };

    if (name.toLowerCase() === primaryIdAttribute.toLowerCase()) {
      columns.push(base);
    } else if (attrType === "String" || attrType === "Memo" || attrType === "Uniqueidentifier") {
      columns.push({ ...base, editable: true, editKind: "text" });
    } else if (attrType === "Picklist" || attrType === "State" || attrType === "Status") {
      const options = await fetchOptionSetValuesForType(connectionId, entityLogicalName, name, attrType);
      columns.push({ ...base, editable: true, editKind: "select", options: options.map((o) => ({ value: String(o.value), label: o.label })) });
    } else if (attrType === "MultiSelectPicklist") {
      const options = await fetchOptionSetValuesForType(connectionId, entityLogicalName, name, attrType);
      columns.push({ ...base, editable: true, editKind: "multiselect", options: options.map((o) => ({ value: String(o.value), label: o.label })) });
    } else if (attrType && isLookupAttributeType(attrType)) {
      // The row's value here is already the unwrapped plain GUID (unwrapODataRow strips the
      // `_..._value` suffix), which is exactly what the picker edits and writes back — no extra
      // conversion needed, unlike Picklist/number/boolean/date's string<->typed-value juggling.
      columns.push({ ...base, editable: true, editKind: "lookup" });
    } else if (attrType === "Boolean") {
      columns.push({ ...base, editable: true, editKind: "boolean" });
    } else if (attrType && NUMBER_ATTRIBUTE_TYPES.has(attrType)) {
      columns.push({ ...base, editable: true, editKind: "number" });
    } else if (attrType === "DateTime") {
      // Best-effort: a Format lookup failure (e.g. a transient network error) shouldn't block the
      // whole query from rendering — falls back to `undefined`, which convertEditedCellValue
      // already treats as "assume DateAndTime" (its pre-existing behavior before Format was
      // fetched at all).
      const dateFormat = await fetchDateTimeFormat(connectionId, entityLogicalName, name).catch(() => undefined);
      columns.push({ ...base, editable: true, editKind: "date", dateFormat });
    } else {
      columns.push(base);
    }
  }
  return columns;
}

/** The inverse of buildEditableGridColumns' type decisions — CheckableGrid's cell editors only
 *  ever hand back a raw string (a native `<input>`/`<select>` produced), so every non-text/lookup/
 *  multiselect editKind needs converting back to the JS value type Dataverse's Web API actually
 *  expects in a write payload. */
export function convertEditedCellValue(column: GridColumn | undefined, value: string): unknown {
  switch (column?.editKind) {
    case "select":
    case "number":
      return value === "" ? null : Number(value);
    case "boolean":
      return value === "" ? null : value === "true";
    case "date":
      if (value === "") return null;
      // A "DateOnly" field is Edm.Date over the Web API — a bare `YYYY-MM-DD` literal, exactly
      // what the native `<input type="date">` editor already hands back; wrapping it in a full
      // ISO datetime string 400s ("Cannot convert the literal '...' to the expected type
      // 'Edm.Date'" — confirmed live, Bugs/8.25.md #3). Anything else (Format fetch failed, or a
      // genuine "DateAndTime"/Edm.DateTimeOffset field) keeps the previous UTC-midnight ISO
      // string — see CheckableGrid's own date-editor doc comment for why that can't be exactly
      // right for every DateTimeBehavior without metadata this app doesn't fetch anywhere.
      return column?.dateFormat === "DateOnly" ? value : new Date(`${value}T00:00:00Z`).toISOString();
    default:
      return value; // text / uniqueidentifier / lookup / multiselect (comma-separated codes as-is)
  }
}
