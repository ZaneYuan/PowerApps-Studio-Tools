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
    description: "管理 Dataverse 连接：交互式登录、Client Secret 或证书。",
    category: "连接管理",
    icon: "connection",
    connectionScoped: false,
    Component: lazy(() => import("./connections/ConnectionsPage")),
  },
  {
    id: "metadata-browser",
    name: "Metadata Browser",
    description: "浏览实体的字段与 1:N / N:1 / N:N 关系元数据。",
    category: "元数据浏览",
    icon: "metadata",
    Component: lazy(() => import("./metadata-browser/MetadataBrowser")),
  },
  {
    id: "sql4cds",
    name: "SQL4CDS",
    description: "用 T-SQL 语法查询和修改 Dataverse 数据。",
    category: "查询工具",
    icon: "sql",
    Component: lazy(() => import("./sql4cds/Sql4Cds")),
  },
  {
    id: "fetchxml-builder",
    name: "FetchXML Builder",
    description: "可视化构建并执行 FetchXML 查询。",
    category: "查询工具",
    icon: "fetchxml",
    Component: lazy(() => import("./fetchxml-builder/FetchXmlBuilder")),
  },
  {
    id: "plugin-registration",
    name: "Plugin Registration",
    description: "注册和管理插件程序集、类型、步骤与镜像。",
    category: "插件开发",
    icon: "plugin",
    Component: lazy(() => import("./plugin-registration/PluginRegistration")),
  },
  {
    id: "plugin-trace-viewer",
    name: "Plugin Trace Viewer",
    description: "查看、筛选和清理插件跟踪日志。",
    category: "插件开发",
    icon: "trace",
    Component: lazy(() => import("./plugin-trace-viewer/PluginTraceViewer")),
  },
  {
    id: "data-migration",
    name: "数据迁移",
    description: "跨表批量导入数据，自动处理批次内的记录引用依赖。",
    category: "数据管理",
    icon: "migration",
    Component: lazy(() => import("./data-migration/DataMigration")),
  },
  {
    id: "data-copy",
    name: "数据复制",
    description: "查询结果编辑后批量创建为新记录。",
    category: "数据管理",
    icon: "copy",
    Component: lazy(() => import("./data-copy/DataCopy")),
  },
  {
    id: "data-edit",
    name: "数据编辑",
    description: "查询结果就地编辑并更新，或复制为新记录、批量删除。",
    category: "数据管理",
    icon: "edit",
    Component: lazy(() => import("./data-edit/DataEdit")),
  },
  {
    id: "solution-editor",
    name: "Solution 编辑器",
    description: "管理解决方案组件：表、字段、发布者，并发布。",
    category: "Power Apps",
    icon: "solution",
    Component: lazy(() => import("./solution-editor/SolutionEditor")),
  },
  {
    id: "ribbon-workbench",
    name: "Ribbon Workbench",
    description: "编辑单个表的功能区 RibbonDiffXml。",
    category: "Power Apps",
    icon: "ribbon",
    Component: lazy(() => import("./ribbon-workbench/RibbonWorkbench")),
  },
  {
    id: "bpf-viewer",
    name: "BPF 流程查看器",
    description: "只读查看业务流程的阶段、步骤与条件分支。",
    category: "Power Apps",
    icon: "workflow",
    Component: lazy(() => import("./bpf-viewer/BpfViewer")),
  },
  {
    id: "solution-diff",
    name: "Solution 深度对比",
    description: "对比两个解决方案包的组件差异。",
    category: "Power Apps",
    icon: "compare",
    Component: lazy(() => import("./solution-diff/SolutionDiff")),
  },
  {
    id: "fetchxml-to-odata",
    name: "FetchXML → OData",
    description: "把 FetchXML 转换为 OData 查询片段。",
    category: "查询工具",
    icon: "convert",
    Component: lazy(() => import("./fetchxml-to-odata/FetchXmlToOData")),
  },
  {
    id: "record-merge",
    name: "记录引用查看与迁移",
    description: "查看一条记录被哪些记录引用，并批量迁移到另一条记录。",
    category: "数据管理",
    icon: "merge",
    Component: lazy(() => import("./record-merge/RecordMerge")),
  },
];

/**
 * Categories still being built out — the UI tags the whole group "beta" (sidebar heading,
 * home-page card, tool header) so users know the tools under it aren't feature-complete yet.
 */
const betaCategories = new Set<string>(["Power Apps"]);

export function isBetaCategory(category: string): boolean {
  return betaCategories.has(category);
}

export function getToolById(id: string): ToolDefinition | undefined {
  return tools.find((t) => t.id === id);
}

export function getCategories(): string[] {
  return Array.from(new Set(tools.map((t) => t.category)));
}
