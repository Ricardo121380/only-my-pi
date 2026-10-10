# PI110-N08 / #69：MCP OAuth 验收

实施与评审基线为 `dde6d7682d854341cf540aaba35366ce9f3f8a11`，即 #68 完成 C/P/B、Standards/Spec 和 GitHub 关闭回读后的入口。批次初始 HEAD 为 `5d4ccda3c79629e6432d8b668ac435ad6f603f1c`，分支 `codex/webui-phase1`；304 个原有改动保留，不将本地提交树当作完整安装候选。

本地证据根：`LOCAL_WORKSPACE/artifacts/webui-optimization/pi110-http-oauth-1010-221428`。每个命令的完整 argv、UTC 开始/结束、退出码和日志 SHA-256 在同名 JSON；全部 RED、分组失败和自动化失败继续保留。`69-source-candidate.json` 记录 18 个实施路径的实际工作树 SHA-256，`69-browser-input.json` 记录实际 Node/Pi、原生 OAuth 入口、隔离运行副本、受控服务与扩展身份。

## 实际行为与权限

- 使用实际 Pi 1.1.0 的公共 `@earendil-works/pi-mcp/oauth`：原生 discovery、动态客户端注册、PKCE、回调 listener、令牌解析与交换。MCP OAuth 与 Provider 账号 OAuth 独立，不自动转交 Provider 身份，不在业务 HTTP 401 后自动登录或重放 POST。
- 用户先显式发起登录，再显式点击本机授权链接打开页面。公开状态只保存 flow ID、授权服务 origin、连接、目标摘要、项目、凭据引用及有限状态事件；实际授权 URL、state、code、PKCE verifier 和令牌不进入模型、页面持久状态或证据日志。回调页面清除 query，只显示固定结果。
- 每个物理 OAuth 请求前核对项目、连接、目标、引用与捕获配置版本；发布时再次执行同一 CAS。目标覆盖或冲突不会迁移旧身份。新凭据写入私有文件，删除一次性 verifier/state，再原子发布新引用并撤销旧引用。取消在发布前阻断；发布已经完成时如实返回 stored，后续撤销使用明确的凭据操作。
- 每个 OAuth 请求限制 10 秒、16 KiB 输入、64 KiB 输出，拒绝重定向；登录整体限制 120 秒，最多 8 个同时进行的操作，公开历史最多 32 个连接状态。取消先显示 cancelling，等待请求、listener 与落盘结束再返回；Host 正常停止关闭回调，启动时将未结束状态标为 interrupted，不自动重启登录。
- 显式刷新沿原绑定使用原生 refresh API，成功原子轮换引用；失败、取消或超时不能继续用未结束的旧身份。已知本地过期、错误绑定、撤销及刷新未结束在 MCP 初始化前阻断。发行方事先撤销但本机尚未知时，第一次初始化可能收到 401/403；OMP 持久记录失效，之后的请求不再发送。此过程没有业务工具执行或自动重新认证。
- OAuth 状态、运行记录和配置是不同文件，分别使用对应的写锁；配置仍保持原有全局锁与版本冲突约束。运行清理不再占用配置锁，解决真实失败任务刚结束时立即撤销凭据的 `LOCK_HELD`。发行方失效另按不可变凭据引用原子保存绑定记录，不改写配置或竞争配置锁；读取与准入同时核对该记录，Host 重启不丢失已知失效事实。
- CLI、TUI 与 WebUI 回读同一 Catalog 的可解释身份与撤销状态；本票实际登录入口为已认证 Host/WebUI。CLI/TUI 证据证明共享身份状态和后续准入，不声称独立 CLI/TUI 浏览器登录已在本票实现。
- 已发布身份与公开状态写入分开处理：后者失败回读 `stored_sync_failed`，不会报告登录失败或取消，也不作废新引用。配置 rename 后的同步失败先回读实际绑定，记录 `publication_unconfirmed` 与非秘密的 bindingConfirmed；这不同于 confirmed durable。当前 Host 在安全快照中保留未能落盘的状态，其他进程按实际凭据与配置回读身份，不能假称失败的状态文件已经持久化。

