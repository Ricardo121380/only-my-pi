# PI110-N07 / #68：Streamable HTTP MCP 验收

实施基线为 `e25f701`，批次初始 HEAD 为 `5d4ccda3c79629e6432d8b668ac435ad6f603f1c`，分支 `codex/webui-phase1`。本票必需 C/P/B 已完成；Standards、Spec 和 GitHub 关闭回读另行记录，未取得前不得称本票关闭。#69 须在本票关闭回读后实施。

本地证据根：`LOCAL_WORKSPACE/artifacts/webui-optimization/pi110-http-oauth-1010-221428`。命令的完整 argv、UTC 时间、退出码、日志 SHA-256 保存在同名 `.json`；失败日志继续保留。`baseline.json`、`baseline-worktree.patch`、`baseline-index.patch` 和 `68-source-candidate.json` 记录当前工作树与实际源码身份。

## 实际行为与权限

- URL 明确固定，支持 HTTPS 及 loopback HTTP；拒绝用户名、密码、query、fragment、重定向和旧 SSE 配置。HTTP 使用真实 Pi 1.1.0 公共 `StreamableHttpTransport`，同时接受有限 JSON 与有限 SSE 响应。
- OMP 默认与项目覆盖沿用同一配置版本、任务快照及撤权机制。`MCP_TOKEN` 是项目/服务器/目标绑定的私有引用；公开状态及模型上下文不取得原值。CLI 动作文件原有的秘密值禁令保留，CLI/TUI 回读由已认证 Host 绑定的引用。
- `remote` 工具按目标、定义、输入摘要与版本授权。服务器的只读声明不代替用户决定；HTTP 不准入本机写入策略。本机 stdio 的所有权、描述符、隔离合同保留。
- 业务 POST 不自动重放。每次物理请求受 10 秒截止时间、16 KiB 输入、64 KiB 输出约束；每任务最多 32 次业务调用。断连、取消、超时或无法验证响应时记录 `unknown`。相同目标的未知效果跨重启阻断后续调用，需先独立核对。
- 本机关闭连接不证明远端执行已结束，运行记录持续说明这一限制。配置锁竞争返回有效 HTTP 409，避免将领域状态 `OWNED` 作为状态码导致 Host 异常。

## C / P

实际支持运行时为 Node **24.19.0**、**22.19.0**；Pi coding-agent、pi-ai、pi-mcp 均为 **1.1.0**。受控模型与 HTTP 服务仅使用隔离 loopback 和合成身份，不复制用户认证，不切换日常安装。

| 证据标签 / 命令 | 结论 |
| --- | --- |
| `68-http-red`：Node 24 `--test tests/host-mcp-http.test.mjs` 初始成功链路 | FAIL，原实现拒绝 HTTP 配置；保留 RED |
| `68-http-boundaries-final`：同文件，真实 Host/实际 Pi/接收端记录 | PASS 15/15，exit 0 |
| `68-http-cli-tui-node24-green`：`--test tests/mcp-http-cli-tui.test.mjs` | PASS 1/1，真实 CLI、node-pty TUI、已安装扩展副本 |
| `68-http-node22-final`：Node 22 `--test --test-concurrency=2` 两个 HTTP 测试文件 | PASS 16/16，exit 0 |
| `68-http-call-ceiling`：Node 24 `--test --test-name-pattern=ceiling tests/host-mcp-http.test.mjs` | PASS 1/1；接收端 32 次，第 33 次没有实际发出 |
| `68-stdio-compat`：Node 24 `--test tests/host-mcp-stdio.test.mjs` | PASS 1/1；原 stdio 读取与物理退出 |
| `68-typecheck-final`：`npm run typecheck` | PASS，四个 TypeScript 范围，exit 0 |
| `68-web-tests`：`npm run test:web` | PASS 12 文件 / 95 项 |
| `68-ui-final`：MCP 与 conversation-flow 两文件 | PASS 16/16，标签修改后复核 |
| `68-lint`、`68-pack`、`68-scan` | PASS；打包内容包括 HTTP transport，秘密/临时路径扫描 0 findings |
| `68-build-web-closeout`：`npm run build:web` | PASS；保留原有 bundle-size 提示 |

真实接收端分别验证：未批准/拒绝、停用、撤销凭据、定义变化、审批期间取消、错误目标、跨项目引用及过大输入均为 0 次业务执行；批准后为 1 次认证业务执行。断连/超大结果/编码秘密回显均在已接收 1 次后保留未知，重启与新任务不重放。有限 SSE 成功；取消及物理超时保留未知而非假称回滚。

首轮 `68-http-boundaries` 的 Host 状态码错误已修复，两处取消测试按公开 202 契约纠正。`68-http-new-bounds` 的初始输入用例先被 Pi schema 拒绝，随后以允许该长度的真实服务 schema 验证 OMP 限额。CLI 首轮错误为既有 `MCP_COMMAND_NOT_ADMITTED` 秘密动作文件禁令，调整夹具改走已认证 Host 引用并补早期清理；未放宽禁令。原日志及中止的夹具结果均保留。

## B：Ego Lite TaskSpace 44

`68-browser-input.json` 保存隔离项目、输入、Node/Pi/真实扩展和 MCP 实际文件身份。页面完成保存停用配置、绑定私有引用、启用、明确选择账号与模型、批准及查看真实工具输出。`68-browser-approval.png`、`68-browser-success.png` 与同名 snapshot 为页面证据。

随后接收端主动断连，页面与持久运行记录显示“结果未知，不会自动重试”，且说明 HTTP 连接关闭不证明远端状态。重启 Host 后的新任务回读 `MCP_REMOTE_RECONCILIATION_REQUIRED`；撤销凭据后又一任务在 MCP 初始化之前失败，模型响应和工具开始均为 0。对应 `68-browser-unknown`、`68-browser-restart`、`68-browser-revoked` 的 PNG/snapshot 保留。

`68-browser-runtime.json` 是物理停止后回读的持久状态与独立服务接收记录：4 个任务，业务调用总数 **2**（成功 1、接收后断连 1）；另两任务没有业务执行。原始 Pi `mcp.json` 字节保持一致。模型任务“已完成”仅表示模型回合结束，操作结果以 MCP 记录的 completed/unknown/rejected 为准。

## 独立完成边界

当前 C/P/B：PASS。Standards：PENDING；Spec：PENDING；GitHub 关闭：PENDING。

I / 完整候选安装、L / 真实外部服务：NOT_RUN。本票不替代 #69 的 OAuth 验收，不证明 Full、发布、分发、remote CI 或 U2。当前源候选含用户原有未提交改动，不能将本地提交树称为完整安装候选。

带入的历史全量结果为 **1626 总计 / 1616 pass / 3 fail / 1 cancelled / 6 skip，exit 1**。docs-links 和 mac-temp-path 本轮已修复，其他历史失败仍保留原回执。全量 Node 回归按本批约定在 #69 后运行一次，本票未以局部 PASS 替代全量结论。
