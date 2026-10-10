# PI110-N05 / #66：受控 stdio MCP 本地验收

规格：[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)；任务：[GitHub #66](https://github.com/Ricardo121380/only-my-pi/issues/66)。前置 #62 已关闭，当前实际 Pi/ai/mcp 均为 1.1.0。此票只交付 stdio 的配置与受控只读；写入仍明确拒绝，交给 #67。

## 源码、工作树与证据身份

起点 `f411c29a2d9fa438c442344f6b9f0cd5248a9690`，分支 `codex/webui-phase1`。任务开始索引为空，已有 304 个修改/未跟踪文件已逐一记录 hash。300 个原有文件字节未动；4 个重叠文件只加入任务差量，其原始字节保存在 before 中。代码提交只包含本票差量，未将既有 1.1.0 适配、文档或材料候选改动混入。

绝对证据目录（本机保留，不冒充 GitHub 可下载包）：

```text
LOCAL_WORKSPACE/artifacts/webui-optimization/pi110-66-67-1010-mW7m1w
```

`initial-worktree.json`、`initial-diff.patch`、`66-owned.patch`、`66-preservation.json` 与 `66-source-identity.json` 绑定实际工作树，而非仅 HEAD。源码实验以真实 Pi SDK、原生 McpClient 和安装扩展副本运行；临时合成账号只访问回环模型服务，MCP 是真实 JSON-RPC stdio 服务。未读取或迁移用户 Provider 凭据，未切换日常安装。

Node 24.19.0 与 Node 22.19.0 均用实际官方支持矩阵路径运行；运行时文件 hash、Pi SDK、MCP 服务及 OMP 扩展身份在 `66-browser-input.json`。Node 24 是 `.../7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0/node/bin/node`；Node 22 是本项目 `artifacts/only-my-pi-artifacts/multichannel-2026-09-12/node22/node-v22.19.0-darwin-arm64/bin/node`。npm 文案/UI 门禁使用当前开发环境；类型检查并不替代上述实际运行。

## C：合同与本地机制

- OMP 自有 `only-my-pi/mcp/config.json`；protocol 1、CAS revision、默认与项目覆盖、origin 和 targetDigest。CLI `omp admin mcp list|status|preview|apply --project ...`、TUI `/mcp`、WebUI `/api/mcp` 共享接口。配置入口均不连接/执行服务器；导入保留原 Pi JSON 字节，所有导入项停用，同名冲突拒绝。
- command/codePaths 为绝对且可核对文件身份，cwd 限于项目内；参数、非秘密 env、credentialRefs、工具 schema、路径、次数、并发、超时与输入/输出都有上限。凭据私有引用只绑定项目/服务器目标，可显式撤销，秘密输出被拒绝。
- 任务固定配置快照，后续保存只影响新任务；独立撤权 epoch 和凭据撤销仍阻断旧任务后续调用。配置工具名称是 SDK 注册及 active ceiling 的上限，额外 MCP 名称没有许可或连接。
- 每次调用重新核对真实工具 schema、目标、代码身份、凭据与生命周期。`readOnlyHint` 只作描述。授权为拒绝/仅本次/本任务，本任务仅在当前 Agent 任务内复用。
- 发现进程无项目内容读取权；获准的读使用独立短进程，只获得该次 canonical 文件路径读取权。macOS Seatbelt 自启动即生效，配置/秘密/项目写入/网络/子进程 fork 不允许。结束先核对进程组，再释放相关持有；无法确认的孤儿保留 reconciliation 并阻断替代。

`66-final-node24.log` 16/16 PASS；安装扩展后的权限守卫跟进见 `66-green-installed-guard.log` 1/1 PASS，真实 TUI 见 `66-final-installed-tui.log` 1/1 PASS。`66-affected.log` 36/36 PASS，`66-final-web.log` 94/94 PASS。类型检查、lint、pack:check PASS，打包 1592 文件且 MCP 模块为必需项。详细命令与实际退出码见 `66-command-receipts.json`。

## P：真实 Pi 与受控协议服务

`tests/fixtures/mcp-server.mjs` 自己记录启动和 tools/call 接收，真实读取临时项目 README。获准读取接收一次并返回文件字节；未批准/拒绝/撤销/取消、schema 变化、过大或范围外输入为零接收。秘密只以 present 布尔值核对，无原值日志。项目外凭据引用在启动前失败。

实际负例包括：服务器启动偷读项目被 OS 拒绝；readOnlyHint 服务器启动及调用写入均被 OS 拒绝；fork 真正不获准且没有子进程标记；超大结果/服务崩溃收到一次后结果 UNKNOWN，无法把后验输出上限解释为服务器未执行。Pi 崩溃而服务仍在时，进程显示待核对、Host 不释放旧保留，新运行被拒绝。测试只清理其身份核实的临时孤儿，不提供自动重放/回滚或通用孤儿清理。

`66-node22-installed.log` 1/1 PASS：真实 Pi 1.1.0 + 原生 MCP + 实际安装扩展副本在 Node 22.19.0 成功。Node 24 同链路 PASS。实际 TUI 从默认拒绝用方向键选择仅本次，核对一条真实接收、真实读取结果和正常退出。

## B：Ego Lite

同一 TaskSpace 43、p1。通过实际页面完成导入预览/停用导入、保存工具范围、启用、仅本次审批、结果展开、本任务审批、页面断开、结果 UNKNOWN、未批准停止、停用与 Host 重启读回。没有 DOM 注入审批、工具返回或运行记录。

`66-browser-zero-start.json` 为零运行；`66-browser-runtime.json` 四个实际运行的 MCP 接收数依次 **1 / 1 / 1 / 0**，调用状态 **completed / completed / unknown / rejected**，所有进程组已确认停止，raw Pi 配置字节不变。模型任务结束与 MCP 成功各自展示，崩溃后的 UNKNOWN 不写成工具成功。

`66-browser-disconnect.json` 记录断开时仍待分派的已提交审批及其随后完成的一次读取。重新配对/连接不产生新许可。Host 实际停止并从同一持久化配置重启，`66-browser-host-restart.snapshot` 回读停用配置和四条历史记录；脚本中的字串检查 `runsPreserved:false` 因 snapshot 将“版本”和数字拆开，不能作为业务判断，原 snapshot 与持久 runs.json 已核对一致。

390×844 深色页面无横向溢出，焦点留在对话框，Enter 审批和 Escape 关闭通过。截图：`66-browser-config.png`、`66-browser-unknown.png`、`66-browser-dark-narrow.png`、`66-browser-host-restart.png`，已实际查看。

## 失败、全量基线与未运行边界

- 保留 RED 证据：原始发现进程启动偷读、fork 可生成子进程、崩溃 Pi 后 Host 错误释放残留，以及实际安装扩展在 MCP 审批前被通用工具守卫拒绝。分别有后续实际 GREEN。并发受控实验造成一次 TUI 启动等待不足，单独运行及明确延长启动等待后 PASS；没有删除失败日志。
- docs-links **FAIL**：开始与本票末尾均 2 项中 1 PASS / 1 FAIL，同四条既有越界 artifacts 链接。未修复这些范围外文档，也不把专项绿写成全量绿。
- secret:scan **FAIL**：既有 `2026-10-07-g2-n01-prerequisite-preflight.md:40` mac-temp-path；文件 hash 与任务开始一致。没有本票秘密泄露 finding。
- 全量 Node 测试尚未在 #66 独立收口处运行，将按 implement 工作流在本次 #66→#67 批次末尾运行并单独报告。当前不得称为全仓通过。
- I 完整安装、L 外部服务、Linux/macOS 发行候选、发布、部署和日常切换 **NOT_RUN**。MCP 运行目前只对已实测 macOS Seatbelt 放行，其他平台明确不可用，不影响旧 Linux CLI 分支。GP110-05 还包含其他 MCP 票，不因本票通过而关闭。

## Standards

待独立差量评审；评审基点为任务起点 HEAD，范围仅本票提交及其实际工作树证据。

## Spec

待独立按 #19/#66 逐项评审，审查 C/P/B、负例和上述限制。

## 完成结论

实现及 C/P/B 证据已具备；独立评审尚未完成，GitHub #66 暂不关闭，#67 尚未开始。
