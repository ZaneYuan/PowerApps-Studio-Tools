import { tools } from "../tools/registry";
import { useActiveConnection } from "../native/activeConnection";
import { useTabManager } from "../native/tabs";

export default function Home() {
  const { activeConnectionId } = useActiveConnection();
  const { openTab } = useTabManager();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
        MSD365 Power Platform 工具箱
      </h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        为 Dataverse / Power Platform 日常开发整理的小工具集合。
      </p>

      {tools.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400 dark:border-gray-700">
          还没有工具，去 src/tools 下新增一个吧。
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => openTab(tool.id, tool.connectionScoped === false ? null : activeConnectionId)}
              className="rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-700"
            >
              <div className="flex items-center gap-2">
                <span className="text-2xl">{tool.icon}</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {tool.name}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {tool.description}
              </p>
              <span className="mt-3 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                {tool.category}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
