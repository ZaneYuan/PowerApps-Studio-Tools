import { lazy } from "react";
import type { ToolDefinition } from "./types";

/**
 * How to add a new tool:
 * 1. Create a folder under src/tools/<your-tool-id>/ with a default-exported component.
 * 2. lazy-import it below and add one entry to this array.
 * The sidebar, home grid, and routing all derive from this list automatically.
 */
export const tools: ToolDefinition[] = [
  {
    id: "connections",
    name: "我的连接",
    description: "管理 Dataverse 连接（交互式登录 / Client Secret），登录后可用 WhoAmI 验证连通性。仅桌面版可用。",
    category: "连接管理",
    icon: "🔌",
    connectionScoped: false,
    Component: lazy(() => import("./connections/ConnectionsPage")),
  },
  {
    id: "metadata-browser",
    name: "Metadata Browser",
    description: "浏览实体的字段 / 1:N / N:1 / N:N 关系元数据，按需懒加载。仅桌面版可用。",
    category: "元数据浏览",
    icon: "📚",
    Component: lazy(() => import("./metadata-browser/MetadataBrowser")),
  },
  {
    id: "sql4cds",
    name: "SQL4CDS",
    description: "只读单表 SQL SELECT，翻译成 Dataverse Web API 查询并真实执行。仅桌面版可用。",
    category: "查询工具",
    icon: "🗄️",
    Component: lazy(() => import("./sql4cds/Sql4Cds")),
  },
  {
    id: "fetchxml-builder",
    name: "FetchXML Builder",
    description: "可视化拼 FetchXML（含嵌套过滤分组、嵌套 link-entity），生成后真实执行。仅桌面版可用。",
    category: "查询工具",
    icon: "🧩",
    Component: lazy(() => import("./fetchxml-builder/FetchXmlBuilder")),
  },
  {
    id: "plugin-registration",
    name: "Plugin Registration",
    description: "浏览/注册插件程序集、类型、步骤、镜像，模拟 XrmToolBox Plugin Registration Tool。仅桌面版可用。",
    category: "插件开发",
    icon: "🔧",
    Component: lazy(() => import("./plugin-registration/PluginRegistration")),
  },
  {
    id: "plugin-trace-viewer",
    name: "Plugin Trace Viewer",
    description: "查看/过滤 Plugin Trace Log，含异常详情、耗时、org 级别 trace 设置开关。仅桌面版可用。",
    category: "插件开发",
    icon: "📜",
    Component: lazy(() => import("./plugin-trace-viewer/PluginTraceViewer")),
  },
  {
    id: "data-migration",
    name: "数据迁移",
    description: "多表 Tab + 行/列勾选表格，SELECT 查询或上传 .sql 文件填充，自动补齐批次内的 GUID 依赖。仅桌面版可用。",
    category: "数据 & Solution",
    icon: "🚚",
    Component: lazy(() => import("./data-migration/DataMigration")),
  },
  {
    id: "ribbon-workbench",
    name: "Ribbon Workbench",
    description: "编辑表的 RibbonDiffXml（原始 XML）：导出 solution → 改 → 重新导入 → 发布。仅桌面版可用，v1 只支持单表。",
    category: "数据 & Solution",
    icon: "🎀",
    Component: lazy(() => import("./ribbon-workbench/RibbonWorkbench")),
  },
  {
    id: "bpf-viewer",
    name: "BPF 流程查看器",
    description: "只读查看 Business Process Flow 的阶段/步骤/条件分支（模拟 Power Apps 的 BPF 设计器视图）。仅桌面版可用。",
    category: "数据 & Solution",
    icon: "🧭",
    Component: lazy(() => import("./bpf-viewer/BpfViewer")),
  },
  {
    id: "record-explorer",
    name: "关联记录浏览器",
    description: "输入实体+GUID，展示一级查找字段记录（最多 5 个表）、一级子表记录，支持模糊搜索过滤+高亮。仅桌面版可用。",
    category: "元数据浏览",
    icon: "🔗",
    Component: lazy(() => import("./record-explorer/RecordExplorer")),
  },
  {
    id: "guid-formatter",
    name: "GUID 格式转换",
    description: "在裸 GUID、大括号 GUID、Web API key 等格式之间快速转换。",
    category: "实用工具",
    icon: "🆔",
    Component: lazy(() => import("./sample-tool/GuidFormatter")),
  },
  {
    id: "fetchxml-to-odata",
    name: "FetchXML → OData",
    description: "把 FetchXML 转换为 $select/$filter/$orderby 等 OData 查询片段。",
    category: "查询工具",
    icon: "🔄",
    Component: lazy(() => import("./fetchxml-to-odata/FetchXmlToOData")),
  },
  {
    id: "solution-diff",
    name: "Solution 深度对比",
    description: "上传两个 solution.zip，对比实体/属性/Web资源/流程等组件的差异。",
    category: "数据 & Solution",
    icon: "🧬",
    Component: lazy(() => import("./solution-diff/SolutionDiff")),
  },
];

export function getToolById(id: string): ToolDefinition | undefined {
  return tools.find((t) => t.id === id);
}

export function getCategories(): string[] {
  return Array.from(new Set(tools.map((t) => t.category)));
}
