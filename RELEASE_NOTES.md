<!--
草稿内容，用于贴到 GitHub 的 Releases 页面（Repo → Releases → Draft a new release）。
本地没有装 gh CLI，没法帮你直接执行 `gh release create` 发布，需要你自己在网页上创建 Release、
把下面标题+正文粘进去、打个版本 tag（比如 v1.0.0，具体版本号你定）。发布完这个文件可以删掉，
它不是项目运行需要的文件，纯粹是给 Release 页面用的草稿。
-->

# Power Apps Studio & Tools — 首次开源发布

这是 **Power Apps Studio & Tools**（原名 "MSD365 PP Tools"）第一次作为开源项目发布。一个面向 Power Apps / Dataverse / Dynamics 365 管理员和开发者的桌面工具箱：React + Vite + TypeScript + Tailwind CSS v4 前端，WPF + WebView2 桌面壳，MIT 协议。不隶属于、也未获得 Microsoft 官方认可或关联。

## 已内置 14 个工具

**连接管理**：我的连接（交互式登录 / Client Secret / 证书 / 连接字符串导入）

**元数据浏览**：Metadata Browser、关联记录浏览器

**查询工具**：SQL4CDS（支持 JOIN / GROUP BY / INSERT / UPDATE / DELETE）、FetchXML Builder、OData `$filter` 构建器、FetchXML → OData

**插件开发**：Plugin Registration、Plugin Trace Viewer

**数据 & Solution**：数据迁移、Ribbon Workbench、**BPF 流程查看器**（新增，只读查看阶段/步骤/条件分支/触发流程）、Solution 深度对比

**实用工具**：GUID 格式转换

完整说明见 [README](README.md#已内置的工具)。

## 路线图

除了继续完善已有工具里标注的待办功能，接下来两个主要新方向：

- **Power Apps & D365 Tools**：延续现有的连接/元数据/查询/插件/数据 & Solution 工具方向，继续扩展深度和广度。
- **Power Apps Maker**：对标 Power Apps 原生 Maker 门户的可视化编辑能力——表字段新建、BPF 查看与编辑（阶段查看器已上线，分支编辑评估中）、Custom API 查看与编辑、Workflow 查看与编辑、Web Resource 发布与编辑等。

详见 [README 的路线图章节](README.md#路线图--roadmap)。

## 已知限制

- 需要连接 Dataverse 的工具仅在桌面版（WebView2 壳）里可用，需要机器上装好 .NET 10 桌面运行时。
- 目前只有 Windows 桌面壳，暂无 Mac/Linux 支持。
- Ribbon Workbench v1 只支持单表 ribbon；BPF 流程查看器 v1 是只读的，不支持编辑。

## 参与贡献

欢迎 PR、Issue、想法讨论——见 [README 的贡献章节](README.md#贡献)。
