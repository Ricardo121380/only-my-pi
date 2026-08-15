# only-my-pi：Pi Agent、DeepSeek Harness 与开源 Harness 生态调研报告

> 调研日期：2026-08-15（Asia/Shanghai）
> 状态：研究报告；本报告落盘时没有因为“先研究”而新增安装第三方包。
> 目标：为个人仓库 `only-my-pi` 建立可审计、可回滚、可逐步扩展的 Pi Agent 工作台，并从 DeepSeek Harness、OpenCode、Kimi Code、ZCode、Zed、OpenHands、Cline、Aider 等项目提炼可以自己实现的模块。

## 1. 先给结论

### 1.1 仓库已经创建

`only-my-pi` 已创建为独立 Git 仓库，并推送到 GitHub：

- GitHub：<https://github.com/Ricardo121380/only-my-pi>
- 本机路径：`/Users/huangrui/Documents/ChatGPT/only-my-pi`
- 当前可见性：Private（先按安全默认创建；以后如果要开源，再单独评估哪些内容可以公开）
- 初始提交：`c71add4`，`Initialize only-my-pi package`
- 初始目录：`extensions/`、`skills/`、`prompts/`、`themes/`、`docs/`

仓库明确禁止提交 API key、OAuth 文件、会话、缓存、私有源代码和本机 npm 安装目录。这个边界必须继续保持：`only-my-pi` 是“可审查的个人 Harness 资源层”，不是凭据仓库，也不是把整个 `~/.pi/agent` 复制进去。

### 1.2 不建议 fork DeepSeek Harness，也不建议现在把它直接当 Pi 后端

官方 DeepSeek Harness（`dsh`）是真正值得学习的项目，但目前仍是 developer preview，官方明确提示会有兼容性破坏；npm 当前 CLI 是 `@deepseek-ai/dsh@0.1.0-rc.6`，官方仓库还没有稳定 release/tag。它最有价值的地方不是“再装一个 CLI”，而是：

1. 把 session、tool registry、agent loop、model adapter、sandbox、approval、telemetry 都拆成可替换插件；
2. 用 append-only、可重放的事件日志作为上下文单一事实源；
3. 用 profile/bundle/patch 组合运行时，而不是把所有行为硬编码在一个巨型核心里；
4. 将文件系统、子进程、沙箱、子代理抽象成 capability seam，换 provider 就能换执行世界；
5. 把安全策略、配置 dump/diff、插件健康检查和回归评估放进 Harness 工程本身。

因此，`only-my-pi` 的方向应是“以 Pi 为当前运行时，逐步实现 DSH 的优秀抽象”，而不是把 DSH 的预览期内部 API 直接嵌入 Pi。

### 1.3 社区真正反复验证的不是“全家桶”，而是小而清晰的层

LinuxDo、V2EX 等讨论里的高频组合大致分为：

- 运行能力：MCP lazy/proxy、LSP、浏览器、子代理；
- 可靠性：plan、permission、workspace undo/redo、diff/review、测试回路；
- 上下文：tool output 压缩、cache-aware prompt、memory/compaction；
- UI：一个 theme、一个 renderer 或 footer；
- 供应商：在 Pi 的 `models.json` 中接 OpenAI-compatible/DeepSeek/第三方 gateway。

社区共识同时很明确：多个 renderer/editor/footer/memory/context 包叠加，会互相覆盖或增加 token；“下载量高”不等于安全，也不等于和当前 Pi 版本兼容。`only-my-pi` 应采用项目级、精确版本、一次只启用一层的策略。

### 1.4 当前最合理的路线

第一阶段只做“可观察、可回滚、可审查”的能力：

- 先保留现在已经安装的 plan/permission/LSP/web/subagent/memory/git-sync 基线；
- 研究并验证 workspace history、diff/review、tool display，但暂不盲装；
- 主题只选一个纯 JSON theme；美化层最多再选一个完整 TUI/footer 接管包；
- MCP 只在真实项目需要时按项目启用，并固定 server 与工具 allowlist；
- memory/context 只允许一个实现进入实验，不与现有 `pi-memory` 叠加；
- 把 DSH 的 session ledger、插件 manifest、capability seam、verification receipt、sandbox provider 逐步实现为 `only-my-pi` 自己的包。

## 2. 证据和调研方法

本报告将信息分成三类：

| 证据等级 | 含义 | 用法 |
| --- | --- | --- |
| A：官方文档/源码/包页 | 项目维护者当前声明或代码事实 | 可作为设计和兼容性的主依据，但仍需锁定版本 |
| B：npm/GitHub 当前元数据 | 版本、peer dependency、engine、包结构 | 用于安装前门禁，不代表安全审计或质量保证 |
| C：论坛实测/个人项目自述 | LinuxDo、V2EX、Reddit、个人 Harness 的经验 | 用来发现候选和失败模式，不能直接当作推荐或 benchmark |

已覆盖的来源类型：官方 DeepSeek Harness、Pi、OpenCode、Kimi Code、ZCode、Zed、OpenHands、Cline、Aider 文档；GitHub 仓库与包元数据；LinuxDo、V2EX 的实战帖；npm registry。对 `v2ray.com/V2Ray`、Hostloc 等关键词没有发现可核验的 Pi/DSH 插件实测帖，因此不会为了“覆盖平台”制造推荐。

论坛内容可能包含失效链接、第三方中转、个人 token 和未经验证的安全说法。报告中会把它们写成“社区观察”，并明确不等于官方背书。

## 3. 当前本机 Pi 基线

### 3.1 已验证的运行时

- Pi CLI：`0.84.1`
- Node：`v25.8.0`
- `pi`：`/opt/homebrew/bin/pi`
- 当前工作目录的原始 `Pi Agent` checkout 没有被本次建仓库动作改写；新项目是独立的 `only-my-pi`。
- 当前没有完成 Provider/model 的真实调用验证；包已注册不等于模型已经可用。

### 3.2 已安装的用户级包（精确版本）

| 包 | 本机版本 | 作用 | 当前判断 |
| --- | ---: | --- | --- |
| `@narumitw/pi-plan-mode` | 0.49.3 | `/plan`、偏只读规划 | 保留；它是扩展层风险降低，不是 OS sandbox |
| `pi-agent-extensions` | 0.5.2 | 一组扩展/主题/资源 | 保留过滤加载：sessions/context/review/notify |
| `pi-web-access` | 0.20.0 | 搜索、抓取、GitHub/PDF/视频等 | 保留但网络边界大，浏览器 cookies 不默认打开 |
| `pi-subagents` | 0.45.2 | child Pi sessions、并行/后台/链式委派 | 保留；shared cwd 的 writer 硬上限为 1，parallel writer 必须使用独立 managed worktree/review gate |
| `pi-permission-modes` | 2.2.0 | plan/build/YOLO 等权限工作流 | 保留；不把 YOLO 当默认；条件式 OS sandbox 只覆盖符合条件的 Bash 子进程，必须报告 `active`/`degraded`，不得推导整个 session 或 file/web/MCP/provider/extension 已隔离 |
| `@narumitw/pi-lsp` | 0.49.4 | LSP 诊断/语言服务 | 保留；按语言安装 server |
| `@sreetej510/pi-usage` | 0.4.5 | 用量/成本观察 | 保留；当前没有 Provider 时先不据此作结论 |
| `pi-memory` | 0.4.1 | 跨会话记忆 | 保留一个 memory 实现，暂不叠加其它 memory |
| `pi-git-sync` | 0.1.3 | 配置/资源的 Git 同步辅助 | 先审同步边界，再用于 only-my-pi |

