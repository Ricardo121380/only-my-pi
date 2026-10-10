# PI110-N07 / #68：Streamable HTTP MCP 验收

实施基线为 `e25f701`，批次初始 HEAD 为 `5d4ccda3c79629e6432d8b668ac435ad6f603f1c`，分支 `codex/webui-phase1`。本票必需 C/P/B 已完成；Standards、Spec 和 GitHub 关闭回读另行记录，未取得前不得称本票关闭。#69 须在本票关闭回读后实施。

本地证据根：`LOCAL_WORKSPACE/artifacts/webui-optimization/pi110-http-oauth-1010-221428`。命令的完整 argv、UTC 时间、退出码、日志 SHA-256 保存在同名 `.json`；失败日志继续保留。`baseline.json`、`baseline-worktree.patch`、`baseline-index.patch` 和 `68-source-candidate.json` 记录当前工作树与实际源码身份。

## 实际行为与权限

- URL 明确固定，支持 HTTPS 及 loopback HTTP；拒绝用户名、密码、query、fragment、重定向和旧 SSE 配置。HTTP 使用真实 Pi 1.1.0 公共 `StreamableHttpTransport`，同时接受有限 JSON 与有限 SSE 响应。
- OMP 默认与项目覆盖沿用同一配置版本、任务快照及撤权机制。`MCP_TOKEN` 是项目/服务器/目标绑定的私有引用；公开状态及模型上下文不取得原值。CLI 动作文件原有的秘密值禁令保留，CLI/TUI 回读由已认证 Host 绑定的引用。
- `remote` 工具按项目、连接名称、凭据摘要、目标、定义、输入摘要与版本授权。服务器的只读声明不代替用户决定；HTTP 不准入本机写入策略。本机 stdio 的所有权、描述符、隔离合同保留。
- 业务 POST 不自动重放。每次物理请求受 10 秒截止时间、16 KiB 输入、64 KiB 输出约束；每任务最多 32 次业务调用。审批同时展示完整操作参数；不能在现有审批文字上限内完整展示的输入在发送前拒绝，凭据回显输入也不进入审批。已实际尝试物理请求后的断连、取消、超时或无法验证响应记录 `unknown`；确定未尝试发送的本地拒绝记录 `rejected`。相同目标的未知效果跨重启阻断后续调用，需先独立核对。
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
| `68-review-public-red`：真实 Host/Pi 接收端复现两项评审发现 | FAIL 2/2；跨连接授权与保持打开的 SSE 原始失败保留 |
| `68-review-public-green`：相同两项真实链路 | PASS 2/2；第二连接批准前接收数 0，完整 SSE 结果约 260 ms 回读 completed |
| `68-review-stream-bounds`：Node 24 新评审测试文件 | PASS 4/4；另验证流式秘密回显与 64 KiB 输出边界 |
| `68-review-node22`：Node 22 评审、CLI/TUI 与 stdio 三文件 | PASS 6/6；真实 Pi 1.1.0，SSE 约 219 ms 回读 completed |
| `68-review-typecheck`：修复后 `npm run typecheck` | PASS，exit 0 |
| `68-review-second-red`：真实公开链路复现二轮发现 | FAIL 2/2；本地拒绝被误判未知、审批缺少参数 |
| `68-review-second-green`：评审测试文件 | PASS 6/6；0 次接收的本地拒绝为 rejected，之后普通调用接收 1 次且 completed；审批显示确切参数 |
| `68-review-second-typecheck` | PASS，exit 0 |
| `68-final-node22`：三文件分组复核 | FAIL：23 项中 22 pass / 1 fail；重启后的项目回读为 PROJECT_NOT_FOUND，失败保留 |
| `68-final-node22-restart-recheck`：原失败单独复核 | PASS 1/1；单次通过不擦除分组失败 |
| `68-project-persistence-red`：修改前 8 次真实项目注册/重启 | 实际 PASS 1/1；标签虽含 red，不作为失败证据，原复现是上述分组 FAIL |
| `68-host-persistence`：Host/catalog 受影响两文件 | PASS 18/18，exit 0 |
| `68-host-persistence-typecheck` | PASS，exit 0 |
| `68-final-node22-green`：Node 22 最终三文件分组 | PASS 24/24；包含 8 次实际项目注册/重启回读及全套 HTTP/CLI/TUI |

真实接收端分别验证：未批准/拒绝、停用、撤销凭据、定义变化、审批期间取消、错误目标、跨项目引用及过大输入均为 0 次业务执行；批准后为 1 次认证业务执行。断连/超大结果/编码秘密回显均在已接收 1 次后保留未知，重启与新任务不重放。有限 SSE 成功；取消及物理超时保留未知而非假称回滚。

