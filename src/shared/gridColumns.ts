import { fetchOptionSetValuesForType, isLookupAttributeType, isSystemAuditField } from "../native/metadataService";
import type { GridColumn } from "./CheckableGrid";

const NUMBER_ATTRIBUTE_TYPES = new Set(["Integer", "BigInt", "Decimal", "Double", "Money"]);

/** Builds one GridColumn per column name, assigning an editor for every Dataverse attribute type
 *  that has a safe, well-defined write path. Two kinds stay intentionally read-only: PartyList
 *  (an array of `{partyid, participationtypemask}` recipient objects — no single-value text/select
 *  widget can represent that safely) and anything this app doesn't otherwise recognize (EntityName,
 *  ManagedProperty, or a type fetchAttributes hasn't already filtered out, like Virtual).
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
): Promise<GridColumn[]> {
  const columns: GridColumn[] = [];
  for (const name of columnNames) {
    const attrType = typeByName.get(name.toLowerCase());
    const checked = !isSystemAuditField(name);
    const base = { key: name, attributeType: attrType, checked };

    if (attrType === "String" || attrType === "Memo" || attrType === "Uniqueidentifier") {
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
      columns.push({ ...base, editable: true, editKind: "date" });
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
      // Serialized as UTC midnight of the picked date — see CheckableGrid's own date-editor doc
      // comment for why this can't be exactly right for every DateTimeBehavior without metadata
      // this app doesn't fetch anywhere.
      return value === "" ? null : new Date(`${value}T00:00:00Z`).toISOString();
    default:
      return value; // text / uniqueidentifier / lookup / multiselect (comma-separated codes as-is)
  }
}