### 3.3 版本漂移警告

截至本次 npm registry 查询（2026-08-15），部分包已经比本机精确 pin 更新：

| 包 | registry 当前 | 本机 | 处理 |
| --- | ---: | ---: | --- |
| `@earendil-works/pi-coding-agent` | 0.84.2 | 0.84.1 | 不在本报告中自动升级；先跑完整 smoke/eval |
| `pi-mcp-adapter` | 2.26.0 | 未装 | 需要 MCP 时再项目级安装 |
| `pi-subagents` | 0.50.0 | 0.45.2 | 先保持已验证版本 |
| `pi-web-access` | 0.23.0 | 0.20.0 | 先保持已验证版本 |
| `pi-memory` | 0.4.2 | 0.4.1 | 先做 A/B，不自动替换 |
| `@sreetej510/pi-usage` | 0.5.2 | 0.4.5 | Provider 配好后再升级评估 |

“latest”是供应链和兼容性变化源，不应直接写入 `only-my-pi` 的默认清单。

## 4. DeepSeek Harness（官方 dsh）深度分析

### 4.1 身份、安装和成熟度

真正的官方项目是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，不是 PyPI 上或 GitHub 上任何同名的个人 Python wrapper。官方 README 说明：它由 DeepSeek AI 开发，采用“Everything is a Plugin”，底层由 Cordis 驱动；当前是 developer preview，兼容性会破坏；MIT 许可证，并提供第三方依赖清单。

官方最小启动方式：

```bash
npx @deepseek-ai/dsh web
# 默认 Web UI: http://127.0.0.1:3080
```

从源码运行：

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

npm registry 当前 CLI 是 `@deepseek-ai/dsh@0.1.0-rc.6`。官方仓库没有稳定 release/tag 的事实，加上 README 的 developer-preview 声明，意味着它适合源码研究和隔离试跑，不适合让 `only-my-pi` 直接依赖内部包 API。

### 4.2 Cordis 插件树：没有“不可替换的超级核心”

官方架构文档把 Cordis 描述为共享上下文上的插件框架：插件贡献 services、typed events 和可逆 effects。模型适配器、tool registry、session log、agent loop 都是插件，所以产品行为可以通过配置替换；插件卸载时，注册产生的 effects 会回滚。

这和普通“核心循环 + 一堆回调”的差别很大：

```text
profile
  └─ ordered bundles
       └─ Cordis rows / services / event listeners
            ├─ model adapter
            ├─ session ledger
            ├─ prompt sections
            ├─ tools + guards
            ├─ agent loop
            ├─ filesystem / subprocess / sandbox
            ├─ subagent provider
            └─ web/headless surface
```

### 4.3 Profiles、bundles、patch 的组合机制

DSH 的运行时不是一个固定配置文件，而是有序层：

1. profile 列出的 bundles；
2. profile 自己的 `cordis.patch.yml`；
3. Harness home 的 patch；
4. CLI `--patch` overlay。

`dsh-base` 是所有 profile 的第一层，负责模型适配、工具、持久化、sandbox/approval policy、settings/credentials、telemetry。`dsh-web-app` 在 base 上加入 Web UI、API gateway、workspace projection/cache 和前端运行时；`dsh-headless` 提供无服务器的一次性 runner。

关键陷阱：patch 以 row id 定位，匹配后是替换整行配置，不是深度 merge。只覆盖一个字段可能意外丢掉原 row 的其它字段。因此 only-my-pi 的配置层必须实现 schema/version/完整展开和 diff，而不能把任意 JSON merge 当成安全升级。

官方用 `dsh --profile web --dump-config` 查看实际启动树；这正是 `only-my-pi` 应复制的运维能力。

### 4.4 官方包/模块地图

官方仓库当前 packages 树中，最值得学习的模块如下：

| DSH 模块 | 作用 | only-my-pi 的学习目标 |
| --- | --- | --- |
| `@deepseek-ai/dsh-base` | 基础 profile bundle | 把默认能力拆成可审计 profile |
| `@deepseek-ai/dsh-web-app` | Web surface、workspace、API、前端 runtime | Pi TUI 之外的 headless/HTTP 驱动层 |
| `@deepseek-ai/dsh-headless` | 无 HTTP/浏览器的一次性 runner | CI、评估和批处理模式 |
| `dsh-session` | append-only session event store | 会话事件日志和 replay |
| `dsh-system-prompt` | PromptSection 注册/动态组装 | 可解释的 prompt sections |
| `dsh-tools` | scoped tool registry、guarded execution | 单调、fail-closed 的工具策略 |
| `dsh-agent` / `dsh-agent-loop` | Agent 接口、注册表和默认 loop | 把 loop 与 UI/provider 解耦 |
| `dsh-llm` / `dsh-llm-deepseek` / `dsh-llm-pi-ai` | LLM seam 与 DeepSeek/pi-ai adapter | provider-neutral adapter |
| `dsh-mcp-client` | MCP server 到 `ctx.tools` 的桥 | MCP proxy/lazy/allowlist |
| `dsh-sandbox` / `dsh-sandbox-policy` / `dsh-sandbox-local` | sandbox seam、策略、bwrap/Landlock/Seatbelt/Windows backend | OS 级隔离 provider |
| `dsh-subagent-acp` | ACP 子进程子代理 | 将 Pi/OpenCode/Kimi/其它 agent 当 provider |
| `dsh-subagent-claude-code` / `dsh-subagent-codex` | 外部 agent provider | 多 Harness 委派接口 |
| `dsh-subagent-dsh-sdk` / `fork-in-process` | DSH 子进程或进程内 fork | 控制上下文继承与资源边界 |
| `dsh-compaction` / `spill` / `session-query` | 压缩、上下文溢出、会话查询 | 长会话成本和恢复 |
| `dsh-goal` / `jobs` / `workflow` | 目标、后台任务、流程编排 | goal 模式必须有 verifier/预算 |

### 4.5 Session：日志就是模型上下文的事实源

