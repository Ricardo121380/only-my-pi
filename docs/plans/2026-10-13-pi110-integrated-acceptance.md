# PI110-N14 / #75 新增能力整合验收

本轮止于 [#75](https://github.com/Ricardo121380/only-my-pi/issues/75)，总规格为 [#19](https://github.com/Ricardo121380/only-my-pi/issues/19)。最终全量 exit 0，P 分段 23 项，B 原整合 13 项及同 N2 资源补验 7 项对账 PASS。Standards 独立复审 PASS，Spec 独立复审 PASS，均无剩余阻断。Spec 首轮资源 B 身份衔接不足的 PARTIAL 原件保留，随后完成同候选补验和复审。#75 已于 2026-10-13T06:10:45Z 关闭为 completed，七条 AC、验收评论与关闭状态逐次回读一致。Full 安装、真实付费服务、日常入口切换及 GP110-09 为 NOT_RUN。

## 基线、来源与授权范围

- 本轮入口 HEAD：`c8bb79873ce4bf4e58bbf0cc15cf6e249b67ed4d`，分支 `codex/webui-phase1`。入口有 301 条工作区变更，索引为空；原有改动已按文件保存副本和摘要。
- 原 #65 私有候选：`artifacts/pi110-n04-20261013/candidate-2/payloads/full`，实际快照 `2372a935c4eccf64d53fafffa72b2aa965c65a22`，stack `sha256:5f14601295303c687aa9f90a736dee3382e0e718937311777ced133d54d3a57c`。
- 本轮实际运行候选：`artifacts/pi110-n14-20261013/candidate-2/payloads/full`。默认公开 stager 的 plan/apply 重新绑定应用源码，复用 #65 已取得且再次校验摘要/SRI 的固定材料；没有重新研究或替换 Pi/Node/外部依赖。
- 候选源码快照：`c38b2a0f11255d8146a45dc1bec267a06a44342d`；1730 文件清单 SHA-256 `375d7ba51e262d0539cac03f1716450bcba616da2ac546a5867e91afe7d82e13`。这包括实际工作区的原有改动，不能以入口 HEAD 单独代称。
- stack：`sha256:ce572ca2b741e8fb5e1fe34d6ab3db459577ef8e46010050d4324a4ee263e97b`；distribution：`sha256:8ca375c0b50a64bf7a106457d975c61f3d408e2c863d5e304e807ef8f367e4f0`。
- Node 24.19.0 二进制 SHA-256：`27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1`；Pi 1.1.0 SDK SHA-256：`5482298b995db935f7b96f5d6056fa1c36ac6fc80456be594ef65b83c62b0d30`。
- Pi 树 `sha256:d2b263e16dac19b6cd4bdc70740a272a7ef9f3653442e614e2175b8cb9eaeae2`、external 树 `sha256:a0a530ff1e6259c6425e5f822a74fb81a97e8f5551a4cc64896fb260f4b5dc50` 与原 #65 候选一致。581 个发布源码文件逐文件匹配冻结快照。验收时 7 个归属文件与工作区相同；收尾只有 `package.json` 的开发 test 命令从 4 改为已验证的 2，冻结 N2 的该字段仍为 4，六个应用运行时源码文件持续逐字匹配。该测试入口差异单列，不改动 N2 或其 app/stack 身份。
- 验证器不进入发布包。各次 P 运行另外冻结其输入 SHA、原文、命令、退出码和回执；验证器修正不修改候选。后补报告也不进入运行候选。
- MCP、OAuth 和聊天/分类/图片的接收端均为隔离 loopback 合成服务；原生 SDK、QuickJS、MCP 协议、Host/worker/CLI/PTY 与项目写入均为实际候选实现。受控进程证据不能外推真实 Provider 或实际账单。

证据根为 `LOCAL_WORKSPACE/artifacts/pi110-n14-20261013`。原 #65 材料证据及授权边界见 [私有运行时验收](2026-10-13-pi110-private-runtime-acceptance.md)。

## 原始失败、定位与最小修复

原始全量保留为 **1763 PASS / 9 FAIL / 10 CANCELLED / 7 SKIP**，exit 1。`original-full-node24.log`、结果、命令和原工作进程终止记录保留；原隔离 19/19 PASS 仅是局部证据，未改写全量结论。

在未修复源码、同一 Node 字节下，9 个受影响测试文件的全部 75 用例默认并发自然结束为 65 PASS / 7 FAIL / 3 CANCELLED；限制文件并发至 4 后为 74 PASS / 1 FAIL / 0 CANCELLED。进程采样观测到最多 19 个后代及约 2.9 GiB RSS，栈采样显示多个夹具同时执行文件复制/元数据扫描。等待审批与服务回执的超时随限流消失；没有修改原有断言或超时，也不把采样当成操作系统硬上限或所有失败的唯一因果证明。

剩余失败暴露公开会话列表在异步重扫时被清空的窗口。新增 HTTP 回归在真实 `readdir` 尚未完成时读取列表，分别覆盖成功与失败重扫：旧代码 2 FAIL，原子发布完整索引后 2 PASS；失败重扫保留上一完整索引及会话原字节。本轮初版 `npm test` 把文件并发设为 4；后续全量发现该容量仍会触发冷启动等待超时，三个最终运行同源码/Node 的对照中，并发 2 全量通过。收尾仅将开发测试入口改为 `node --test --test-concurrency=2`，与通过的实际命令等价，业务断言与原超时保持不变。

实际私有候选还暴露两个源码检查未证明的问题：Host 入口只准入旧 `phase1-pi0851` 合同；历史/图片/导出目录读取丢失已验证栈的 SDK 绑定，发布包中出现 `ERR_MODULE_NOT_FOUND`。修复保留原校验链，只明确接纳 `pi110-v1`，并将 Host 及 CLI/TUI 图片历史读取绑定候选 `pi/dist/index.js`。第一版运行候选和安装历史红测均保留；第二版的公开 Host/CLI 历史回归已通过，原文件不变。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 原始全量 | FAIL：1763/9/10/7 | `original-full-node24-*` |
| 原隔离用例 | 局部 19/19 PASS | `original-regression-isolated*` |
| 本轮默认并发复现 | FAIL：65/7/3/0，自然退出 1 | `reproduce-nine-*` |
| 文件并发 4，仅复现范围 | FAIL：74/1/0/0，自然退出 1 | `bounded-nine-*` |
| 原子索引回归 | 红 2 FAIL；修复及相关测试 9/9 PASS | `session-scan-red.log`、`history-binding-focused.log` |
| SDK 绑定前全量 | 1784 PASS / 0 FAIL / 0 CANCELLED / 7 SKIP，exit 0 | `full-node24-*`，仅对应其冻结源码 |
| 最终源码全量 / 并发 4，P/B 同时运行 | FAIL：1782 PASS / 1 FAIL / 1 CANCELLED / 8 SKIP，exit 1，714.30 秒 | `full-node24-final-*`；Coding 审批等待和四夹具写入测试总超时 |
| 最终源码全量 / 并发 4，独立窗口 | FAIL：1782 PASS / 1 FAIL / 1 CANCELLED / 8 SKIP，exit 1，907.68 秒 | `full-node24-final-2-*`；MCP 初次审批等待与目标替换测试总超时，原日志及停滞 worker 终止记录保留 |
| 最终源码全量 / 并发 2 | PASS：1784 PASS / 0 FAIL / 0 CANCELLED / 8 SKIP，1792 项，exit 0，783.25 秒，自然结束 | `full-node24-final-3-*`；与前两轮源码清单、Node 摘要相同 |
| 同候选安装历史 | 第一版红；第二版 1/1 PASS，exit 0 | `installed-history-red.log`、`installed-history-green.log` |
| Node 22.19.0 历史/生命周期 | 9/9 PASS，exit 0 | `node22-final-focused.log` |
| Node 22.19.0 原账号/权限/保温 | 6/6 PASS，exit 0 | `node22-accounts-warming.log` |
| 类型检查 | 四组 tsc PASS，exit 0 | `typecheck-final.log` |
| WebUI 组件 | 17 文件 / 108 用例 PASS，exit 0 | `test-web.log`；不能代称 B |

第二轮失败夹具的持久任务为 `starting`、审批与 messages 为空、无 sessionId，MCP discovery 到任务创建约 9.5 秒后才 ready，独立服务只记录启动而无 tools/call。名义审批轮询预算为 7.5 秒，原生 worker 的启动 get_state 可等 30 秒。此项尚未进入 Pi kill / 禁用 MCP / Host replacement 的预定故障步骤。另一取消测试完成文件内后续结果后，测试进程无子进程但日志停滞 282 秒；核对 PID、父进程与测试文件后仅 SIGTERM 该 worker，获得并保留全量 exit 1。

失败子夹具在 IPC 交付前退出，父测试尚未取得其清理身份，留下一个受控 orphan 服务。该服务的实际进程 identity 与原 runs.json 一致；本轮先保存任务、run、进程与终止证据，再仅终止确切自有服务，未清空 unknown、owner 或历史。`full-node24-final-2-orphan-teardown.json` 与 `full-node24-final-2-worker-termination.json` 留存这一限制。不能把清理夹具写成产品的显式恢复。

复制、串行摘要和 SDK/扩展加载是已确认的启动成本接点；并发 4 的既有采样仍有 7 个 Node 进程、约 1.33 GiB RSS 和合计 308% CPU。这些观察支持调整测试文件容量，不能证明所有超时的唯一因果，也不把测试文件并发当成产品工具/模型并发。产品并发、撤权和故障由下面真实原生旅程独立验证。

## 同候选 C/P/B 对账

P 的必需覆盖为 **23 个不同检查，分段通过**：`acceptance-p-9/receipt.json` 前 20 项 PASS，该命令随后在第 21 项遇到 `MCP_PROCESS_RECONCILIATION_REQUIRED` 而 exit 1；`acceptance-p-11/receipt.json` 的三个实际故障检查全部 PASS、命令 exit 0。二者均使用冻结候选 N2；不称为一次 23/23 exit 0 的运行。P-9 验证器 SHA 为 `8a62bb4f314b1dd14c5e9d7043f3f7bcfbdd77c44b8a7dc4d233df91a27f9409`，P-11 为 `e3aea94bcc19673cf0c5e7382a11de854e7afdde78662a8b305e11d12356fdbb`，每轮保留命令、输入原件及 readback。

实际完整链路为：同一原生脚本串联普通 read、stdio、HTTP、OAuth、分类与图片；逐调用授权前接收次数为零，父脚本与四个工具子调用及两条模型请求可对应；用量为受控回执的 input 12 / output 3，费用保留 null，不称真实账单。

恢复历史与 CLI 图片读取不重新生成图片。PNG SHA-256 为 `e61ccede3be4b0179bfbfdf678991b58e81103a49f2c7ed7887f779450cd95d9`，253 bytes、64×64；图片来源绑定 task/session/account/model/parent/request/input digest。正常导出显式同意、目标核对、终端单写冲突和重复 commit 保持同 inode。

导出存储故障在实际 worker 身份持久化后使隔离导出账本目录不可写，并恢复原权限。文件实际发布而完成回执不能持久化时，公开结果为 unknown，磁盘记录保留 dispatched。随后实际 SIGKILL Host；再次 commit/prepare 被拒绝，旧所有者阻断新终端。显式 reconcile 核对实际字节与目录同步，保持 inode 和接收次数不变，确认后释放所有者。

有效同身份续接会追加新工作；测试核对原有字节前缀全部保留。显式指定条目分支则要求源文件全字节不变，并核对新身份、恢复 codemode-store、重新取得普通工具许可及空的新模型预算账本。不把正常追加等同于静默改写旧条目。

P 的其余对账如下，序号对应两份实际 receipt：

| 检查 | 实际结果与独立核对 |
| --- | --- |
| P-9 / 1–7：公开身份、完整链、历史/导出与 store | 原生 Host CLI 身份绑定；六个独立子许可；重启、图片 CLI history/download、正常与未知导出；有效续接保留完整旧字节前缀，显式条目分支源字节不变且重新授权；native edited context 与 future reader 拒绝不改原字节。该历史用量种子是明确的 syntheticUsageEntry，经原生 reader 验证，不冒称实际 Provider 历史账单。 |
| P-9 / 8–9：分类和图片并发 | 两个实际父/子调用竞争同一请求/并发预占，各类只新增一次服务接收，超额零发送。 |
| P-9 / 10–11：CLI 热配置和撤权 | 当前待审批任务保持 A 账号快照，CLI 保存 B 后下一任务才使用 B，实际接收身份逐项对应；撤销后迟到审批 HTTP 409，取消后零新模型请求。 |
| P-9 / 12–13：实际 CLI PTY | fullscreen / regular 都通过真实键盘普通 read 审批、132×42 resize、正常退出与 stty 恢复；缓存保温不产生额外请求。 |
| P-9 / 14–16：写入与发送前变化 | Coding、ordinary write 与 MCP descriptor 分别授权，FD 3 实际写入，启动副作用被 kernel 拒绝；终端与 Agent 使用同一 writer；真实目标变化及 tools/list_changed 使旧批准失效，写服务启动/业务接收为零。 |
| P-9 / 17–20：OAuth、HTTP、图片 unknown/cancel | OAuth 取消零 token exchange，撤销不恢复身份/不发送聊天；实际 HTTP socket loss 接收一次后 unknown、重启及后续尝试不重放；图片 socket loss/已发送取消保留同 requestId 和 reserve，重启接收数不增加。 |
| P-11 / 1：纯模型 Host kill | 在公开配置中临时停用全部 MCP，再发出实际持有中的图片请求并 SIGKILL Host；恢复后同 requestId 为 PROCESS_INTERRUPTED/unknown、并发预占保留，接收增量仍只有一次；恢复配置另留证。 |
| P-11 / 2：真实写入后服务 crash | 文件已有 `N14 descriptor bytes`，服务 call/effect 均实际发生；application=unknown、observedChange=true、verification=not_run 分列，接收一次，重启不重放。 |
| P-11 / 3：worker kill 与残留 | 服务通过已声明 F_MODE=orphan 实际保持存活；SIGKILL 原生 worker 后 RPC_TERMINATION_UNCONFIRMED、MCP reconciliation、图片 requestId/预占与 session owner 不变；真实 Host replacement 被 MCP_PROCESS_RECONCILIATION_REQUIRED 阻断，公开 CLI 只读回执及独立 receiver 后读无新增。 |

此版本没有 MCP 进程显式 reconcile 命令，因此残留旅程的正确结果是保留未知与所有权、拒绝替换；不声称它已恢复正常或由夹具清理释放产品 owner。导出的显式 reconcile 是另一已实际验证的公开合同。各轮最终仅对 identity 匹配的自有测试服务做 kernel teardown，原账本、锁和故障原件保留。

### B：Ego Lite 实际页面与文件

**13 项证据对账 PASS**，`acceptance-b-1/browser-result.json` 逐项列出证据，`verify-browser-evidence.py` exit 0。使用唯一 TaskSpace **50**、p1，OAuth popup 为 p2，实际 Host/Pi/CLI/编译页面均来自冻结 N2。B 验证器冻结在独立 `browser-harness`，SHA `771b32643c61131cbd05b8c798417997cdaa291dd65e6cca1951fb8e4184a652`，不进入发布包。

- GUI 保存/启用 MCP、OAuth 先取消后实际 popup 登录和原子存储，再保存分类与图片选择；配置与认证本身零模型/工具业务调用。六次实际页面批准后完整原生链成功，stdio/HTTP/OAuth tools/call 各 1，模型接收 2。task/session/account/model/parent/request ID 与独立 receiver 和 ledger 对应，input 12 / output 3 / cost null 的页面和原回执一致。
- U1 输入具有 inputId 与实际 Pi 消费 entry；历史图片保留原来源。浏览器实际 download、原图片和显式项目导出均为同一 253 字节 PNG/SHA。prepare 后目标不存在；实际手动 PTY 写入后占用 writer，页面导出被 OWNERSHIP_HELD 拒绝、未生成目标；确认结束终端后重新 prepare/勾选写入，发布原 PNG，接收数仍为 2。
- 实际并发脚本只新增一次接收，超额为 MODEL_BUDGET_EXHAUSTED。另一个尚未批准的真实任务从页面撤销授权并取消，没有新接收。页面离开、返回和原生审批/脚本超时保留输入、没有隐式批准或重发。
- 实际模型 socket loss：unknown/requestId/并发占额保留，reload 无重放；实际接收后取消仍 unknown、无新请求。worker kill 之前服务已配置真实 orphan 行为；SIGKILL 后页面显示执行退出未确认、账号及写锁保留、勿重发，MCP 实际 live=1、图片同 requestId 为 PROCESS_INTERRUPTED/unknown。
- 随后真实 SIGKILL Host，公开 restart 返回 MCP_PROCESS_RECONCILIATION_REQUIRED。页面显示未连接、状态待核对、审批暂停、输入保留、不自动重发。实际候选 CLI mcp/image status 都 exit 0，账本和 session owner 读回不变。

截图 `05-oauth-stored.png`、`14-model-results.png`、`36-worker-crash.png`、`39-host-disconnected.png` 均已查看；原 snapshots、真实审批原文、下载文件、每阶段独立账本及离线 CLI 命令保留。B 的最后独立 receiver 快照取于 Host kill 前（累计模型接收 6）；Host kill 后冻结 B harness 的 HTTP receipt 不可达，因此用 CLI/owner 只读证据，不虚构 kill 后 receiver 快照。P-11 另实际完成 Host recovery/block 后的独立接收核对。

B 早期两次审批停留超过原生 60 秒脚本期限，及选择器/ref/wait 参数错误分别保存，不计作完整链或及时撤权通过。B serve 进程在验证完成后经 identity 核对 SIGTERM；旧冻结 harness 的终止处理仍尝试 dead Host receipt，命令 exit 1。该 teardown 限制保留为 `serve-command.json` / stop record / run.log，13 项业务对账及离线核对的实际结果单列，不能把 B serve 命令写成 exit 0。

### 同 N2 资源 P/B 补验：首次 Spec 缺口与补充证据

首次 Spec 独立审查为 PARTIAL：GP110-05 的资源 B 仍引用旧 #71，而 N2 的 Host、codemode、RpcWorker、Tasks 和编译页面已有后续变化；六个 MCP 核心字节相同和当前 C 不能单独替代同候选的浏览器衔接。该结论保留在 `spec-review-first.md`，是验收缺口，未发现具体产品错误。

随后继续在冻结 N2、唯一 Ego Lite TaskSpace 50 / p1 补验。外置夹具 `resource-browser-probe.mjs` SHA-256 为 `2785e84af5eb6e7cb1ccd4e72fde419542c52716d0c26deddaf583a15290c51c`，使用冻结源码中的接收端夹具、实际 N2 Host CLI/SDK/worker/UI。验证输入、声明路径、loopback 身份、命令及逐阶段回执单列；应用源码与 N2 均未改动。`acceptance-b-resources-2/browser-result.json` 的 **7 项 PASS** 经 `verify-resource-browser-evidence.py` 检查，exit 0；服务命令自然 exit 0，无自有存活 stdio 进程。

1. 页面编辑器的精确 `mcp://local/readme`、`text/plain`、README.md 读路径，与实际配置、当前发现和通知页面一致；HTTP 资源为 `mcp://remote/readme`，不取得本机项目写入权限。
2. 一个真实 codemode 父调用串联 stdio 工具、HTTP 工具、stdio 资源和 HTTP 资源，四次实际 GUI 选择“仅本次”。各许可前对应业务接收均为零；最后各类接收 1，四个调用分别为 once/completed。资源列表、返回来源、定义摘要和六个子调用（含两次 list）均在页面与原生回执对应。
3. GUI 拒绝资源后，原生 run 为 rejected/MCP_CALL_DENIED，子调用 failed，实际 resources/read 总数保持 1。夹具捕获错误使父脚本成功，不将父成功替代子结果。
4. 实际 `notifications/resources/list_changed` 和工具通知引起 epoch/定义更新，页面显示变化并实际点击“重新发现 remote”；随后对旧审批选择“仅本次”，子调用返回 MCP_RESOURCE_DEFINITION_CHANGED，接收仍为 1。新任务另获新 GUI 许可后才读取新定义，接收变为 2。
5. 待审批资源从 GUI 撤销授权，随后公开迟到审批返回 409/APPROVAL_EXPIRED；run 为 rejected，接收保持 2。临时页面状态与最终子结果分别保留，不把撤销时的瞬间状态当作最终回执。
6. 实际 resources/read 被服务接收后断连，接收变为 3，原生子调用 unknown/MCP_HTTP_FAILED。已展开的 MCP 页面显示结果未知、不会自动重试；实际 reload 不增加接收，原 callId 保留。
7. 真实 Host 停止/启动并重新配对后，同 callId `5be6e54c-a1c8-4b9a-9b59-315f4ff67799` 仍 unknown。后续实际原生尝试被 MCP_RESOURCE_RECONCILIATION_REQUIRED 拒绝，资源接收保持 3；停止验证服务也未清空未知记录。

这 7 项提供同一旅程的原生 P 回执与实际 B 操作，不冒称新的一次全量回归；P 原 23 项与资源补验、B 原 13 项与资源补验分列。资源通知、拒绝、撤权、未知和恢复的跨层证据已在 N2 上重新取得，旧 #71 的细粒度切片仍保留原身份。

早期资源夹具保留一个实际 failed 任务：未登录但启用的 OAuth 使发现以 MCP_HTTP_AUTH_REQUIRED 结束，0 聊天响应、0 业务调用。随后从实际 GUI 停用该不参与资源补验的 OAuth；没有写入旧任务或自动重发输入，新输入经页面明确转为新草稿再提交。该失败及选择器/等待错误保留，不计入 7 项 PASS。原生 process 记录构造窗口内，夹具独立 receiver 读取曾返回 ERR_INVALID_ARG_TYPE；只重读只读回执，保留原错误与稳定阶段快照，没有重试业务调用。

截图 `11-resource-source-and-children.png`、`25-unknown-mcp-expanded.png`、`29-recovery-blocked.png` 已查看；完整 DOM、逐次审批前接收记录与最终 ledger 保存。资源补验服务的 exit 0 不改写原整合 B 服务的 exit 1。

### 失败验证器和产品故障的区分

所有 P-1–P-11 输入、退出码和失败保留。P-1 的发布包 SDK 绑定失败是实际产品缺口，已修复并重建 N2；其余包括导出 reference 字段、精确 owner 错误码、正常 resume 追加语义、严格配置输入字段、定义通知触发顺序、offline CLI 的 admin 前缀，以及 Host kill 时未隔离的 HTTP discovery/真实 orphan 夹具行为。修正只发生在验证器输入或控制方式，N2 不变；没有清理持久未知以凑绿。P-9 的 first20 和 P-11 的 last3 分列，P-10 的两项先通过及第三项失败也保留。

## GP110 映射与保留门禁

| 门禁 | 必需范围与证据归属 | 本轮结论 |
| --- | --- | --- |
| GP110-01 | [#62–#64 运行时/终端](2026-10-10-pi110-runtime-terminal-acceptance.md)：账号/工具、拒绝/取消、保温 | 当前 Node22 C 6/6、最终 Node24 C；N2 P 的冻结账号/撤权、双 PTY 模式及零保温请求。 |
| GP110-02 | #63 inputId/旧历史，及 [#74 历史图片](2026-10-11-pi110-image-history-acceptance.md) | 当前 C、同 N2 P 恢复/条目分支/旧字节/未来 reader、B 原生消费与历史来源；新许可和预算不从历史恢复。 |
| GP110-03 | #64 fullscreen/regular、嵌入终端 | N2 P 实际键盘/resize/退出/stty、B 实际手动终端写入与导出互斥；原 terminal C 回归。 |
| GP110-04 | #65 原材料/默认构建出口；后续 #26/#27 对账保留 | 复用并校验 #65 既有范围，不扩称 Full |
| GP110-05 | #66–#69 与 [#71 工具/资源发现](2026-10-11-pi110-mcp-discovery-acceptance.md) | 当前 C 重跑全部 MCP/资源/通知边界；N2 P/B stdio/HTTP/OAuth 与独立授权、配置、descriptor、通知/目标变化及残留整合。原 13 项 fixture 未准入资源，旧 #71 的六个 MCP 核心相同而 Host/codemode/UI 不同，关系见 `mcp-resource-slice-binding.json`。首次 Spec 因此给出 PARTIAL；随后同 N2 资源 P/B 补验 7 项通过，覆盖精确策略/发现、四次独立许可、结果来源、拒绝、定义更新、撤权、unknown/reload/Host restart 与阻断重放。旧切片身份不被改写。 |
| GP110-06 | [#70 codemode](2026-10-11-pi110-codemode-acceptance.md)：QuickJS、嵌套许可、限制、store | 当前 C 全部边界；N2 P store/resume/branch、B 原生父子许可/并发/部分错误/撤权/未知，父成功不覆盖子状态。 |
| GP110-07 | [#72 分类](2026-10-11-pi110-classification-acceptance.md)、[#73 图片](2026-10-11-pi110-images-acceptance.md)、[#74 历史/导出](2026-10-11-pi110-image-history-acceptance.md) | 当前 C 与同 N2 P/B：固定账号/模型、共享预占、reported/unknown 分列、原图历史/download/export、显式导出 unknown reconcile；真实账单 NOT_RUN。 |
| GP110-08 | #75 同候选跨入口/故障/旧行为 | C 最终全量 PASS；P 分段23项、资源原生补验7项；B13+7项已对账。Standards / Spec 独立复审各 PASS，无剩余阻断，满足本票关闭条件。 |
| GP110-09 | #57–#61、G6、同最终 Full 的安装/回滚/真实服务/日常体验 | NOT_RUN，仍独立保留 |

## 最终全量身份与条件跳过

三个最终运行的 Node binary 和 1731 个仓库文件清单 SHA 完全相同（源码清单 `77bf1d79fe607ad90318a28a41da0a6b52c67d8a54711c1204b1423e0ec7fad6`），逐轮结束后的 bytes/mode/symlink 漂移均为零。并发 2 的通过范围覆盖相同 Node test discovery，没有去掉文件、名称筛选、重写失败或放宽超时。随后仅开发 test 命令和本报告/状态元数据更新，不把它们冒称已包含在旧冻结清单。

8 项 SKIP 保留为未运行：可选 production SDK scout/writer 两项、输入 Host SIGKILL 两项、installed history 一项、installed Host/PTY 一项、installed Pi 0.85.1 图片历史 reader 一项、Pi 0.85.1 旧历史恢复一项。installed history 已另在 N2 公开 Host/CLI 实际通过；本票必需故障/单写/历史/CLI/Ego Lite 使用上文真实独立证据，不拿其他安装/晋升门禁的条件 SKIP 充数。精确名称以全量 TAP 日志为准。

## 独立审查与远端关闭

Standards 首轮 PASS；资源补验后的独立复审仍为 **PASS**，0 阻断/0 documented standard 硬违规，非阻断 heuristic 为场景字符串在验证器多个分支重复使用，Standards 复审回执为 `../../../artifacts/pi110-n14-20261013/standards-review-final.md`。Spec 首轮 **PARTIAL**，阻断为同 N2 资源 B 衔接不足，原结论与出处保留；完成上述 7 项补验后，另一轮独立复审为 **PASS**，做错/遗漏、过度实现和误解约束均无未解决阻断，Spec 复审回执为 `../../../artifacts/pi110-n14-20261013/spec-review-final.md`。两轴各自判断，没有用 Standards PASS 代替 Spec。

固定入口 HEAD 与入口工作区副本作为审查基线，只将本轮 12 路径增量归属 #75；最终审查为 `06e53f509ec911c3995aa405cea4dbe4e41e58f7...9a9ee19f61ced0b66073c33417aad57f1b02faf1`，非空三点 diff 摘要 `da7bea66a0ec469b8d6c0d239e9ee62fdce8b4c799a125f2f3c964fb1e3b94a4`。审查提交只存在于隔离证据仓库，主工作区无 commit/stage。复审后的本文与状态更新只记录审查/关闭元数据，应用运行时源码与冻结 N2 持续逐字匹配。

已发布 [#75 验收评论](https://github.com/Ricardo121380/only-my-pi/issues/75#issuecomment-6139434444)，正文与本地准备原文 SHA 一致；原七条 AC 逐项勾选并回读一致，随后关闭 #75。实际远端状态为 `closed / completed`，closed_at 为 `2026-10-13T06:10:45Z`（北京时间 14:10:45）。回读原件保存在 `issue-75-comment-readback.json`、`issue-75-body-readback.json`、`issue-75-after-close.json` 和 `closure-mutations.json`。

关闭后再次读取六条原生 blocked_by，均 closed/completed，blocked_by=0 / total_blocked_by=6。#19 与 #57 仍为 OPEN，正文均与关闭前相同；#19 正文 SHA-256 `0b854ca2e808f91413789c9508faededfc27c835dcecf01f7b29ec2e0c5ff900`。没有修改父票或后续门禁。原 301 项改动保留，主仓 HEAD 与空索引不变；本轮未 commit、push 或日常安装切换。独立审查后的最终改动仅为报告和状态收尾元数据，不要求重新运行已通过的全量。

Ego Lite TaskSpace 50 已按 Skill 收尾，finish({keep:[]}) 仅调用一次且等待成功，closedSpace=true；回执为 `ego-finish.json`。资源补验服务及最终回执中的 11 个自有 PID 均已不存在，检查记录为 `acceptance-b-resources-2/final-process-check.json`。原全量/隔离的 8 个复制证据文件与 #65 原件再次逐字摘要比对一致，记录为 `original-failure-preservation-final.json`；未知账本和 owner 原件未清理。
