<!--
草稿，用于贴到 GitHub 的 Releases 页面（Repo → Releases → Draft a new release）。
本机没有 gh CLI，无法自动 `gh release create`，需要自己在网页上：
  1. 先 `git tag 1.0.0.2` 打在要发布的 commit 上并 `git push origin 1.0.0.2`
  2. 运行 publish.bat 生成 publish\PowerAppsStudioTools-1.0.0.2.zip
  3. 网页 Draft a new release，tag 选 1.0.0.2，标题填 1.0.0.2，正文粘贴下面的内容，
     附件上传那个 zip，Publish
更新检测走的是 commit 祖先关系（build-commit.txt），tag 名字只要能解析到 commit 即可，
用 1.0.0.2 是为了让 version.txt 显示成干净的版本号。
-->

# Power Apps Studio & Tools 1.0.0.2

接 `1.0.0.1`（2026-08-21）之后的累积更新。这一版没有破坏性变更，老版本会在启动时自动提示更新。

## 亮点

- **Power Apps 工具组进入 beta**：`Solution 编辑器`、`Ribbon Workbench`、`BPF 流程查看器`、`Solution 深度对比` 归到同一个「Power Apps」分组，整组标注 `beta`（侧边栏分组标题、首页卡片、工具页头部都有徽标），提示这块功能还在完善中。
- **可编辑结果网格（CheckableGrid）重写**：所有字段类型都支持点选单元格直接编辑（文本 / 多行 / 整数 / 小数 / 货币 / 是否 / 日期 / 本地选项 / 查找 / 客户），列虚拟化修掉了宽表滚动卡顿，新增 CRM 风格的按列排序和 Filter by。
- **崩溃兜底**：新增全局未处理异常处理，第三方输入法之类在异常时机回调进应用触发的错误不再直接带走整个进程、丢掉每个 Tab 里没保存的内容；异常会记到 `%AppData%\MsdPpTools\crash.log`。
- **更新检测改为 commit 祖先判定**：不再用版本字符串比较，避免把更早/无关的 release 当成「新版本」提示下载。

## 数据工具（数据迁移 / 数据复制 / 数据编辑）

- 字段改动标记（❗）、未提交改动的 Tab 警告、查找 / 选项集列显示真实名称而不是 GUID / 数字。
- 写入成功的行会自动取消勾选并清掉 ❗；失败的行保持勾选，方便重试。
- 主键 ID 列在网格里不可编辑。
- 数据编辑：`更新` 按钮的数字和可点状态现在跟真正会提交的行一致（勾了 5 行但只有 1 行改过 → 显示「更新 1 条」）；`更新` 模式的 PATCH body 只带真正变更的字段；新增 `删除` 按钮（红色二次确认，成功的行整行移除）。
- 数据迁移：导入进度条；无障碍（键盘 / 屏幕阅读器）改进。
- 运行出错时自动下载写入日志；修掉宽结果行把「下载日志」按钮挤出可视区的问题。

## SQL4CDS

- `SELECT` 里可以直接写 Lookup 字段的正常逻辑名（如 `bupa_defaultplantype`），公用层按元数据自动转成 Web API 要求的 `_bupa_defaultplantype_value`；`$orderby` / `$filter` / `IS NULL` 同样处理。
- 编辑 SQL 时的语法报错不再崩掉整个工具页、也不再覆盖上一次查出来的结果。
- 精简界面：去掉实体名 / EntitySetName 覆盖框 / 请求路径预览 / 结果表格的列显示勾选器，只留 SQL 输入和结果表格。
- 修复：拼写错误直接崩页面、Lookup 字段 `IN (...)` 报 400、`DateOnly`（`Edm.Date`）字段写入报 400、`LEFT OUTER JOIN` 和 `IN (子查询)` 崩溃。
- 查询前显示引导文案，而不是空白。

## Plugin Registration / Plugin Trace Viewer

- Plugin Registration 搜索改为服务端过滤（`$filter` + `$top`），修掉在有几千个内置 Step 的组织里搜索卡死 / 超时。
- Plugin Trace Viewer 支持批量删除。

## Solution 编辑器 / Ribbon Workbench

- Solution 编辑器 v2、Ribbon Workbench v2。
- Solution 编辑器：字段面板按 solution 实际包含的组件过滤（`rootcomponentbehavior`），窗体嵌到所属表节点下面。
- Ribbon Workbench：修掉新增按钮插入位置缺 `.Controls` 段。

## 其它

- 侧边栏：搜索框 + 「最近使用」。
- 每个 Tab 的连接选择器旁边显示连接健康状态指示灯。
- 按连接的「允许写入」开关，在原生层统一拦截。
- 异常提示改为「友好摘要 + 可展开的技术细节」，`confirm()` / `alert()` 换成统一的主题化弹窗。
- 移除独立的「关联记录浏览器」，其视图并入「记录引用查看与迁移」。
- `重试` 按钮真正强制重新挂载组件，附带 reload 兜底。

## 已知限制

- 需要连接 Dataverse 的工具仅在桌面版（WebView2 壳）里可用，需要机器上装好 .NET 桌面运行时。
- 目前只有 Windows 桌面壳。
- Ribbon Workbench 只支持单表 ribbon；BPF 流程查看器是只读的。
- Power Apps 分组整体是 beta，功能尚未完整。
