import { tools, isBetaCategory } from "../tools/registry";
import { useActiveConnection } from "../native/activeConnection";
import { useTabManager } from "../native/tabs";
import SvgIcon from "../shared/SvgIcon";

export default function Home() {
  const { activeConnectionId } = useActiveConnection();
  const { openTab } = useTabManager();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
        Power Apps Studio & Tools
      </h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        Dataverse / Power Platform 开发工具集。
      </p>

      {tools.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400 dark:border-gray-700">
          暂无工具。
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => openTab(tool.id, tool.connectionScoped === false ? null : activeConnectionId)}
              className="rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-700"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                  <SvgIcon name={tool.icon} className="h-5 w-5" />
                </span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {tool.name}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {tool.description}
              </p>
              <div className="mt-3 flex items-center gap-1.5">
                <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {tool.category}
                </span>
                {isBetaCategory(tool.category) && (
                  <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                    beta
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
