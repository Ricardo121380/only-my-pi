# PI110-N10 / #71：受控 MCP 工具与资源发现验收

规格：[总规格 #19](https://github.com/Ricardo121380/only-my-pi/issues/19)，US-096–100、103，GP110-05/06；任务：[#71](https://github.com/Ricardo121380/only-my-pi/issues/71)。前置 #68、#70 均已 CLOSED/completed 并保存实时回读。#70 的 C/P/B、Standards/Spec 和关闭回读完成后才开始本票。分类与生图继续禁用，分别留给 #72/#73。

## 基线与实际身份

#71 基点 `c30ddb827b85f74440943d4231b17a6a413344d8`，分支 `codex/webui-phase1`。批次原始基点 `cf30fca4424799dfb05be41e106216bcb4ac0dba`，302 项既有工作树改动完整保留；301 个无关文件逐一比对 hash，TaskControl.tsx 的原有用户改动与 #70 增量分别保留。本票不再修改 TaskControl.tsx，只暂存明确属于本票的路径。

批次起点的最新全量通过基线为 `pi110-http-oauth-1010-221428/batch-final-full-node24`：1678 项、1672 PASS、0 FAIL、0 CANCELLED、6 SKIPPED。旧绿只证明批次起点，不能替代本批回归。第一次批次全量在本票实施和评审后运行，实际 FAIL；新实质修复后的最终全量 **1713 项、1707 PASS、0 FAIL、0 CANCELLED、6 SKIPPED**，命令退出 0。两轮记录分别保留。

本机证据目录：

```text
LOCAL_WORKSPACE/artifacts/webui-optimization/pi110-codemode-discovery-1011
```

真实仓库 Pi SDK / pi-mcp / pi-codemode **1.1.0**，QuickJS **quickjs-wasi 3.6.2**。受控候选复制真实 Pi 和实际安装 permission-modes 等扩展，实际 Node 24.19.0、22.19.0；只连接回环合成模型协议服务及真实受控 stdio/HTTP MCP 服务。`71-entry.json`、各轮 candidate（最新 `71-target-guard-candidate.json`）、浏览器各轮 input/runtime、命令 JSON/log 留下版本、路径、输入、源码 hash 与退出码。日常 Node 24 stack 的 Pi 仍是 **0.85.1**，本票不切换安装；上述 Node 路径不证明日常 Pi 已升级。

## C：发现、权限与内容合同

- 原生 Pi `McpClient` 完成 stdio 和 Streamable HTTP 握手、工具/资源/模板列表、资源读取及通知。工具搜索使用公开 `createToolSearchExtension()` 的原生 BM25 与 active-tool 机制，入口名为 `mcp_tool_search`，只搜索 OMP 已准入 MCP 工具。真实 codemode 使用同一注册处理器，没有另建工具执行器或隐式启用服务器的目录。
- 服务器与任务启动快照绑定。当前工具定义实际发现后重新注册；direct/deferred/codemode/hidden 与 active 分别约束模型声明、脚本发现及调用。未知、隐藏、撤回工具不能靠手写名称恢复；资源发现和读取入口不继承父脚本授权。工具与资源调用分别保留稳定父子 ID、定义、目标、配置和授权回执。
- 两类实际 list_changed 通知会使定义 epoch 和旧任务许可失效，隐藏旧注册并重新发现。显式重新发现只操作当前项目内正在运行任务的已准入连接：Host 验证 Origin、认证、协议、项目/任务/服务器绑定，RPC 再核对子进程身份和 ACK。断连后只有明确发现请求可重连既有目标；没有业务请求重试。工具实际发送的 guard 在完成全部异步目标及所有权检查后再检查定义、连接及取消信号，执行连接独立通知也不能穿过该等待窗口。失败、竞态和断连投影实际状态，旧发现记录不会宣称当前可调用或可读。
- 发现最多每任务 32 次；每服务器最多 32 工具、32 资源/模板，列表合计 64 KiB，分页游标拒绝，不能借原生自动分页扩大范围。每次发现 10 秒；HTTP 通知 GET 流 60 秒、累计 64 KiB、零自动重连。调用沿用 32 次、单调用并发、10 秒、16 KiB 输入/64 KiB 输出等边界。资源读取计入同一实际调用预算。
- 资源只准入配置中精确的规范 `mcp://服务器/...` URI，拒绝 file/http、跨服务器、身份、查询和片段。URI、目标、凭据、定义、配置 epoch 与权限均重新验证。实际 MIME/声明大小不符合准入时不显示为允许资源，不请求读取审批。stdio 审批列出声明读文件，物理服务只获得这些已核对路径；资源 URI 不转换为任意主机文件权限。
- 允许 text/plain、text/markdown、application/json 与明确准入的 application/octet-stream；JSON 实际解析，文本 blob 检查规范 base64 和 UTF-8，二进制只返回 base64 文本。每返回最多 8 部分、64 KiB，逐部分验证精确 URI、MIME 和内容形状，解码后再阻断凭据。只返回带服务器/URI/定义来源的数据，不执行 HTML、MCP Apps 或图片；不产生可供任意读取的资源临时文件。
- 已知不合格内容明确 failed，部分返回仅保留已验证部分。已经派发但响应超限、断连、取消或凭据泄露拒绝的结果保留 unknown，重启后同目标/URI 后续尝试被阻断，不能自动重放。历史发现保留时戳与事件但标为历史/不可用；失联 owner 投影 stale/reconciliation，不改写历史事实。
- 真实写入竞态另行补强：定义失效会取消该定义绑定的调用信号；审批返回及服务启动前再次检查 epoch。旧审批不能在定义变化后启动持有 FD 3 的服务。Coding、项目写入所有权、文件身份和物理限制继续独立生效。
- HTTP 通知 GET 流的 EOF、超限和真实 60 秒期限会关闭失效连接、递增 epoch、取消定义绑定的在途信号并隐藏旧能力；UI 显示当前任务已断连及事件，仍允许显式重新发现。没有静默重连或业务重试。重新发现的 10 秒期限只约束发现过程，不在成功后继续撤销其连接。stdio 的 tools/call 与 resources/read 都在实际发送边界再次检查定义和权限；HTTP 在等待派发记录保存之后、实际 POST 之前再检查，执行连接单独收到定义通知也不能使用旧授权发送请求。

局部职责整理限于本票：协议发现与内容验证置于 `packages/mcp/discovery.mjs`，实际发现 UI 置于 `McpDiscoveryPanel.tsx`；原有配置、OAuth、所有权及传输职责保留，没有广域机械重构。

## P：真实 Pi 与独立服务接收

`71-stdio-notify-physical` **4/4 PASS**；`71-green-http-boundaries` **7/7 PASS**；Node 22 `71-native-node22` **11/11 PASS**。真实服务分别记录 initialize、tools/list、resources/list、resources/templates/list、tools/call、resources/read 和通知，配置保存/启用本身接收数为 0。

允许旅程验证原生搜索加载后下一次模型声明变化、真实嵌套工具/资源分别审批及来源。隐藏、手写未准入 URI、stdio 文件越界、定义变更待审批竞态、实际通知撤回与配置隐藏均核对实际接收；越界服务收到资源请求但物理读取失败，秘密文件未进入结果且字节不变。HTTP 安全 blob、返回 URI/MIME 错误、部分内容、解码凭据、超大返回、断连及已派发取消均分别核对状态与独立接收，重启不重放。

初轮失败均保留：资源配置尚未支持；Host 初始工具名单遗漏新入口；成功返回的 undefined 回执字段；未知资源回执未绑定 URI；fixture 回填了不可接受的只读元字段。修复没有放宽接收数、授权、大小或结果断言。`71-native-http-boundaries` 的 **3 PASS / 4 FAIL** 是失败轮，不能写成全绿。

`71-red-write-definition` 实际复现：旧定义审批完成后，工具调用虽被拒绝，FD 3 服务仍在启动时把临时项目文件改为 `startup effect`。修复后 `71-green-definition-node24` **12/12 PASS**，Node 22 `71-green-definition-node22` **1/1 PASS**：0 写入服务启动、0 effect、文件保持原字节、rejected/not_applied。`71-resource-metadata-node24` **1/1 PASS**：声明超大资源排除，0 审批、0 resources/read。该轮固定源码的 `71-final-native-node22` **13/13 PASS**，0 FAIL/CANCELLED/SKIPPED；Node 24 的最终全量组合见后续批次结果。

Web 最终 `71-final-web` **14 文件 99/99 PASS**，覆盖真实/历史发现投影及防重复操作；四组类型检查 `71-post-definition-typecheck` PASS，`71-final-build` PASS。`71-lint`、`71-pack` PASS，包清单 1599 文件，含发现模块。打包检查不等同完整候选安装。

首轮独立评审发现三个实质缺口，失败报告保留为 `71-standards-first.md` / `71-spec-first.md`。`71-red-review-boundaries` 真实复现二进制 base64 凭据进入公开结果，以及通知 EOF 后仍显示 ready；第三项首轮因 fixture 回执尚未创建而失败，不作为业务复现。`71-red-stdio-save-delay` 才是 stdio 的真实发送竞态 RED：资源请求接收 **1**，预期 **0**。该用例只在隔离副本的 McpRuns.save 注入 200 ms 持久化延迟和受控通知信号，Host、Pi、stdio 传输和服务均真实执行；不冒充完全无注入的日常运行。先前同步尝试遇到 ENOENT、非等待式 LOCK_HELD 导致的终止未确认，失败日志全部保留，没有按通过计入。

修复在 blob 解码之后、格式化之前阻断凭据，整次泄露返回保留 unknown，不能把原 base64 或部分内容交给脚本/模型；发现连接监听原生错误及关闭，首连期间的错误也不能被遗漏；stdio 统一实际发送前 guard。`71-green-review-boundaries-node24` **5/5 PASS**，132.63 秒：二进制凭据拒绝、EOF、64 KiB 累计超限、真实 60 秒期限、持久化期间执行连接单独通知。前三种断流均旧审批读取 0，显式重连后新审批读取 1；EOF 重连额外保持超过 10 秒仍 ready。Node 22 最终固定源码组合 `71-review-fixed-native-node22` **18/18 PASS**，260.78 秒、0 FAIL/CANCELLED/SKIPPED。

修复后 `71-review-fixed-web` **14 文件 100/100 PASS**，`71-review-fixed-types` 四组 PASS，`71-review-fixed-build`、`71-review-fixed-lint`、`71-review-fixed-pack` PASS；打包仍 1599 文件。

第二轮独立评审为 Standards PASS / Spec FAIL，完整报告保留为 `71-standards-second.md` / `71-spec-second.md`。Spec 发现 HTTP 内部等待派发保存后，执行连接单独通知仍可绕过较早的 guard。`71-red-http-post-sse-send` 在真实 Pi 的同一条 POST SSE 流中先返回资源模板列表，再发出 resources/list_changed；发现 GET 连接不变，隔离副本只在 McpRuns.save 中受控等待，实际服务读取接收 **1**，预期 **0**。HTTP 在持久化等待后、物理 POST 前重复定义/权限 guard；`71-green-http-post-sse-send-node24` **1/1 PASS**，实际读取 **0**，明确 MCP_RESOURCE_DEFINITION_CHANGED。`71-http-guard-lint`、`71-http-guard-pack` PASS，包清单仍 1599 文件。该轮 Node 22 `71-http-guard-native-node22` **19/19 PASS**，249.13 秒、0 FAIL/CANCELLED/SKIPPED；Node 24 最终全量见后续批次结果。

第三轮独立评审 `c30ddb8...fc9c731` 为 Standards PASS / Spec FAIL，报告为 `71-standards-third.md` / `71-spec-third.md`。新发现是 stdio 工具发送 guard 检查定义之后，目标/所有权检查的异步等待仍可接收执行连接单独通知。`71-red-stdio-target-guard` 真实 tools/call 接收 **1**，预期 **0**；隔离副本只在该 guard 的 selectedPath 调用前加入 200 ms 等待和真实通知信号，原文件目标验证照常运行。修复将定义、连接及取消检查放到全部异步验证之后；`71-green-stdio-target-guard-node24` **1/1 PASS**，实际工具接收 **0**，MCP_AUTHORIZATION_REVOKED。`71-target-guard-lint` / `71-target-guard-pack` PASS，1599 文件。最新固定实现的 Node 22 `71-target-guard-native-node22` **20/20 PASS**，258.35 秒、0 FAIL/CANCELLED/SKIPPED。

## B：Ego Lite 与源码差量

全批沿用 TaskSpace **45** / p1，没有切换浏览器工具或 profile。`71-browser-final-runtime.json` 五个实际页面任务：热变更旧审批 rejected（HTTP 读取 0）、新定义重新审批 completed（HTTP 读取 1）、hidden（业务接收 0、审批 0）、允许组合（stdio 工具/资源各 1、HTTP 工具/资源各 1，四次独立审批）、资源拒绝（HTTP 读取 0）。父脚本捕获子错误并成功时，子调用仍分别 rejected/failed，不以父状态冒充子调用成功。

页面实际“重新发现 remote”完成 Host→RPC→原生 MCP；工具/资源通知、变化版本、发现时间、当前连接与 URI/MIME/大小可见。`71-browser-hot-discovery.png` 已查看。写入失效修复后的同一页面差量 `71-browser-epoch-runtime.json` 再次确认旧资源审批被拒绝、业务接收 0，`71-browser-epoch-state.png` 已查看。最终 `71-browser-display-*` 读取 1 次；停止后的工具与资源均标为历史、当前不可用，重新发现按钮停用，390 CSS 像素根宽度/滚动宽度均为 390，`71-browser-display-mobile.png` 已查看。

初轮 `71-browser-verified-*` 也保留：实际允许组合成功；第二个任务因人工页面核验停留超过 60 秒脚本上限而超时，业务接收 0。浏览器选择器、snapshot ref 和等待参数失败记录留在工具历史；没有覆写这些输入或将其记作热更新通过。修正 fixture 对模型请求文本块的读取后完成上述五个最终旅程。实际截图和独立服务账本相互核对。

评审修复的 B 差量为 `71-browser-channel-*`，仍是 TaskSpace 45 / p1、真实 Pi 1.1.0 / Node 24.19.0 和未注入持久化延迟的源码候选。待审批时由真实 HTTP 服务结束通知流，页面显示连接断开、变化版本 1、disconnected 事件、旧工具/资源当前不可用，显式“重新发现 remote”恢复。旧子调用 rejected（读取 0）；新任务独立审批后 completed（读取 1）。共两个任务、stdio 接收 0/0、HTTP 资源读取 1、GET 连接 3（首连、用户显式重连、新任务首连）。11 个实际源码/Web 构建 hash 与该轮 `9c2faca` 候选逐一匹配。`71-browser-channel-disconnected.png` / `71-browser-channel-fresh.png` 已查看，审批 DOM、实际任务、独立服务接收及停止收据均保留。

HTTP 发送 guard 修复轮的 B 差量 `71-browser-http-guard-*`：同一 TaskSpace 45 / p1 两个真实页面任务，允许子调用 completed、HTTP 读取 1，拒绝子调用 rejected/MCP_CALL_DENIED、读取 0；stdio 业务接收 0/0。无持久化注入，11 个实际源码/Web 构建 hash 与该轮 `fc9c731` 实现匹配，真实 Pi 1.1.0 / Node 24.19.0。`71-browser-http-guard-allow.png` 已查看；审批 DOM、拒绝旅程 snapshot、独立 HTTP 服务账本及 fixture 退出 0 均保留。执行连接 POST SSE 竞态由上述 C/P 用例证明，不扩大该浏览器旅程的证明范围。

工具目标检查修复后的 B 差量 `71-browser-target-guard-*`：仍为同一 TaskSpace 45 / p1、未注入等待的真实候选；组合任务分别批准四次，stdio 工具/资源各接收 1、HTTP 工具/资源各接收 1，四个子调用 completed。第二任务拒绝资源，子调用 rejected/MCP_CALL_DENIED、读取 0。11 个实际源码/Web 构建 hash 全部匹配当前实现，4 次审批原文、任务/嵌套状态、独立接收和 fixture 退出 0 均归档，`71-browser-target-guard-expanded.png` 已查看。

批次全量修复后的 B 差量 `71-browser-full-regression-*`：同一 TaskSpace 45 / p1、真实 Pi 1.1.0 / Node 24.19.0，无持久化或目标检查等待注入。两个页面任务分别验证四次独立一次性审批的工具/资源组合，以及资源拒绝。允许任务 stdio 工具/资源各 1、HTTP 工具/资源各 1，四个 MCP 子调用 completed；拒绝子调用 rejected/MCP_CALL_DENIED、实际资源读取 0。11 个实际源码/Web 构建 hash 全部匹配，包含修复后的 RpcWorker；批准原文、嵌套 DOM、独立接收账本、fixture 退出 0 均保留，`71-browser-full-regression-expanded.png` 已查看。前一轮 B 的源码身份继续作为历史证据保存。

## 批次全量失败与回归

第一次固定于 `132e5c4` 的 `batch-final-full-node24` **FAIL**：1713 项、1696 PASS、11 FAIL、0 CANCELLED、6 SKIPPED，测试耗时 503.91 秒、命令退出 1。11 个失败包含一个 CLI 父测试。完整失败日志/收据及 `batch-full-entry.json` 保存，结束后核对 1194 个源文件和 32 个候选输入均无漂移；301 个无关原有文件与 TaskControl 原有修改也保持。原失败不能写成通过。

三个实际原因及最小修复：公开 Pi 1.1.0 的精确工具列表断言补入 #70 的 codemode，显式指定旧四工具的 account child 仍保持原断言；RpcWorker 版本探测在 stack.root 缺失时关闭 codemode 准入，恢复既有受控 worker 生命周期；OAuth fixture 保留身份/撤销核对后，对不支持的 GET 流明确返回原生 StreamableHttpTransport 支持的 405，不放宽生产传输错误处理。没有修改或暂存原有用户改动的 host-rpc-worker.test.mjs。

六个受影响测试文件的 Node 24 `71-full-regression-native-node24` **51/51 PASS**（136.80 秒），Node 22 `71-full-regression-native-node22` **51/51 PASS**（136.61 秒），均 0 FAIL/CANCELLED/SKIPPED。它们包含完整 OAuth fixture、实际凭据回显扣留、真实 CLI/TUI、Host 崩溃恢复、无 ACK 不释放所有权及账号身份回归；保持业务接收数、认证、终端恢复、结果与无重放断言。`71-full-regression-lint` PASS（1427 文件、0 findings），`71-full-regression-pack` PASS（1599 文件）。Web/类型/构建源码未改变，沿用上述实际通过记录。最新 B 差量见上。

修复后重新冻结 `f283c68350e62a58992d511faf028f5e153cb678`、1194 个源文件、37 个候选输入及独立评审报告，执行与基线一致的实际 Node 24.19.0 `--test --test-concurrency=4`。`batch-final-full-node24-after-regression` **PASS**：1713 项、1707 PASS、0 FAIL、0 CANCELLED、6 SKIPPED，命令退出 0、479.26 秒（测试 479.04 秒）。结束后源文件/候选 hash 无漂移，301 个无关原有文件保持，TaskControl 原有修改与 #70 增量保持，索引为空；第一次失败日志原 hash 未变。六项条件跳过与基线相同（可选 scout/writer、两项安装版崩溃输入、安装版 Host PTY、日常 Pi 0.85.1 历史），不记为通过；本票必需 C/P/B 没有缺证据或以跳过替代。完整输入、命令、日志与最终核验见 `batch-full-after-regression-entry.json`、`batch-final-full-node24-after-regression.json/log`、`batch-full-after-regression-verification.json`。

## 独立评审与完成状态

首轮固定范围 `c30ddb8...d30598d`：Standards FAIL（P2 stdio 资源发送 guard 漏洞）；Spec FAIL（P1 二进制凭据、P2 通知流失效未投影）。第二轮 `c30ddb8...9c2faca`：Standards PASS / Spec FAIL（P2 HTTP 物理发送竞态）；第三轮 `c30ddb8...fc9c731`：Standards PASS / Spec FAIL（P2 stdio 工具 guard 内部异步窗口）。各项均已真实 RED → GREEN，报告和原失败证据保留。第四轮完整固定范围 `c30ddb8...132e5c4`（24 个提交路径）已由两位新的只读探子复评：**Standards PASS / Spec PASS**，完整报告 `71-standards-final.md` / `71-spec-final.md`。随后全量实际失败，引入上述五个文件的回归修复。第五轮完整固定范围 `c30ddb8...f283c68`（29 个提交路径）的两位新只读探子独立结论为 **Standards PASS / 代码 Spec PASS**，报告 `71-standards-regression.md` / `71-spec-regression.md` 明确评审时全量尚 PENDING；主代理随后完成上述修复后全量 PASS，不改写原评审报告时间语义。

最终必需 **C / P / B：PASS；Standards：PASS；Spec：PASS；批次全量：PASS**，均限定上述 macOS 真实 Pi/QuickJS 与受控 stdio/HTTP、Ego Lite 候选及实际源码身份。七项 AC 的实现和证据已核对。[完成评论](https://github.com/Ricardo121380/only-my-pi/issues/71#issuecomment-6105691567) 发布后逐字回读，再更新 DONE 与七项 AC 并回读，最后于 `2026-10-11T05:08:01Z` CLOSED/completed 并回读确认。`71-comment-readback.json`、`71-body-readback.json`、`71-close-readback.json` 分别保存三个操作的实际结果。`batch-github-final-readback.json` 确认 #70 先关闭，#19 / #72 / #73 保持 OPEN；本地实现和验收提交没有推送。

I 完整候选安装、L 外部真实 Provider、远程 CI、发行、部署、日常安装切换：NOT_RUN。#19 及 #72/#73 不因本票的本地验收关闭。