## C / P

支持矩阵中的实际运行时为 Node **24.19.0** 与 **22.19.0**，Pi coding-agent、pi-ai、pi-mcp 均为 **1.1.0**。受控 OAuth/MCP 与合成模型只在隔离 loopback 使用；实际安装扩展从已有安装复制进入夹具，不复制用户认证，不切换日常安装。

| 证据标签 | 实际结论 |
| --- | --- |
| `69-oauth-red` | FAIL：原 Host 不准入 oauthStart，保留公开入口 RED |
| `69-oauth-green-initial`、`69-oauth-green-parse` | FAIL：先修复非法默认参数，再修正跨文件发布期间的测试读取；通过公共 oauthStatus 等待持久完成，不绕过发布 |
| `69-oauth-vertical-green` | PASS 1/1：真实 Host → 原生 OAuth/PKCE → 原子身份 → 实际 Pi 审批 → 1 次同授权身份的工具接收 |
| `69-oauth-negative-red` | FAIL 2/2：目标改变后仍交换令牌、发行方失效后公开状态仍 connected；两项先复现再修复 |
| `69-ui-red` / `69-ui-green` | 初始 FAIL（已有 3 项 pass / 1 fail）；修复后 PASS 4/4，双击只产生一次 oauthStart，本机授权链接与取消可见 |
| `69-oauth-boundaries-green`、`69-oauth-boundaries-final` | 均 FAIL 12 pass / 1 fail，失败任务结束后立即撤销遭遇 LOCK_HELD；名称含 green/final 不改变实际 FAIL |
| `69-oauth-store-lock-green` | Node24 PASS 13/13，真实协议服务及身份、撤销、刷新边界 |
| `69-refresh-deadline-red` | FAIL：实际刷新请求已有限结束，但错误码泛化；保留原始约 11.6 秒回执 |
| `69-lifecycle-extra-node24` | PASS 4/4：取消后有效回调、Host 重启、8 个回调上限和 10 秒物理刷新 deadline |
| `69-cli-tui-node24` | PASS 1/1，实际 Pi CLI / node-pty TUI 回读 connected/ref 和 revoked，状态读取不发出 MCP 请求 |
| `69-supported-node22` | 最终 Node22 PASS 27/27，包含全部 17 项 OAuth、OAuth CLI/TUI、#68 HTTP 评审、HTTP CLI/TUI 和 stdio 兼容；exit 0 |
| `69-candidate-typecheck` | PASS，四个 TypeScript 范围，exit 0 |
| `69-candidate-web` | PASS 12 文件 / 96 项 |
| `69-candidate-pack`、`69-candidate-scan`、`69-candidate-lint` | PASS；原生 OAuth 模块在打包清单内，扫描 0 findings |
| `69-build-web` | PASS，保留既有 bundle-size 提示 |
| `69-review-public-red` / `69-review-public-green` | 先 FAIL 6/6、修复后 PASS 6/6；原生回调并发取消、登录/刷新各两种发布故障及实际 Pi 的注册管理令牌回显 |
| `69-review-typecheck` | FAIL：共享 runtime helper 的显式 .mjs 导入未匹配类型声明，保留原回执；后续回执另列 |
| `69-review-typecheck-green`、`69-review-web-green` | PASS，四范围 typecheck、12 文件 / 96 项 WebUI |
| `69-review-node22` | 修复后的支持矩阵 PASS 33/33：全部 23 项 OAuth 与原有 CLI/TUI、HTTP 评审、stdio 兼容；exit 0 |
| `69-review-build`、`69-review-pack`、`69-review-scan`、`69-review-lint` | PASS；打包包含共享状态 helper，扫描及 lint 0 findings |
| `69-invalidation-lock-red` / `69-invalidation-lock-green` | 先 FAIL 1/1，真实 401 到达持锁边界时变为 LOCK_HELD；修复后 PASS 1/1，当前 Host 与重启后任务均无新增 MCP 请求 |
| `69-invalidation-node22`、`69-invalidation-stdio-node22` | 分别 PASS 33/33 与 1/1；实际覆盖 24 项 OAuth、OAuth CLI/TUI、HTTP 评审、HTTP CLI/TUI 及独立 stdio 兼容 |
| `69-invalidation-typecheck`、`69-invalidation-web` | PASS，四范围 typecheck、12 文件 / 96 项 WebUI |
| `69-invalidation-pack`、`69-invalidation-scan`、`69-invalidation-lint` | PASS；1597 个打包文件，scan 与 lint 均 0 findings |