DSH 的 `SessionEvent` 是 append-only、带类型和连续序号的日志。模型历史通过 `deriveMessages()` 从日志投影；fork、resume、transcript、telemetry、persistence 都从同一个流派生。原始 assistant chunks 也保留，以支持 replay 和 UI fidelity。

这解决了许多个人 agent 的隐患：

- 不会只把“当前拼给模型的 prompt”保存下来，而丢掉事件来源；
- 可以定位工具调用到底发生、失败还是被中断；
- session fork 是日志边界操作，而不是复制一段脆弱字符串；
- 可以对 compaction、注入、工具结果进行可验证的重建。

`only-my-pi` 的第一个自研核心应是一个轻量 `session-ledger`：先监听 Pi session events，记录 schema-version、run-id、tool outcome、approval decision 和 compaction receipt；不要一开始重写 Pi 的 agent loop。

### 4.6 Prompt sections 和 context 组装

DSH 用 `PromptSection` 注册表管理 system prompt：section 可以是静态文本，也可以根据 context 动态解析；同一 scope 只允许一个有效 complete section；scope 内的 section/变量可以 shadow 全局值。

可迁移到 Pi 的设计：

- 将 AGENTS/CLAUDE/项目说明、当前 goal、工具说明、记忆摘要、评估约束分成可观测 section；
- 记录每个 section 的 source、长度、hash、是否注入；
- 对 context budget 做 doctor 报告，而不是盲目叠加 memory/context-mode；
- 将跨项目的个人偏好和项目本地规则分开，并受 Project Trust 控制。

### 4.7 Tools、Code Mode 和 guard

DSH 的 tool pipeline 是 `pre-execute → execute → post-execute → result`，并提供 scope-aware `ToolGuard`。guard 只能拒绝，后续 listener 不能撤销拒绝，因此策略是单调、fail-closed。`ToolRestriction` 用 allow/deny 列表限制工具；scope 之间的限制取交集。

Code Mode 允许模型在 `mode: code` 下通过 `run_code` 批量调度工具，记录 dispatch log，减少大量 MCP schema 常驻上下文的成本。但它不是天然 sandbox；嵌套工具仍要各自执行权限检查。

only-my-pi 应实现三层，而不是只做一个 approval popup：

```text
项目/资源 allowlist
        ↓
工具 action + resource policy（deny > ask > allow）
        ↓
OS/container/micro-VM sandbox（真正的权限边界）
```

### 4.8 Subagents、MCP、LSP、skills 和 Web

- DSH 有 provider-neutral subagent seam，可接 ACP、Claude Code、Codex、另一个 DSH SDK runtime 或进程内 fork。
- `dsh-mcp-client` 将 MCP server 工具注册到统一 `ctx.tools`，仍需对 server 的进程、凭据、网络和工具做 allowlist。
- LSP 应作为 capability provider，不应与文件写入权限混为一谈。
- Skills 适合 prompt/workflow 资源，但带脚本的 skill 仍可执行任意操作。
- Web UI、headless、ACP 是 surface/provider；它们不应该重新实现一套 session、tool policy 和 credential store。

### 4.9 DSH 安全边界

官方和源码结构共同指向几条重要结论：

1. 插件、安装/prepare 脚本和资源加载在 agent sandbox 之外执行；插件代码按启动用户权限运行。
2. Creator 的 `node:vm` 和 workflow worker 不是 OS 安全边界。
3. Web fetch 需要显式考虑 SSRF；默认不应把本机网络和凭据暴露给任意 URL。
4. telemetry 如果选择上传完整 session records，会包含模型可见内容，必须由用户明确同意；默认关闭更安全。
5. Python SDK 示例中的 `danger-full-access` 只能作为开发示例，不能照搬到个人无人值守流程。

结论：DSH 的“插件化”改善了可替换性，不会自动改善供应链安全。插件 manifest、来源、hash、权限、网络和沙箱必须分别治理。

### 4.10 官方与同名第三方项目消歧

搜索中出现多个 `deepseek-harness`，不能混为一个项目：

| 项目 | 类型 | 判断 |
| --- | --- | --- |
| `deepseek-ai/deepseek-harness` | DeepSeek 官方 TS Harness | 本报告的重点 |
| `HologramSteve/deepseek-harness` | Python Agent wrapper | 非官方；学习 API 组织即可 |
| `tylerbuilds/deepseek-harness` | 本地批处理/安全门 CLI/MCP | 非官方；不要用名称判断信任 |
| `HenryZ838978/deepseek-harness` | DeepSeek 协议 wrapper/CLI/MCP | 非官方；需逐仓审计 |
| PyPI `deepseek-harness` 等同名包 | Python 包名 | 不代表 DeepSeek 官方；安装前核对 owner、签名和源码 |

### 4.11 产品运行模式和功能面

从官方 bundle、工具目录和当前源码可以把 DSH 的功能理解成几个可以组合的 profile，而不是一个不可拆的“超级模式”：

| 模式/层 | 主要能力 | 适合场景 | 风险边界 |
| --- | --- | --- | --- |
| Web profile | Web UI、workspace、session、settings、approval、工具和浏览器 surface | 本地交互开发 | HTTP/Web surface、浏览器和网络要单独限制 |
| Headless bundle | 一次性 Agent/Session runner，无 HTTP/浏览器层 | CI、批处理、评估 | 无 UI 不等于无 shell/文件权限 |
| Standard coding profile | read/write/edit、shell、search、skills、plan/goal/todo、MCP、subagent | 日常编码 | 需要 workspace、tool 和子代理预算 |
| Plan/read-only profile | 只读探索、规划、问题澄清 | 陌生仓库、设计阶段 | 只读提示/工具限制不能代替 OS sandbox |
| Code/Composable Mode | 用 `run_code` 组合多步工具调用，减少 schema/往返 | 大量查询、批量处理、MCP context reduction | 代码执行和嵌套工具必须再次过 policy |
| Creator/动态插件 profile | 检查 Cordis runtime、动态定义/启停插件、创建组合 | Harness 开发和实验 | `node:vm`/worker 不是安全边界；禁止默认开放 |

这组模式的关键不是命名，而是 capability composition：同一套 session、tool policy、LLM 和 sandbox seam 可以在 Web、headless、ACP 或 SDK surface 中复用。`only-my-pi` 应将“模式”实现为可解析的 profile，而不是让每个扩展自行发明一套 `--yolo`、`--plan` 和 `--unsafe` 语义。

### 4.12 官方子代理与插件开发面

官方 `subagent/` capability family 已把多种 provider 放在统一 `ctx.subagents` 接口下：进程内 fresh child、从父历史 fork、ACP child、Codex app-server、Claude Agent SDK、DSH SDK subprocess 等，工具层再提供 spawn/control/report。这个设计比“只启动几个 `pi` 子进程”更适合作为 `only-my-pi` 的长期抽象。

官方插件通常通过 `apply(ctx)`、服务依赖和生命周期 effects 注册能力。正确的插件应能：

