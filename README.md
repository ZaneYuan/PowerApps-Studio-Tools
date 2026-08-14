# Power Apps Studio & Tools

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个开源的 Power Apps / Dataverse / Dynamics 365 桌面工具箱（React + Vite + TypeScript + Tailwind CSS v4 前端，WPF + WebView2 桌面壳），面向日常做 Power Platform 管理/开发工作的人。不隶属于、也未获得 Microsoft 官方认可或关联——只是社区维护的第三方工具集合，产品/服务名称仅作描述性引用。

> 项目原名 "MSD365 PP Tools"，2026-08 更名为 "Power Apps Studio & Tools" 并准备开源；C# 内部命名空间/项目文件仍是 `MsdPpTools.Desktop`（保留是为了不做一次大而无益的机械重命名），但发布出来的 exe、窗口标题、README 等所有用户可见的地方都已经是新名字。

## 运行

```bash
npm install
npm run dev
```

## 打包桌面版（可直接双击运行，不用挂着 `npm run dev`）

```bash
npm run publish:desktop
```

等价于 `npm run build`（Vite 生产构建）→ `dotnet publish` 桌面壳（Release）→ 把构建产物拷到 exe 旁边的 `wwwroot/`。产物在 `publish/MsdPpTools.Desktop/PowerAppsStudioTools.exe`，双击直接跑，不需要 Node/Vite 在后台运行（还是需要机器上已装 .NET 10 桌面运行时——WPF 项目默认发布是框架依赖，不是自包含）。改了前端或桌面壳代码后要重新跑一遍这个命令才会反映到打包产物里。

## 目录结构

```
src/
  layout/          整体外壳：侧边栏 (Sidebar) + Layout（多 Tab 持久化状态）
  pages/           Home（首页卡片网格）、NotFound
  native/          桌面壳桥接（连接管理、Tab 管理、元数据缓存等跨工具共享逻辑）
  tools/
    registry.ts    工具注册表 —— 唯一需要手动维护的清单
    types.ts       ToolMeta / ToolDefinition 类型定义
    <tool-id>/     每个工具自己的文件夹
desktop/
  MsdPpTools.Desktop/   WPF + WebView2 桌面壳，承载登录/Dataverse Web API 调用/本地文件等原生能力
```

## 已内置的工具

按侧边栏分组列出（截至本次更新，共 13 个）：

**连接管理**
- 🔌 **我的连接**：管理 Dataverse 连接（交互式登录 / Client Secret / 证书 / 连接字符串导入），登录后可用 WhoAmI 验证连通性。

**元数据浏览**
- 📚 **Metadata Browser**：浏览实体的字段 / 1:N / N:1 / N:N 关系元数据，按需懒加载。
- 🔗 **关联记录浏览器**：输入实体 + GUID，展示一级查找字段记录（最多 5 个表）、一级子表记录，支持模糊搜索过滤 + 高亮。

**查询工具**
- 🗄️ **SQL4CDS**：SQL SELECT / INSERT / UPDATE / DELETE，翻译成 Dataverse Web API / FetchXML 并真实执行，支持 JOIN 和 GROUP BY 聚合。
- 🧩 **FetchXML Builder**：可视化拼 FetchXML（含嵌套过滤分组、嵌套 link-entity），生成后真实执行。
- 🔄 **FetchXML → OData**：把 FetchXML 转换为 `$select`/`$filter`/`$orderby` 等 OData 查询片段。

**插件开发**
- 🔧 **Plugin Registration**：浏览/注册插件程序集、类型、步骤、镜像，模拟 XrmToolBox Plugin Registration Tool。
- 📜 **Plugin Trace Viewer**：查看/过滤 Plugin Trace Log，含异常详情、耗时、org 级别 trace 设置开关。

**数据 & Solution**
- 🚚 **数据迁移**：多表 Tab + 行/列勾选表格，可来自多条 SELECT 查询或上传 .sql 文件（INSERT），自动识别批次内的 GUID 依赖并分两阶段回填，导入到任意已保存的连接。
- 📋 **数据复制**：单表 SELECT 查出数据后，结果表格可直接编辑（文本 / 选项集字段），行 / 列勾选（默认全选），把（编辑后的）数据当新记录批量创建，主键 ID 由 Dataverse 自动生成。
- 🎀 **Ribbon Workbench**：编辑表的 RibbonDiffXml（原始 XML）：导出 solution → 改 → 重新导入 → 发布（v1 只支持单表）。
- 🧭 **BPF 流程查看器**：只读查看 Business Process Flow 的阶段 / 步骤 / 条件分支 / 触发流程，模拟 Power Apps 原生 BPF 设计器视图。
- 🧬 **Solution 深度对比**：上传两个 `solution.zip`，对比实体/属性/Web 资源/流程等组件的差异。

所有需要真实连接 Dataverse 的工具都仅在桌面版（WebView2 壳）里可用；纯前端计算类工具（FetchXML → OData 等）在普通浏览器里跑 `npm run dev` 也能用。

## 新增一个工具

1. 在 `src/tools/` 下新建文件夹，例如 `src/tools/my-new-tool/`，写一个默认导出的 React 组件。
2. 打开 `src/tools/registry.ts`，追加一条：

```ts
{
  id: "my-new-tool",
  name: "工具名称",
  description: "一句话描述这个工具是做什么的。",
  category: "查询工具",
  icon: "🔧",
  Component: lazy(() => import("./my-new-tool/MyNewTool")),
}
```

首页卡片、侧边栏分组、多 Tab 都会自动生成，无需改动其他代码。`category` 相同的工具会自动归到同一个侧边栏分组下。需要跨工具调用 Dataverse 的一律走 `dataverse.request` 桥接方法（见 `src/native/bridge.ts`），只有前端做不到的事（本地文件对话框、程序集反射等）才新增专门的 C# 桥接方法。

新工具目录基本都遵循同一模式：一个纯逻辑文件（`dataverseOps.ts` / 解析器等，便于单测）+ 一个同名 `.tsx`（UI），可以参考 `bpf-viewer/`、`ribbon-workbench/` 作为模板。

## 路线图 / Roadmap

除了持续打磨已有工具里还没做完的功能（各工具描述里标注的 "v1"、已知限制等），接下来两个主要的新模块方向：

### Power Apps & D365 Tools
延续现有方向：面向管理员/开发者的连接、元数据、查询、插件、数据 & Solution 类工具的深度和广度都会继续扩展（比如更完整的 Solution 组件覆盖、更多插件调试能力等）。

### Power Apps Maker
面向 Maker 侧的可视化编辑能力，参照 Power Apps 原生 Maker 门户的体验：
- 表字段新建（新增/编辑 Column）
- **BPF 查看与编辑**（阶段查看器 v1 已上线——见"BPF 流程查看器"；条件分支/步骤的可视化编辑还在评估中，因为分支逻辑存在 Microsoft 未公开文档的内部 JSON 格式里，贸然写入风险较高）
- Custom API 查看与编辑
- Workflow（经典工作流）查看与编辑
- Web Resource 发布与编辑

欢迎在 Issues 里讨论优先级，或直接认领其中一项开发。

## 贡献

欢迎 PR！按上面"新增一个工具"的模式加新工具是最简单的贡献方式；修 bug、完善路线图里的方向、补充文档同样欢迎。提 PR 前建议先开一个 Issue 简单说一下思路，避免和别人正在做的工作重复。

## License

[MIT](LICENSE)
