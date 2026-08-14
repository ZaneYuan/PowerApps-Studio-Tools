import EntityNameInput from "./EntityNameInput";
import FieldNameInput from "./FieldNameInput";
import FilterGroupEditor from "./FilterGroupEditor";
import { newLinkEntity, type LinkEntity, type LinkType } from "./types";

const inputCls =
  "rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

export default function LinkEntityEditor({
  connectionId,
  parentEntityName,
  link,
  onChange,
  onRemove,
  depth = 0,
}: {
  connectionId: string | null;
  /** The entity this link attaches to — the root query entity for a top-level link, or the
   *  enclosing link's own entity for a nested one. `to` resolves against this. */
  parentEntityName: string;
  link: LinkEntity;
  onChange: (l: LinkEntity) => void;
  onRemove: () => void;
  depth?: number;
}) {
  function updateNestedLink(id: string, updated: LinkEntity) {
    onChange({ ...link, links: link.links.map((l) => (l.id === id ? updated : l)) });
  }
  function removeNestedLink(id: string) {
    onChange({ ...link, links: link.links.filter((l) => l.id !== id) });
  }
  function addNestedLink() {
    onChange({ ...link, links: [...link.links, newLinkEntity()] });
  }

  return (
    <div className="space-y-3 rounded-lg border border-purple-200 bg-purple-50/30 p-3 dark:border-purple-900 dark:bg-purple-900/10">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">
          Link-entity{depth > 0 ? `（嵌套第 ${depth} 层）` : ""}
        </span>
        <button onClick={onRemove} className="text-xs text-red-500 hover:underline">
          删除
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <EntityNameInput
          connectionId={connectionId}
          value={link.name}
          onChange={(v) => onChange({ ...link, name: v })}
          placeholder="关联实体名 (name)"
          className="w-40"
        />
        <FieldNameInput
          connectionId={connectionId}
          entityLogicalName={link.name}
          value={link.from}
          onChange={(v) => onChange({ ...link, from: v })}
          placeholder="from（对方字段）"
          className="w-36"
        />
        <FieldNameInput
          connectionId={connectionId}
          entityLogicalName={parentEntityName}
          value={link.to}
          onChange={(v) => onChange({ ...link, to: v })}
          placeholder="to（本方字段）"
          className="w-36"
        />
        <input
          type="text"
          value={link.alias}
          onChange={(e) => onChange({ ...link, alias: e.target.value })}
          placeholder="alias（可选）"
          className={`${inputCls} w-28`}
        />
        <select
          value={link.linkType}
          onChange={(e) => onChange({ ...link, linkType: e.target.value as LinkType })}
          className={inputCls}
        >
          <option value="inner">inner</option>
          <option value="outer">outer</option>
        </select>
      </div>

      <input
        type="text"
        value={link.attributes}
        onChange={(e) => onChange({ ...link, attributes: e.target.value })}
        placeholder="要返回的字段，逗号分隔（留空则不返回该实体的字段，仅用于过滤/关联）"
        className={`${inputCls} w-full`}
      />

      <FilterGroupEditor
        connectionId={connectionId}
        entityLogicalName={link.name}
        group={link.filter}
        onChange={(f) => onChange({ ...link, filter: f })}
      />

      {link.links.map((nested) => (
        <LinkEntityEditor
          key={nested.id}
          connectionId={connectionId}
          parentEntityName={link.name}
          link={nested}
          onChange={(updated) => updateNestedLink(nested.id, updated)}
          onRemove={() => removeNestedLink(nested.id)}
          depth={depth + 1}
        />
      ))}

      <button
        onClick={addNestedLink}
        className="text-xs font-medium text-purple-600 hover:underline dark:text-purple-400"
      >
        + 在此关联下再加一层 link-entity
      </button>
    </div>
  );
}