- 声明依赖而非隐式 import 全局状态；
- 注册 tool/provider/command/event 时保留 cleanup；
- 在 unload 时撤销监听器、工具和临时文件；
- 提供配置 schema 和 resolved-config 诊断；
- 将模型可见输入写入 session event；
- 为网络、shell、文件和凭据声明能力边界。

这正是 `only-my-pi` 后续 `package-doctor`、`profile-resolver` 和 `safe-mode` 需要强制的契约。

### 4.13 Workflow、Ralph 和长任务

DSH 的 jobs/workflow/goal 家族支持后台任务、阶段编排、并行 agent 和持续目标。社区和官方代码都显示，这类功能最容易从“帮助完成任务”变成“无限循环 + 无限费用 + 不可解释修改”。

在 `only-my-pi` 中，goal/workflow 必须有：

1. wall-clock timeout；
2. 最大 agent turn/step；
3. token 和费用预算；
4. 并发和递归深度上限；
5. 停滞检测；
6. 每个工具调用的终态（success/failed/denied/cancelled/unknown）；
7. verifier 证据（测试、diff、lint 或人工确认）后才能报告完成；
8. worktree/容器隔离和一键停止。

初期建议使用声明式 workflow（步骤、依赖、输入、输出），不要把任意 JS/TS 执行器暴露给模型。

### 4.14 Provider、DeepSeek 特性和评估重点

DSH 同时提供 DeepSeek adapter 和基于 `pi-ai` 的 provider seam。对于 DeepSeek 风格模型，真正需要验证的不是模型列表，而是 Harness 是否正确处理：

- streaming 与 abort；
- thinking/reasoning 内容在下一轮 tool call 后的 replay；
- tool call 与 tool result 的稳定序列化；
- prefix/cache 命中和成本显示；
- 长上下文、compaction、spill/pruner；
- `Retry-After`、超时、断线、SSE 错误；
- OpenAI-compatible gateway 的 headers、base URL 和模型元数据。

V2EX 的 OpenSeek 文章把 cache-aware prompt assembly、`reasoning_content` replay、五种 compaction、MCP 和 LSP 列为 DeepSeek 用户最容易踩的坑。这些内容适合转成 `deepseek-conformance` 测试；不能因为某个项目 README 宣称“99% cache hit”就视为已验证指标。

`only-my-pi` 应优先给现有 `pi-ai` 上游补测试或 adapter，而不是维护第二个 DeepSeek HTTP wrapper。

### 4.15 Web Search/Fetch 的默认关闭原则

DSH 的 Web Search 和 Web Fetch 是不同 capability：搜索可能需要额外模型请求并产生独立成本；URL fetch 如果没有 SSRF 防护，就不应默认挂载。`only-my-pi` 的 Web profile 至少要拒绝：localhost、私网/Link-local、云 metadata 地址、Unix/socket URL、DNS rebinding、危险重定向、超大响应和未允许的 MIME；浏览器 cookie 必须显式 opt-in。

### 4.16 Python SDK 与部署建议

官方 Python 包是 `deepseek-harness-sdk`，不是 PyPI 的同名 `deepseek-harness`。SDK 适合构建受控服务或测试 runner，但示例中可能使用 full-access workspace/Persistent Bash；它不应直接在主机全目录和真实凭据上运行。

推荐部署层次：

```text
研究 DSH 源码       → 本地只读 clone / 固定 commit
体验 Web/headless    → 临时用户 + disposable worktree
运行真实任务         → Docker/Gondolin/OpenShell/Seatbelt
无人值守/远程         → 最小挂载 + 最小凭据 + 网络 allowlist + verifier
```

## 5. 其它 Harness 的可复用设计

### 5.1 对比表

| Harness | 强项 | 最值得迁移到 only-my-pi 的模块 | 不应直接复制的部分 |
| --- | --- | --- | --- |
| Pi | 极简、资源可组合、TUI/SDK、容易改造 | 轻量 package manifest、events、Pi TUI、provider-neutral runtime | 不能把 package trust 当 sandbox |
| DeepSeek Harness | 一切皆插件、Cordis、事件溯源、capability seam、profile patch | session ledger、可逆 effects、profile/bundle、guard、sandbox provider | developer preview 内部 API、整行 patch 陷阱 |
| OpenCode | provider-agnostic、LSP、MCP、agent profiles、client/server、权限规则 | agent-specific permissions、MCP codemode、LSP feedback、文件快照 | V2 plugin API 仍 beta；旧 V1/V2 配置字段不能混用 |
| Kimi Code | 单二进制 TUI、AgentSwarm、插件 marketplace、ACP、skills/agents/hooks/MCP | manifest、插件诊断、并发上限、ACP、semantic theme token | 用户级插件当前影响所有项目；WebBridge/Computer Use 的 cookie/Accessibility 风险 |
| ZCode（Z.ai） | Goal/Memory/Browser、插件 marketplace、hooks UX | manifest + userConfig、hook lifecycle、Goal/Memory 的产品交互 | 闭源，不能 fork；LSP manifest 当前是识别占位，不应当作可执行能力 |
| Zed | ACP 客户端、Agent Panel、外部 agent、工具权限 | 把 only-my-pi 做 ACP server/client，复用 editor surface | Zed 本身不是 Pi runtime |
| OpenHands SDK/Canvas | typed Action/Observation、Condenser、workspace/runtime/sandbox、ACP | typed events、condenser、Docker/remote workspace、Agent Server | 不把 Python runtime 嵌入 Pi；本机 local runtime 无隔离 |
| Cline | 分层 Agent/Core/LLM、SQLite session、RPC sidecar、teams | stateful Core、任务队列、mailbox、可观察 loop | 与 Pi 的 TS API/生命周期不直接兼容 |
| Aider | repo-map、architect/editor 双模型、Git undo/lint/test | 符号图上下文、双模型角色、Git checkpoint | 不把 repo-map 当唯一上下文策略 |
| Roo Code | plan/architect/ask/debug、shadow Git checkpoints | 历史参考：模式和 checkpoint | 仓库已归档，不作为新依赖 |

### 5.2 OpenCode 的当前状态要特别注意

