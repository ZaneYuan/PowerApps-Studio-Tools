import { useEffect, useState } from "react";
import { fetchEntityList } from "../../native/metadataService";
import SuggestInput from "./SuggestInput";

/** `SuggestInput` fed by every entity logical name for the connection — used for the root
 *  entity name and each `LinkEntity.name` (a join target is itself an entity name). */
export default function EntityNameInput({
  connectionId,
  value,
  onChange,
  placeholder,
  className,
}: {
  connectionId: string | null;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [entities, setEntities] = useState<string[]>([]);

  useEffect(() => {
    if (!connectionId) {
      setEntities([]);
      return;
    }
    let cancelled = false;
    fetchEntityList(connectionId)
      .then((names) => {
        if (!cancelled) setEntities(names);
      })
      .catch(() => {
        if (!cancelled) setEntities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  return <SuggestInput value={value} onChange={onChange} suggestions={entities} placeholder={placeholder} className={className} />;
}