`69-invalidation-node22` 的 stdio 参数曾写成不存在的 `host-mcp-readonly.test.mjs`，Node 实际仅计入 33 项。正确的 `host-mcp-stdio.test.mjs` 通过独立回执验证 1/1；不将前者冒充包含 stdio 的 34 项单次执行。

负例均使用实际回调或受控协议服务：错误 state、错误回调 path、缺 code、错误 issuer、超时、刷新失败、刷新取消、发行方撤销、本地过期、跨项目引用、显式撤销、重复完成、取消后迟到的有效回调和 Host 重启。目标变更在令牌交换前拒绝；跨项目引用、已知过期、撤销及刷新未结束在真实 Pi MCP 请求前拒绝。重复完成只交换一次，重新登录生成不同的授权身份和私有引用。原生回调 timeout 用 200 ms 的实际 listener 验证，未使用虚拟时钟；物理刷新 10 秒边界使用生产默认值。

## B：Ego Lite TaskSpace 44

沿用 #68 的同一个 TaskSpace。实际页面依次完成保存停用配置、登录但不打开即取消、bad_state 授权页面、正常登录、启用、显式选择账号/模型、完整参数审批、批准、发行方失效、重新显式登录及再次批准。`69-browser-cancelled`、`69-browser-invalid-callback`、`69-browser-connected`、`69-browser-approval`、`69-browser-success`、`69-browser-expired`、`69-browser-relogin-connected`、`69-browser-relogin-approval`、`69-browser-relogin-success` 的 PNG 与 snapshot 保留。审批图片实际显示完整 `{"value":"browser OAuth approved input"}`。

`69-browser-runtime.json` 在夹具物理停止后回读：**4 次动态客户端注册、3 次打开授权页面、2 次有效授权码交换、2 次认证业务调用**。两次工具接收分别绑定不同的 grant，均对应页面“仅本次”批准与持久调用 completed；取消没有打开授权页或换取令牌，bad_state 没有令牌交换。发行方失效后收到 **1 次 invalid initialize**，没有 tools/call，该任务模型响应和工具开始均为 0。首次成功与重新登录成功分别有 2 次模型响应，总计 4 次合成模型请求。

持久记录为 3 个已停止任务，调用数分别 1 / 0 / 1，所有本机连接 stopped。原 Pi `mcp.json` 字节保持一致。`69-browser-readback` 以实际源码 SHA、运行副本 SHA、服务授权/令牌/请求关系及持久记录联合断言，不只依据页面文字。

自动化期间的 subtree root 格式/过期 ref、错误链接名称，以及从折叠 details 的 body.innerText 等待工具文本导致的 timeout，均属于定位或观察错误；检查实际页面后恢复，没有盲目重发业务。成功工具文本通过显式展开“公开步骤与来源”读取。接收端计数与持久记录不因自动化 timeout 被改写。