首轮 `68-http-boundaries` 的 Host 状态码错误已修复，两处取消测试按公开 202 契约纠正。`68-http-new-bounds` 的初始输入用例先被 Pi schema 拒绝，随后以允许该长度的真实服务 schema 验证 OMP 限额。CLI 首轮错误为既有 `MCP_COMMAND_NOT_ADMITTED` 秘密动作文件禁令，调整夹具改走已认证 Host 引用并补早期清理；未放宽禁令。原日志及中止的夹具结果均保留。

## B：Ego Lite TaskSpace 44

`68-browser-input.json` 保存隔离项目、输入、Node/Pi/真实扩展和 MCP 实际文件身份。页面完成保存停用配置、绑定私有引用、启用、明确选择账号与模型、批准及查看真实工具输出。`68-browser-approval.png`、`68-browser-success.png` 与同名 snapshot 为页面证据。

随后接收端主动断连，页面与持久运行记录显示“结果未知，不会自动重试”，且说明 HTTP 连接关闭不证明远端状态。重启 Host 后的新任务回读 `MCP_REMOTE_RECONCILIATION_REQUIRED`；撤销凭据后又一任务在 MCP 初始化之前失败，模型响应和工具开始均为 0。对应 `68-browser-unknown`、`68-browser-restart`、`68-browser-revoked` 的 PNG/snapshot 保留。

`68-browser-runtime.json` 是物理停止后回读的持久状态与独立服务接收记录：4 个任务，业务调用总数 **2**（成功 1、接收后断连 1）；另两任务没有业务执行。原始 Pi `mcp.json` 字节保持一致。模型任务“已完成”仅表示模型回合结束，操作结果以 MCP 记录的 completed/unknown/rejected 为准。

评审修复后仍使用同一 Ego Lite TaskSpace 44，另起真实 Pi/HTTP 隔离夹具，服务在发完完整 SSE 结果后保持流打开。页面显式批准一次并显示 `remote result: browser approved input`；物理停止回读 `68-review-browser-runtime.json` 为 1 次认证业务接收、调用 completed、本地连接 stopped、原 Pi 配置字节不变。源码身份保存在 `68-review-browser-input.json`，新 PNG/snapshot 使用 `68-review-browser-approval`、`68-review-browser-success` 前缀，未覆盖首轮浏览器材料。

二轮修复后的浏览器材料使用 `68-final-browser` 前缀；实际渲染的审批标题从页面 `.host-approval pre` 读取并保存到 `68-final-browser-approval-title.txt`，包含确切参数 `{"value":"browser approved input"}`。批准后页面显示真实 SSE 工具返回；物理回读为 1 次认证接收、调用 completed、原 Pi 配置字节不变。审批 PNG 当时的视口未包含参数区域，因此参数可审查性以实际页面文本和公开审批测试为证，不用该 PNG 代替参数证据。

## 独立完成边界

第一轮独立评审为 Standards FAIL（P1，跨连接身份复用授权）、Spec FAIL（P2，等待 SSE EOF 导致完整结果误判未知）；原评审保存在 `68-review-first.md`。两项均先在真实公开 Host → Pi → HTTP 服务复现再修复。授权键增加项目、连接和凭据摘要；受控流按字节限额向原生 Pi 解析器及时交付事件，秘密仍在解码消息边界阻断。第一轮失败没有被后续 PASS 覆盖，最终评审结论另行记录。

第二轮独立评审为 Standards FAIL（P2，审批只有摘要而无可审查参数）、Spec FAIL（P2，RPC 信封超限在发送前拒绝却误记 unknown）；`68-review-second.md` 与公开 RED 回执保留。修复将完整参数加入既有 Pi 审批，并保持文字上限及秘密边界；物理 HTTP 尝试由传输层在完整请求检查后记录，发送前拒绝不会触发远端核对阻断。第三轮结论另行记录。

最终 Node22 分组出现一次重启后项目不存在。静态核对发现初始索引与 addProject 可并发将不同快照写入同一 projects.json；本轮将这两个现有写入口按顺序保存并在真正写入时读取最新项目列表。该因果关系属于源码推断，单独复核和修改前 8 次重启均未稳定复现原分组失败，原 FAIL 继续保留。修复后的分组回执另行记录，未以等待索引或自动重新注册项目来掩盖失败。

当前 C/P/B：PASS。Standards：PENDING；Spec：PENDING；GitHub 关闭：PENDING。

I / 完整候选安装、L / 真实外部服务：NOT_RUN。本票不替代 #69 的 OAuth 验收，不证明 Full、发布、分发、remote CI 或 U2。当前源候选含用户原有未提交改动，不能将本地提交树称为完整安装候选。

带入的历史全量结果为 **1626 总计 / 1616 pass / 3 fail / 1 cancelled / 6 skip，exit 1**。docs-links 和 mac-temp-path 本轮已修复，其他历史失败仍保留原回执。全量 Node 回归按本批约定在 #69 后运行一次，本票未以局部 PASS 替代全量结论。
