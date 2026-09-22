import { useTabManager } from "../native/tabs";

/** Shown after a Data Edit / Data Copy write: the written records were queued as SELECTs in the
 *  temporary Data Migration tab (see TabManager's queueTemporaryMigrationSql). */
export default function PendingMigrationNotice({ tabKey, recordCount }: { tabKey: string; recordCount: number }) {
  const { activateTab } = useTabManager();
  return (
    <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
      <span>已把这 {recordCount} 条记录的查询加入「数据迁移（temporary）」标签，待迁移。</span>
      <button onClick={() => activateTab(tabKey)} className="text-blue-600 hover:underline dark:text-blue-400">
        查看
      </button>
    </div>
  );
}
