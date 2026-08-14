import { useEntityAttributes } from "../../native/useEntityAttributes";
import SuggestInput from "./SuggestInput";

/** `SuggestInput` fed by `entityLogicalName`'s real attribute list (empty until the entity name
 *  itself resolves — see `useEntityAttributes`'s validate-then-fetch gate). Used everywhere a
 *  *single* field name is typed against a known entity: filter condition attribute, order clause
 *  attribute, link-entity from/to. */
export default function FieldNameInput({
  connectionId,
  entityLogicalName,
  value,
  onChange,
  placeholder,
  className,
}: {
  connectionId: string | null;
  entityLogicalName: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { attributes } = useEntityAttributes(connectionId, entityLogicalName);
  const suggestions = attributes?.map((a) => a.logicalName) ?? [];

  return <SuggestInput value={value} onChange={onChange} suggestions={suggestions} placeholder={placeholder} className={className} />;
}
