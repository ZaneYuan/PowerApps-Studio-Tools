# Power Apps Studio & Tools

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个开源的高性能 Power Apps / Dataverse / Dynamics 365 桌面工具箱（React + Vite + TypeScript + Tailwind CSS v4 前端，WPF + WebView2 桌面壳），目标是最大化节省开发人员的时间、提升开发体验，面向日常做 Dynamics 365 / Power Platform 管理与开发工作的人。

**特色功能**
- 🔌 **交互式连接**：仅需提供环境 URL 和用户名，通过浏览器交互式登录即可，登录信息永久保存，无需频繁重新认证。
- 🔀 **记录引用查看与迁移**：输入一条记录，查出所有引用它的记录（1:N 查找字段 + N:N 关联，含系统表），点击表名可直接展开查看实际引用它的记录数据（默认视图字段），再批量迁移到另一条同表记录。
- 🗄️ **SQL4CDS**：INSERT 语句表格可视化，方便核对数据，支持最大 20 并发执行，大幅提升效率。
- 🧩 **FetchXML Builder**：实体和字段支持下拉提示，查找字段和选项集字段均可搜索选择，配置 FetchXML 更轻松。
- 🔧 **Plugin Registration**：快速、高性能，编辑 Step 和 Image 列时支持搜索。
- 🚚 **数据迁移**：通过 SQL 语句查询当前环境数据，勾选要导入的行和列即可直接导入目标环境，支持单次多表导入、自动处理数据依赖关系，并提供日志记录与安全的失败处理机制。
- 📋 **数据复制**：同样通过 SQL 查询需要复制的数据，勾选行和列即可轻松完成复制。
- ✏️ **数据编辑**：和数据复制同一个界面，勾选主键 ID 列就变成"更新"——直接在表格里改完写回原记录，只有真正改过的行才会提交；取消勾选主键 ID 列则变回"复制新增"。

整体运行高性能、无卡顿，所有已打开的数据都会保留在对应 Tab 中，无需重复加载。未来会持续完善更多小工具，详见下方「路线图 / Roadmap」。


## 本地调试运行

1...\MSD365Tools(当前目录)：
```bash
npm install
npm run dev
```

2.打开"..\MSD365Tools\desktop\MsdPpTools.slnx"
F5启动


## 打包桌面版（自包含单文件，下载即用）

在项目根目录运行：

```bash
npm install
```

然后双击根目录下的 `publish.bat`。运行结束后会得到两样东西：

- `publish\MsdPpTools.Desktop\PowerAppsStudioTools.exe` —— 本机双击直接运行，不需要 Node/Vite 在后台挂着。
- `publish\PowerAppsStudioTools-<版本号>.zip` —— **自包含单文件**打包（`.csproj` 里的 `RuntimeIdentifier`/`SelfContained`/`PublishSingleFile`），目标机器不需要预装 .NET，解压后双击 exe 即可用（仍需要系统自带的 WebView2 运行时——Win11 自带，Win10 绝大多数机器也通过 Edge/Windows Update 装过了）。这个 zip 就是要发给其他用户的发行包：打个 git tag（如 `v1.0.0`）后上传到 [GitHub Release](https://github.com/ZaneYuan/PowerApps-Studio-Tools/releases) 页面即可。

改了前端或桌面壳代码后要重新跑一遍 `publish.bat` 才会反映到打包产物里。

**自动更新**：Release 编译的 exe 每次启动后会在后台（不阻塞窗口打开）检查一次更新——开发机上检测到本地 git 仓库有新 commit 会自动跑 `publish.bat` 重新编译；面向普通用户的自包含发行包则检查 GitHub 最新 Release，有新版本会弹窗询问是否更新，同意才会下载替换并重启（不会静默强制重启，避免正在使用中的内容丢失）。两种更新检查失败（没网络、连不上 GitHub 等）都不会影响应用正常打开。

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

按侧边栏分组列出（截至本次更新，共 15 个）：

**连接管理**
- 🔌 **我的连接**：管理 Dataverse 连接（交互式登录 / Client Secret / 证书 / 连接字符串导入），登录后可用 WhoAmI 验证连通性。

**元数据浏览**
- 📚 **Metadata Browser**：浏览实体的字段 / 1:N / N:1 / N:N 关系元数据，按需懒加载。

**查询工具**
- 🗄️ **SQL4CDS**：SQL SELECT / INSERT / UPDATE / DELETE，翻译成 Dataverse Web API / FetchXML 并真实执行，支持 JOIN 和 GROUP BY 聚合。
- 🧩 **FetchXML Builder**：可视化拼 FetchXML（含嵌套过滤分组、嵌套 link-entity），生成后真实执行。
- 🔄 **FetchXML → OData**：把 FetchXML 转换为 `$select`/`$filter`/`$orderby` 等 OData 查询片段。

**插件开发**
- 🔧 **Plugin Registration**：浏览/注册插件程序集、类型、步骤、镜像，模拟 XrmToolBox Plugin Registration Tool。
- 📜 **Plugin Trace Viewer**：查看/过滤 Plugin Trace Log，含异常详情、耗时、org 级别 trace 设置开关。

**数据管理**
- 🚚 **数据迁移**：多表 Tab + 行/列勾选表格，可来自多条 SELECT 查询或上传 .sql 文件（INSERT），自动识别批次内的 GUID 依赖并分两阶段回填，导入到任意已保存的连接。
- 📋 **数据复制**：单表 SELECT 查出数据后，结果表格可直接编辑（文本 / 选项集字段），行 / 列勾选（默认全选），把（编辑后的）数据当新记录批量创建，主键 ID 由 Dataverse 自动生成。
- ✏️ **数据编辑**：界面与数据复制一致，勾选主键 ID 列（默认已勾选）时按钮变为"更新"——把每行按当前编辑后的值 PATCH 回原记录，仅提交字段值确实变更的行，未变更的行自动跳过；取消勾选主键 ID 列则变回"创建"，行为与数据复制相同。
- 🔀 **记录引用查看与迁移**：输入实体 + GUID 定位记录，查询有多少条记录（1:N 查找字段 + N:N 关联，含系统表）引用了它，点击表名展开查看实际引用它的记录（默认视图字段），再批量迁移到另一条同表记录。

**Power Apps**（beta，整块功能仍在完善中）
- 🏗️ **Solution 编辑器**（雏形）：查看/新建 Solution，进入后浏览组件（按类型分组，部分类型解析出真实名字）、添加已有表、新建表、新建 8 种基础类型字段（文本/多行文本/整数/小数/货币/是否/日期时间/本地选项）、发布。UI 参考 make.powerapps 的"列表 → 详情 → 组件树"结构；暂不支持查找字段和全局选项集。
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
延续现有方向：面向管理员/开发者的连接、元数据、查询、插件、数据管理类工具的深度和广度都会继续扩展（比如更完整的 Solution 组件覆盖、更多插件调试能力等）。

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