旧的 `opencode-ai/opencode` Go 仓库已经归档并迁移到 Crush；当前主线应看 [anomalyco/opencode](https://github.com/anomalyco/opencode) 和 [opencode.ai](https://opencode.ai/)。V2 文档使用 `permissions` 规则数组，动作/资源/效果三元组；旧 V1 用 `permission` 对象。only-my-pi 只借鉴其概念，不要直接复制 beta V2 schema。

OpenCode 的有价值设计：

- agent profile 同时绑定 system prompt、model、tools 和权限；
- `explore` 子代理可只读，`plan` 限制编辑，`build` 才允许完整工作流；
- MCP 工具可以按 `<server>_<tool>` 粒度授权；
- `external_directory` 作为独立边界先于 read/edit 判断；
- shell 仍使用宿主用户的文件、进程和网络权限，规则不是容器。

### 5.3 Kimi Code 的插件契约值得直接借鉴

Kimi 插件可以声明 skills、agents、sessionStart skill、system prompt、MCP servers 和 hooks；官方 marketplace 分 Installed/Official/Curated/Custom，支持 GitHub tag/branch/commit pin。插件安装后复制到 managed directory，修改原目录不会自动生效；当前安装是 user-level，尚无 project-level scope。

它还提供值得迁移的护栏：manifest 路径经 symlink resolve 后必须留在 plugin root；坏 manifest 隔离诊断；命令和 MCP 自动 namespace；system prompt 单字段/总量预算；AgentSwarm 有并发上限。only-my-pi 应默认限制 subagent depth、fanout、token 和 cost，避免递归及并发失控。

### 5.4 ZCode 只作为行为/UX 参考

ZCode 的 `.zcode-plugin/plugin.json` 可组合 commands、skills、agents、hooks、MCP 和用户配置；hooks 通过 JSON stdin/stdout 与子进程交互，可 allow/ask/deny 和修改 tool input。它的 Goal/Memory/Browser/Marketplace 交互对 only-my-pi 很有启发，但产品闭源，不能把宣传的 context 或模型效果当作可复现基准。当前插件 manifest 的 `lspServers` 只登记/诊断，不执行 LSP server，应按占位能力处理。

## 6. 社区调研：LinuxDo、V2EX 与“V2ray”

### 6.1 LinuxDo 的共识和推荐包

LinuxDo 的 Pi 帖子提供了最有价值的真实反馈，但它们是个人配置，不是安全审核。较常见的候选包括：

- `pi-mcp-adapter`：lazy/proxy MCP，减少常驻 schema；
- `pi-subagents`：并行/后台/链式委派；
- `@narumitw/pi-lsp`：LSP；
- `pi-agent-browser-native`：浏览器工具；
- `pi-workspace-history`：shadow Git undo/redo；
- `pi-simplify`、`pi-slopchop`、`pi-tool-display`：diff/review/renderer；
- `@ff-labs/pi-fff`：高速 find/grep；
- `pi-rtk-optimizer`、`context-mode`、memory/compaction 包：token/上下文实验；
- footer/statusline/theme 包：美化和状态可视化。

一个 LinuxDo 用户帖展示了真实的组合清单：`pi-web-access`、`context-mode`、`pi-subagents`、`pi-mcp-adapter`、`pi-lens`、`pi-markdown-preview`、`pi-simplify`、`pi-hermes-memory` 等；同帖也明确警告不要使用 `pi-lens`。这说明社区既能发现候选，也能提供反例，不能只抄安装命令。[原帖](https://linux.do/t/topic/2321539?tl=en)

另一篇快速上手帖把 `pi-extension-settings`、powerbar、hashline edit、goal/plan/subagents、MCP、fff、rtk/cache optimizer、LSP、browser、workspace-history、curated themes 等列成组合。它很适合做候选索引，但没有为每个包提供统一安全/兼容审计。[原帖](https://linux.do/t/topic/2637702?tl=en)

LinuxDo 的实战经验反复支持以下原则：

1. Pi 的优势是可塑和轻量，不是装得越多越强；
2. renderer/editor/footer 只能有一个“所有者”；
3. memory/context-mode/DCP 不要叠加，必须做 token 和召回 A/B；
4. 权限提示、工具隐藏和 Project Trust 本身不是 sandbox；enforcement 必须按 surface 报告。例如当前审计的 `pi-permission-modes` 只能在 runtime 成功初始化时对符合条件的 Bash 子进程提供条件式 OS sandbox；必须报告该 surface 的 `active`/`degraded` 状态，不能把降级后的 prompts 当作隔离，也不能由此声称整个 Pi session、file tools、web/MCP、provider 或 extension 已受 sandbox 保护；
5. 先 `pi -e` 临时试用，再项目级 pin，最后才考虑全局。

### 6.2 V2EX 的信号

- V2EX 有可复现的 Pi `models.json` 示例，使用 `https://edge.v2ex.com/chat/v1` 并列出 GLM、MiniMax、DeepSeek 模型。这是 V2EX AI Persona 服务配置，不是 Pi 官方 model 能力背书；token、中转隐私、模型真实性必须独立评估。[Pi 配置帖](https://www.v2ex.com/t/1229821)
- V2EX 有 Pi 自动审批扩展的自荐帖：AI 分类器对低风险动作自动放行，高风险/不确定动作回退人工或拒绝。它可以作为审批 UX 的研究样本，但“AI 判断安全”不应替代 OS sandbox，且应先审源码。[自动审批帖](https://cn.v2ex.com/t/1226191)
- V2EX 的 OpenSeek 文章指出 DeepSeek 适配最容易踩到 cache-aware prompt、`reasoning_content` replay、tool-result compaction、MCP、LSP 等坑。这些是很好的评估项目，不应直接当作经验证的 benchmark。[OpenSeek 文章](https://www.v2ex.com/t/1215048)
- 最近的 Orca/DeepSeek-native agent 进展帖强调 OS 沙箱、陌生仓库只读断网、工具调用终态、goal 停滞检测、质量门禁和 verifier。这些经验与 DSH 的 capability seam/guard 方向一致，但项目自述尚未给出统一 benchmark。[Orca 进展](https://global.v2ex.com/t/1228000)

### 6.3 V2ray.com/V2Ray、Hostloc

本次检索没有发现可验证的、专门讨论 Pi/DSH 包插件的高质量 V2Ray 论坛实测。V2EX 与 V2Ray 经常在口语中混称，但它们不是同一个社区。对于中转、订阅、模型 gateway 的帖子，应该把它们当作 Provider/网络来源审查，不应当当作插件生态来源。

### 6.4 社区结论

社区最值得借鉴的是失败模式和组合经验，而不是“推荐榜”：

- 先做 source/peer/权限审计；
- 先临时运行和 disposable repo；
- 只安装一个 MCP bridge、一个 memory、一个 renderer、一个 footer；
- 所有能接触网络、cookie、凭据、shell、编辑器布局的包提高风险等级；
- 记录版本、测试命令、禁用方法和回滚方法。

## 7. Pi 包与主题建议（截至 2026-08-15）

### 7.1 建议进入 only-my-pi 候选清单，但暂不自动安装

#### A. 回滚/审查层

1. **`pi-workspace-history@0.2.2`：设计价值高，但当前不能直接安装。**

   它用 shadow Git 实现 workspace undo/redo，符合“先可回滚再自动化”的目标；但 npm peer 仍是旧的 `@mariozechner/pi-coding-agent@^0.70.5`，与当前 `@earendil-works/pi-coding-agent@0.84.x` scope 不匹配。应先 fork/patch peer、用本地临时包跑 smoke test，再决定是否纳入。

2. **`pi-simplify@0.2.3`：条件推荐。**

   作用范围窄，适合审 recent/staged/指定 diff、限制变化行并跑测试；比自动重构大包更适合作为审查层。先检查 peer 与 Pi 0.84.1 的实际加载，再项目级安装。

3. **`pi-tool-display@0.5.0`：暂缓。**

   OpenCode 风格紧凑 tool block/diff 很有价值，但当前 peer range 只声明到 Pi 0.80.x；社区还有 edit 渲染抖动和 renderer 冲突反馈。除非先修兼容性并建立一键禁用，否则不进 baseline。

4. **`@ff-labs/pi-fff@0.10.3`：实验层。**

   高速搜索可能显著改善大型仓库，但可能替换/隐藏 find/grep，且会与输入框/文件选择扩展冲突。只在单独 profile 和可显式关闭工具的环境测试。

#### B. MCP、LSP、子代理

- `pi-mcp-adapter@2.26.0`：当前 Pi scope 兼容，优先于旧 `pi-mcp-extension`；默认 lazy，一个 proxy，使用 `directTools` 只提升 5–20 个高频工具。配置应项目级、server 命令 pin、`hostConfigDiscovery` off、破坏性工具 `approveTools`。
- 已安装 `@narumitw/pi-lsp@0.49.4`：继续作为 LSP 基线；只安装项目真正需要的 language server。
- 已安装 `pi-subagents@0.45.2`：先使用 scout/reviewer；writer 子代理用 branch/worktree，并设置并发/token/时间预算。不要再并装另一个注册相同 `subagent` 工具的包。
- `pi-acp@0.0.33`：可研究 Pi ↔ ACP，把 only-my-pi 接入 Zed/OpenHands/Kimi 生态；社区采用较广但仍是 MVP，有 filesystem/terminal delegation 等能力缺口。作为适配层试用，不视为权限层。

#### C. memory/context

- 当前 `pi-memory@0.4.1` 先保留。
- `pi-observational-memory@3.0.4` 只做 A/B：V3 不读 V2 设置/记忆，社区有人报告 token 增加；不能与 `pi-memory`、`context-mode`、DCP 同时开启。
- `context-mode@1.0.169` 只进 labs：摘要/拦截 tool output 可能让模型不主动展开而漏掉关键信息。
- `pi-rtk-optimizer@0.9.0` 依赖本地 `rtk` binary；先做 raw fallback 和诊断可见性测试。

### 7.2 主题和美化：推荐“一纯主题 + 一 UI 所有者”

Pi 官方原生支持 theme-only package；主题包不必执行代码，适合先做低风险美化。当前可选：

| 包 | registry 版本 | 特点 | 建议 |
| --- | ---: | --- | --- |
| `pi-terminal-theme` | 0.2.0 | 直接使用 ANSI 0..15，跟随终端配色 | 最低侵入，优先试 |
| `@firstpick/pi-themes-bundle` | 0.1.6 | Catppuccin/Dracula/Tokyo/Nord 等 16 个纯主题 | 适合做统一主题包 |
| `@spences10/pi-themes` | 0.0.10 | 11 个纯 JSON 主题、0 deps/peers | 轻量，和上者二选一 |
| `pi-system-theme` | 0.5.0 | 跟随 macOS/Linux/Windows 明暗 | 只有确定需要自动切换时再加 |
| `pi-claude-code-tui` | npm 0.1.13 | 只接管 header/editor，保留 Pi footer | 低冲突的 UI 试用候选 |
| `pi-open-tui` | 0.2.12 | header、rounded editor、Starship footer、runtime/git/telemetry | 完整 UI 接管；与其它 footer/editor 不并装 |
| `pi-footer` | 0.5.1 | 可配置多行 footer、context/token/cost/Git/widgets | 与 `pi-open-tui`/其它 statusline 二选一 |
| `pi-studio` | 0.9.44 | 浏览器双栏 workspace/preview/REPL | 不只是美化，另立项目实验 |

主题页和包页本身也提醒：第三方包可能执行代码，仍需审源码；theme-only 只是降低了行为面，不是自动安全认证。

### 7.3 明确不建议现在加入默认层

- `pi-lens`：社区出现明确反向警告，先不装。
- 旧 scope 的 `pi-nano-context`、旧 `pi-workspace-history`：先修 peer/源码，不因名字相似就装。
- `pi-mcp-extension`：peer 仍指向旧 `@mariozechner/*`，优先 adapter。
- `pi-sub-agent`：和已装 `pi-subagents` 重叠，二选一。
- 多个 full TUI/footer/editor 接管包：功能互斥、难以定位问题。
- 带浏览器 cookie、Accessibility、Screen Recording 或自动审批的包：先放到 opt-in profile，永不默认无人值守。

## 8. DSH 社区插件：学模块，不要照单全装

官方 repo 允许用 `dsh-plugin` topic 做发现，但 GitHub topic 不是质量认证。社区 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 自己也提醒：插件可读文件、凭据、网络；tool approval 不能隔离插件代码；入榜不等于 security review。

值得把设计移植到 only-my-pi 的类别：

| DSH 社区模块类别 | 解决的问题 | only-my-pi 计划 |
| --- | --- | --- |
| MCP progressive disclosure / lazy lens | 大 MCP schema 污染上下文 | `mcp` proxy + metadata cache |
| context doctor | 统计注入 token、冲突、来源 | `context-report` 命令 |
| plugin check / manifest doctor | 发现 patch/build/版本陷阱 | 安装前 static check |
| boot guard / config rollback | 坏插件无法启动 | safe mode + last-known-good |
| native/reference memory | 在持久化记忆里保留引用与来源 | memory receipt + explicit promotion |
| file claim | 并行 agent 修改同一文件冲突 | lease/claim + conflict report |
| eval harness / verification receipt | 证明“完成”而不是只说完成 | task verifier + low-sensitivity receipt |
| sandbox providers | bwrap/Landlock/Seatbelt/micro-VM | capability seam，不把 policy 写死 |
| session search | 长会话可检索且有 bounded fallback | SQLite/FTS 或轻量索引 |
| plugin manager | 多源搜索、版本漂移、禁用/回滚 | `only-my-pi` catalog |

主题类 DSH 项目可以作为 token/preview 的灵感，但行为和主题必须解耦。

### 8.1 当前可观察的 DSH 社区项目

下面这些项目适合做“源码学习/隔离体验”候选，不是本报告的默认安装建议：

| 项目 | 主要面向 | 可以学习什么 | 为什么不进默认层 |
| --- | --- | --- | --- |
| [`dsh-web-ui`](https://github.com/zhu1090093659/dsh-web-ui) / `@linxin666/dsh-web-ui-all` | Web 看板、Git、文件/diff、Cron、远程/移动端 UI | workspace projection、只读 Git 面板、token/cost 可视化 | 聚合包面太大；SSH、Tunnel、Cron、discard、remote UI 会放大攻击面 |
| [`dsh-TUI`](https://github.com/ccch1mneyyy/dsh-TUI) | Claude Code 风格 TUI、reasoning/status/context | permission/profile/model 常驻显示、回滚和状态呈现 | UI 项目与 Pi 运行时不兼容；应提取交互模式而非直接装 |
| [`modlens`](https://github.com/liustack/modlens) | 图像理解/OCR/布局桥接 | 多模态 tool schema、结构化 JSON、跨 Harness adapter | 图片/EXIF/Provider 数据边界和单维护者风险需先审计 |
| [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | 插件索引 | 分类、发现和候选收集 | 自己明确警告：入榜不等于安全审计 |

社区还出现插件市场/搜索器、skin、memory、MCP lens、boot guard 等项目。市场和自动更新能力应后置：一旦让 Agent 自己搜索、下载、构建并启用插件，供应链边界会从“一个 npm 包”扩大成“任意代码执行平台”。

### 8.2 DSH 插件选择门禁

对 DSH 社区插件也应用和 Pi 相同的门禁：

```text
官方/作者身份确认
  → 固定 commit / tarball integrity
  → package scripts、原生依赖、网络和文件访问审计
  → profile 内临时启动
  → dump resolved config + tool list
  → read-only smoke
  → 破坏性操作单独测试
  → 记录禁用/回滚/恢复路径
```

特别是带 `cloudflared`、`ssh2`、native addon、Cron、remote API、浏览器自动化、Git discard 的 UI 聚合包，必须先在无凭据容器里构建；不能因为它只是“主题/前端”就降低审计等级。

## 9. only-my-pi 建议架构

### 9.1 目录规划

```text
only-my-pi/
├── extensions/                 # Pi runtime extensions
│   ├── session-ledger/
│   ├── context-doctor/
│   ├── verification-receipt/
│   └── safe-mode/
├── skills/                     # 可审查的 SKILL.md + 受限脚本
├── prompts/                    # 可版本化的 prompt sections/templates
├── themes/                     # 纯 JSON token/theme；不夹带行为代码
├── packages/                   # 可选：本仓库内部 package entrypoints
├── profiles/                   # baseline/ui/labs/mcp 等启用矩阵
├── policies/                   # tool/resource/network policy
├── evals/                      # smoke/eval fixtures（不放密钥和私有代码）
└── docs/
    ├── research/
    ├── decisions/
    ├── compatibility/
    └── audits/
```

### 9.2 五层配置模型

```text
baseline
  └─ Pi core + one plan + one permission + LSP + minimal review
ui
  └─ one theme + one renderer/footer owner
memory-experimental
  └─ exactly one memory/context implementation
mcp-project
  └─ project-scoped servers, directTools allowlist, secrets outside Git
labs
  └─ web, auto-approval, large bundles, new/old-scope packages
```

每层都应有：精确版本、peer/engine 记录、启用范围、权限说明、smoke command、禁用方法、回滚提交。

### 9.3 建议的自研模块顺序

**Phase 0：治理（现在）**

- package manifest/lock 记录；
- `PACKAGE-MATRIX.md` 和冲突矩阵；
- 统一 `pi -e` / project install / global install 流程；
- 安装前输出 source、integrity、peer、权限面；
- safe mode：禁用所有 third-party extensions，仅加载内置 read-only 工具。

**Phase 1：可靠性**

- session-ledger：append-only receipt，不替代 Pi 原始 session；
- context-doctor：每轮报告 prompt sections、tool schema、memory 注入和 token 预算；
- verification-receipt：测试/静态检查/真实 tool evidence 后才标记完成；
- workspace checkpoint：已在本仓库实现一个 Pi 0.84 兼容、Git-backed、dry-run-first 的独立恢复 primitive；旧 scope `pi-workspace-history` 仍不直接安装。

**Phase 2：能力 seam**

- tool policy：action/resource/subject 三元组，deny-first；
- MCP proxy：lazy metadata、directTools/include/exclude、危险工具 approval；
- subagent budget：depth/fanout/time/token/cost，worktree 默认隔离；
- ACP adapter：已先实现本仓库自己的 runtime-neutral ACP v1 核心，只做协议桥、不绕过 Pi policy；成熟第三方 `pi-acp` 仍是可选外部参考。

**Phase 3：主题和体验**

- semantic theme token（light/dark/base/contrast）；
- 主题预览和对比度检查；
- 一个可配置 footer，不直接覆盖 Pi 私有 prototype API；
- TUI 状态显示 session id、model、context、cache、tool policy、dirty state。

**Phase 4：评估和沙箱**

- disposable repo smoke suite；
- DeepSeek-specific cache/reasoning replay/compaction tests（本轮先完成离线 conformance fixtures；真实 endpoint smoke 另行授权）；
- macOS Seatbelt/Gondolin/Docker/OpenShell provider；
- network/cookie/credential boundary tests；
- 每个包的 uninstall/rollback/recovery test。

### 9.4 不 fork，但可以多 Harness 互操作

建议通过稳定的内部接口来吸收其它 Harness：

- `only-my-pi` 是 Pi package，负责资源、策略和事件；
- ACP 是跨 Harness 的 transport；
- MCP 是外部 capability 的协议，不是权限系统；
- `models.json`/provider adapter 统一模型入口；
- session ledger 和 verification receipt 是跨 CLI 的可迁移记录格式；
- theme token schema 可以编译成 Pi/Kimi/OpenCode 各自的主题文件，但每个适配器必须 versioned。

这样可以从 OpenCode、Kimi、DSH、OpenHands 学模块，又不会被任一项目的 beta 内部 API 或许可证/供应链绑定。

### 9.5 本轮三项增量落地状态

本轮没有新增第三方包，也没有把实验能力加入 Pi 的默认 `pi.extensions`
清单；只把三个可审查的 first-party seam 放入 `packages/`，并接入统一
verification suite：

| 模块 | 当前交付 | 明确未做的事 |
| --- | --- | --- |
| `deepseek-conformance` | 16 个离线测试与 5 个 JSON fixtures，覆盖 reasoning/tool-call replay、SSE 并行 tool calls、原生 `Response.body`、cache usage、Retry-After、abort、边界限制 | 不调用 DeepSeek API，不读取 API key，不宣称某个真实模型/gateway 已兼容 |
| `acp-v1` | 9 个测试；NDJSON/JSON-RPC、v1 协商、session lifecycle、update、permission callback、cancel、显式 capability matrix | 不启动 `pi --mode rpc`，不接 Pi event/tool/session，不提供 ACP v2 fallback |
| `workspace-checkpoint` | Git 目录内 snapshot、相对路径与 symlink 检查、hash manifest、dry-run restore/undo、`--run/--force/--allow-delete` 门槛 | 不做原子多文件事务、不自动 hook 每一 turn、不替代 OS sandbox 或 Git commit |

因此，报告中“本轮不执行”仍然适用于第三方包安装和真实 provider；它不再
适用于上表三个 first-party 模块的离线实现与测试。

## 10. 推荐安装决策（本轮不执行）

### 立即保留

当前已验证的 Pi 基线：plan、filtered agent extensions、web、subagents、permission-modes、LSP、usage、memory、git-sync。

### 下一轮先临时试用

```bash
pi -e npm:pi-claude-code-tui@0.1.13
pi -e npm:pi-terminal-theme@0.2.0
pi -e npm:@firstpick/pi-themes-bundle@0.1.6
pi -e npm:pi-simplify@0.2.3
pi -e npm:@ff-labs/pi-fff@0.10.3
```

实际执行前再次 `npm view`，并在 disposable repo 检查启动、工具列表、编辑、session、退出和回滚。主题包与 UI 包不要同一轮一起试，以便定位冲突。

### 条件安装

```bash
pi install -l npm:pi-mcp-adapter@2.26.0
pi install -l npm:pi-acp@0.0.33
pi install -l npm:pi-markdown-preview@0.14.0
pi install -l npm:pi-system-theme@0.5.0
```

这些命令只是研究报告中的候选，不代表本轮已经执行。MCP 必须先有真实 server 和 secret policy；ACP 必须先定义 caller/callee 的权限边界。

### 暂缓

```text
pi-workspace-history 0.2.2       # 旧 @mariozechner peer，先修/自研
pi-tool-display 0.5.0            # peer 只声明到 0.80.x，先适配
pi-observational-memory 3.0.4    # 与现有 memory 做 A/B，不能叠加
context-mode 1.0.169             # tool output 丢信息风险
pi-lens                           # 社区有明确负面警告
多个 powerline/footer/editor     # 互斥 UI ownership
自动审批/浏览器 cookie/Computer Use # 只做 opt-in + OS 隔离
```

## 11. 安全与供应链门禁

每个第三方包进入 `only-my-pi` 前必须记录：

1. owner/repository、许可证、发布来源；
2. 精确 version 或 commit、npm integrity、Node/Pi engine/peer；
3. `package.json` 的 scripts、依赖树和安装后行为；
4. 是否注册 tool/provider/command、是否覆盖 editor/footer/renderer；
5. 是否访问文件、shell、网络、浏览器 cookie、环境变量或凭据；
6. project/global 作用域和 Project Trust 要求；
7. 最小 smoke test、禁用命令、卸载是否清除配置；
8. 失败时如何进入 safe mode 和恢复 last-known-good；
9. 是否有 session/telemetry/日志会写入源代码或密钥；
10. 是否能在 Docker/Gondolin/OpenShell/Seatbelt 中运行。

必须始终记住：Pi Project Trust 只控制项目资源/包/扩展加载，不是 sandbox；Pi package security warning 也明确表示第三方包以当前用户权限运行。隔离状态必须按 surface 核验；即使 `pi-permission-modes` 对 Bash 子进程报告 `active`，也不能推导整个 session、直接 file tools、web/MCP、provider 或 extension 已隔离。真正不信任的仓库、无人值守 goal、浏览器自动化和写入凭据的工作，应放到覆盖所有相关 surface 的 OS/container/micro-VM 中，并最小化挂载路径、凭据和网络。

## 12. 研究来源索引

### 官方 Pi

- [Pi packages](https://pi.dev/docs/latest/packages)
- [Pi extensions](https://pi.dev/docs/latest/extensions)
- [Pi themes](https://pi.dev/docs/latest/themes)
- [Pi security](https://pi.dev/docs/latest/security)
- [Pi containerization](https://pi.dev/docs/latest/containerization)
- [Pi package catalog](https://pi.dev/packages)

### 官方 DeepSeek Harness

- [Repository / README](https://github.com/deepseek-ai/deepseek-harness)
- [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [Configuration catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.md)
- [Tools subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md)
- [Session subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md)
- [Web bundle](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/bundle/web-app)
- [Headless bundle](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/bundle/headless)
- [DSH plugin topic](https://github.com/topics/dsh-plugin)
- [Community plugin list](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

### 其它 Harness

- [OpenCode current repository](https://github.com/anomalyco/opencode)
- [OpenCode V2 permissions](https://opencode.ai/v2/docs/permissions)
- [OpenCode V2 plugins](https://opencode.ai/v2/docs/build/plugins)
- [Kimi Code](https://github.com/MoonshotAI/kimi-code)
- [Kimi Code plugins](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html)
- [Kimi Code agents](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html)
- [ZCode plugins](https://zcode.z.ai/en/docs/plugin)
- [ZCode hooks](https://zcode.z.ai/en/docs/hooks)
- [Zed external agents](https://zed.dev/docs/ai/external-agents)
- [OpenHands SDK architecture](https://docs.openhands.dev/sdk/arch/overview)
- [Cline SDK](https://github.com/Cline/Cline/blob/main/sdk/README.md)
- [Aider repo-map](https://aider.chat/docs/repomap.html)

### 社区样本

- [LinuxDo：Pi + DeepSeek 实战包清单与 pi-lens 警告](https://linux.do/t/topic/2321539?tl=en)
- [LinuxDo：Pi 快速上手与扩展索引](https://linux.do/t/topic/2637702?tl=en)
- [V2EX：Pi custom Provider](https://www.v2ex.com/t/1229821)
- [V2EX：Pi 自动审批扩展](https://cn.v2ex.com/t/1226191)
- [V2EX：OpenSeek / DeepSeek cache、reasoning replay、compaction、MCP、LSP](https://www.v2ex.com/t/1215048)
- [V2EX：Orca DeepSeek-native Harness 进展](https://global.v2ex.com/t/1228000)

## 13. 最终决策建议

`only-my-pi` 不应该成为“把所有社区包都安装一遍”的实验场，而应该成为一个有版本、有策略、有评估、有回滚的个人 Harness 产品：

1. 先把 DSH 的 session/event/policy/capability 抽象移植到 Pi 扩展层；
2. 先保证 evidence 和 verifier，再增加 goal、subagent、background；
3. 先做一个纯主题和一个 UI owner，再追求完整美化；
4. 先做项目级 MCP/ACP allowlist，再做跨项目 marketplace；
5. 先做本地/容器隔离，再考虑自动审批和浏览器 cookie；
6. 每次升级都以临时 profile 和真实 smoke test 为门槛，而不是跟随 npm latest。

这条路线既能吸收 DeepSeek Harness 的工程思想，也能保持 Pi 的轻量、可塑和可维护性。