评审修复后的浏览器证据另存 `69-review-browser/`，沿同一 TaskSpace 44 重新完成取消、成功、发行方失效和显式重新登录。实际源码身份保存在 `69-review-source-candidate.json`，运行副本身份在新 `69-browser-input.json`；新服务包含真实注册管理令牌，公开材料没有其值。物理停止回读为 **3 注册 / 2 授权页 / 2 换取令牌 / 2 不同 grant 的 approved tools/call / 1 invalid initialize / 3 stopped runs / 4 合成模型请求**。`cancelled`、`approval`、`success`、`expired`、`relogin-approval`、`relogin-success` PNG/snapshot 未覆盖首轮文件；`69-review-browser-readback` 再次联查源码、运行副本、接收端与持久状态。

新 approval PNG 的当前视口未包含完整审批区，不以它替代参数证据；完整参数仍在实际页面 full_page snapshot 中，并由原始 `69-browser-approval.png`、`69-browser-approval-title.txt` 与公开审批测试支持。新 relogin-success PNG 已实际展开工具结果并核对。

配置锁失效修复后的最终源码与浏览器证据另存 `69-invalidation-source-candidate.json` 和 `69-invalidation-browser/`。同一 TaskSpace 44 再次完成取消、成功、发行方失效和显式重新登录，物理停止回读仍为 **3 注册 / 2 授权页 / 2 换取令牌 / 2 不同 grant 的 approved tools/call / 1 invalid initialize / 3 stopped runs / 4 合成模型请求**，原 Pi 配置字节保持一致。`69-invalidation-browser-readback` 联查全部 19 个源码路径及实际运行副本；另记录既有未提交 `atomic-file.mjs` 与运行副本的相同 SHA，此既有内容保持原样且不归入本批提交。最终 relogin-approval PNG 实际显示完整参数，relogin-success PNG 实际显示新身份的工具返回，均已人工查看。

最终浏览器轮次中等待错误按钮/回调文案的三个观察 timeout 原样记在 `automation-observation.txt`，恢复前均检查实际页面，未重复保存、授权或调用。认证失败任务的既有投递状态锁定了输入控件；按页面明确提供的“将保留内容作为新的草稿（不会自动发送）”恢复、替换文字后发起新任务，未重试旧请求。

## 独立完成边界

C / P / B：PASS。Standards / Spec：待固定范围的独立评审；GitHub #69 关闭与回读：待评审完成。#68 的验收与完成结论保留在 [HTTP MCP 验收](./2026-10-10-pi110-http-mcp-acceptance.md)，不与本票 OAuth 结论合并。

首轮固定 `dde6d76...d5e2325` 的独立 Standards 为 FAIL（hard 1 / smell 1），Spec 为 FAIL（2 项错误及相应负例缺口 / scope 0）。原文保存在 `69-review-first.md`。三项行为问题均先复现；管理令牌回显经过真实 Host/Pi/工具请求，取消竞态在实际原生 listener 的异步绑定检查处受控暂停，发布故障使用真实原子写的 AFTER_RENAME 注入与状态写故障接缝，后两类属于 C 故障验证，未冒充额外浏览器或第三方证据。活动状态谓词由服务端和 WebUI 共用；随后完整范围再次独立评审。

第二轮固定 `dde6d76...dff3ad0`：Standards PASS（hard 0 / 非阻断 smell 1），Spec FAIL（wrong 1 / partial 1 / scope 0，两项计数对应同一失效锁竞争及负例缺口）。结果摘记保存在 `69-review-second.md`。根代理在真实接收端暂停 initialize、实际持有配置锁后放行 401 复现，随后按引用持久化单向失效记录，避免配置锁竞争丢失事实，并共享 isMcpOAuthBlocked 消除重复判定；修复后再审完整本票范围。

带入历史全量结果为 **1626 总计 / 1616 pass / 3 fail / 1 cancelled / 6 skip，exit 1**。本批全量 Node 回归在 #69 代码与评审收敛后仅运行一次，当前尚未运行；不以局部 PASS 覆盖历史全量 FAIL。

I / 完整候选安装、L / 真实第三方 OAuth 或实际外部服务、remote CI、Full / 发布分发、U2：NOT_RUN。受控协议与浏览器证据不代实际第三方登录；#19 总规格和其他工单仍各自按其验收与依赖推进。
