# MSD365 PP Tools

MS Dynamics 365 / Power Platform 生态相关小工具的展示框架（React + Vite + TypeScript + Tailwind CSS v4 + react-router）。

## 运行

```bash
npm install
npm run dev
```

## 打包桌面版（可直接双击运行，不用挂着 `npm run dev`）

```bash
npm run publish:desktop
```

等价于 `npm run build`（Vite 生产构建）→ `dotnet publish` 桌面壳（Release）→ 把构建产物拷到 exe 旁边的 `wwwroot/`。产物在 `publish/MsdPpTools.Desktop/MsdPpTools.Desktop.exe`，双击直接跑，不需要 Node/Vite 在后台运行（还是需要机器上已装 .NET 10 桌面运行时——WPF 项目默认发布是框架依赖，不是自包含）。改了前端或桌面壳代码后要重新跑一遍这个命令才会反映到打包产物里。

## 目录结构

```
src/
  layout/          整体外壳：侧边栏 (Sidebar) + Layout（<Outlet/> 渲染当前页面）
  pages/           Home（首页卡片网格）、ToolPage（工具详情容器）、NotFound
  tools/
    registry.ts    工具注册表 —— 唯一需要手动维护的清单
    types.ts       ToolMeta / ToolDefinition 类型定义
    <tool-id>/     每个工具自己的文件夹
```

## 新增一个工具

1. 在 `src/tools/` 下新建文件夹，例如 `src/tools/odata-filter-builder/`，写一个默认导出的 React 组件。
2. 打开 `src/tools/registry.ts`，追加一条：

```ts
{
  id: "odata-filter-builder",
  name: "OData $filter 构建器",
  description: "可视化拼接 OData $filter 表达式。",
  category: "Dataverse",
  icon: "🔍",
  Component: lazy(() => import("./odata-filter-builder/OdataFilterBuilder")),
}
```

首页卡片、侧边栏分组、`/tools/:id` 路由都会自动生成，无需改动其他代码。`category` 相同的工具会自动归到同一个侧边栏分组下。

## 已内置的工具

- **GUID 格式转换**（`guid-formatter`）：裸 GUID / 大括号 / Web API key 格式互转。
- **OData $filter 构建器**（`odata-filter-builder`）：两级分组（组内 AND/OR，组间 AND/OR）可视化拼接 `$filter`，按类型自动处理字面量格式（string 加引号、guid/date/number/boolean 不加引号）。
- **FetchXML → OData**（`fetchxml-to-odata`）：解析粘贴的 FetchXML，转换出 `$select`/`$filter`/`$orderby`/`$top`，简单 `link-entity` 转 `$expand`。基于启发式规则，不读取实际元数据，转换结果标注了"尽力而为"的部分（日期专属函数、link-entity 导航属性名），需人工核对。
- **Solution 深度对比**（`solution-diff`）：上传两个 `solution.zip`，纯前端（JSZip）解析 `solution.xml` 版本号与 `customizations.xml`，通用的"按 collection + identity key 匹配"引擎对比 Entities（含 Attributes 下钻）/WebResources（含实际文件内容 diff）/Workflows/Roles/OptionSets/EntityRelationships/EntityMaps。全部在浏览器本地处理，文件不上传服务器。

新工具目录基本都遵循同一模式：一个 `xxx.ts`（纯逻辑，便于单测）+ 一个同名 `.tsx`（UI），可以参考 `odata-filter-builder/` 或 `fetchxml-to-odata/` 作为模板。
