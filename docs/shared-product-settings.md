# Shared product tools and skills / 共享产品工具与技能

CLIENT-02A / #80 的开发入口，适用 Node 24.19.0、精确 Pi 1.3.0 的配套源码运行组合。尚未切换日常安装或公开发行；实际 Ego 双端验收尚未完成，当前整票 PARTIAL，不能视为 #80 已验收。完整资源目录、全部通用表单及恢复旅程仍归 #50–#52/#56；分类与生图绑定新增能力归 #81。

CLI 无须启动 WebUI Host。GUI 在左侧 **产品工具与技能** 打开同一服务；选择“产品默认”或“当前项目”，编辑声明参数、启停或重置覆盖。页面和 CLI 分开显示请求版本、待下一任务加载、实际 Pi 加载回执及失败原因。实际加载回执按项目记录；编辑产品默认后，切到当前项目查看该项目的实际加载值。已保存不表示已执行，也不授予编程、MCP 或模型调用权限。

## CLI：默认、项目覆盖和重置

先 `omp settings list`，取得当前 `revision`。写入必须明确携带这个值；版本冲突不会覆盖另一进程的修改。下例的 N 应替换为每次重新读取的版本，不能照抄旧值。

```sh
omp settings help
omp settings list
omp settings set context-doctor --revision N --parameters '{"label":"product"}'
omp settings list --project /absolute/project-A
omp settings set context-doctor --revision N --project /absolute/project-A --parameters '{"label":"project-A"}'
omp settings set grep --revision N --project /absolute/project-A --enabled false
omp settings reset context-doctor --revision N --project /absolute/project-A
```

项目路径解析为实际目录，A 的覆盖不改 B 的有效值。重置删除本项目覆盖并恢复继承。设置写入 OMP 私有 `only-my-pi/product-settings/config.json`，复用 config-runtime 的跨进程锁、原子发布和 0600 文件；不写项目 `.pi`、原 Pi `settings.json` 或外部文件。daily-config 的 preset/overlay 与受信项目配置继续保留原归属，本票不把它改造成第二个产品设置权威。

目前最低资源集：

| 资源 | 用户行为 | 声明参数与加载 |
| --- | --- | --- |
| `context-doctor` | 可启停的真实上下文诊断工具 | 仓库现有扩展 `extensions/context-doctor`，版本 0.1.0；本轮声明 `label`，1–32 个英文字母、数字、空格、下划线或连字符，拒绝额外字段。真实 Pi 的 `context_snapshot` 返回带此标签的上下文/工具计量；TUI 状态使用同一标签。数字继续标为估计，不输出原始消息文本。实际加载记录入口及 metrics 字节摘要 |
| Pi `grep`、`find`、`ls` | 可启停 | 使用原 Pi 工具；未声明产品参数 Schema，不提供任意字段编辑 |
| 显式导入的 Markdown 技能 | 默认停用，用户另行启用和使用 | 由 Pi 公共技能加载器校验和展开，按内容摘要绑定产品副本；目前无参数 Schema |
| 权限、项目/会话所有权、控制、模型预算集合 | 必需 | 不可关闭。设置不能绕过逐调用、账号、预算或写入协调 |

原 Pi 和外部资源不会自动导入。未知资源、可执行扩展代码和不兼容声明明确拒绝；这不是任意插件市场。

## 显式导入技能

支持仅含 Markdown 的本地技能。文件须有 YAML frontmatter `name`、`description`、`compatibility: pi-1.3.0`；名称为小写字母开头的字母、数字和连字符，最多 64 字符，文件最多 128 KiB。依赖脚本、其他材料或外部扩展的完整资源管理留在资源工单，不自动复制执行代码。无 Schema 的技能不接收任意参数。

```sh
omp settings preview /absolute/SKILL.md --project /absolute/project-A
omp settings import /absolute/SKILL.md --project /absolute/project-A --revision N --digest REVIEWED_DIGEST
omp settings set skill:NAME --project /absolute/project-A --revision N --enabled true
```

`preview` 展示来源、内容摘要和前后差异；`import` 再验证已审核摘要、版本与 CAS，同名拒绝。来源文件保持原字节；导入保存 OMP 的摘要目录副本且停用，不启动工具、认证或执行。GUI 选择文件后先“预览来源与差异”，再“确认导入并停用”。启用后可选择“准备使用技能”，核对输入框中的 `/skill:NAME`，再明确提交。CLI TUI 使用相同 `/skill:NAME`。Pi 权限模式仍决定是否需要执行确认；无 UI 的请求不能替代需要的确认。技能指令不授予工具写入权限。

## 生效、排队与失败

新 Host 任务冻结工具/技能设置、现有 MCP 配置及现有模型调用绑定的同一版本组合，三份权威没有复制。`resourceRevision` 是不透明的输入绑定标识，`versions` 提供三项来源版本；不要将标识当成可递增的计数。Host 的全局 inputs 能力中的 `resourceRevision: null` 表示必须经 `/api/settings` 按项目读取，不能再使用固定 0。HTTP 设置入口使用 `x-omp-settings-protocol: 1`，认证、Origin 与输入协议继续生效。

TUI 以 Pi 的 `agent_settled` 为逻辑任务边界；期间的原生排队补充继续使用同一快照。下一任务需要新资源时，通过 Pi 的公开 TUI 重载入口清理并重绑组件，重新加载已选择技能及参数，不在低层 `agent_end` 时热改。Host 在启动子进程前固定快照，worker 和输入桥接层核对同一 `resourceRevision`。实际加载回执来自 Pi 完成资源解析/注册后的可见工具与技能，配置文件存在本身不是加载证据。

GUI 的 **任务配置与消息队列** 显示当前任务固定版本和参数。运行中可“留待下一任务”；配置变化后旧版本暂停，不能静默重写或自动发送。任务停止后，先“核对当前配置与消息”，保存核对结果，再单独“明确投递队列”。未知、已发出但未证明消费的输入继续阻断，不能以编辑或恢复重放。

撤权、停用及凭据失效分别按现有合同立即阻止后续调用。资源停用采用独立撤权代次，重新启用不会恢复旧任务的许可。参数改变保留活动任务旧值。MCP 身份、凭据引用、逐调用授权、账号隔离、跨进程协调和 unknown 不重放保持现有路径。

非法设置在保存前拒绝并保留原配置。实际资源摘要变化或 Pi 加载失败时，显示失败原因并保留最后成功加载回执；不将失败请求标为已加载，也不自动替换为其他来源执行。可以修复资源或明确停用/重置后重新启动任务。运行失败、实际 Provider、安装和发行的结论分别记录。

完整证据、原始 RED、运行身份和六条 AC 对照见 [CLIENT-02A 验收记录](compatibility/2026-10-22-shared-product-settings.md)。
