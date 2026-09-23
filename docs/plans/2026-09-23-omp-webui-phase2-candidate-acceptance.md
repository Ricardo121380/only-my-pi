# M2 候选验收记录（2026-09-23）

结论：**M2 仍为 IN_PROGRESS，不晋升日常安装，不进入 M3。** 最新产品候选为 `9130d02`，已修复 CLI 静态模型凭据被遗漏的问题；完整构建、隔离安装/回滚/再应用及 12 项定向回归通过。真实 CPAR Grok 任务返回 `503 CredentialUnavailable`，成功链路受阻；输入性能仅在持续画面采集条件下达标，普通绘制异常尚未关闭。

## 最新收口结果：9130d02

- 产品源码：`9130d0259bb53a82f8af290c994dc31fbdd8e028`；栈 ID：`sha256:7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0`。Pi 0.85.1、Node 24.19.0 不变。
- 安装根：`../artifacts/webui-phase2/isolated-install-d8iuXc`；证据均位于同级 artifacts/webui-phase2。以下旧候选表格保留原始口径，不代表新候选重跑了所有旧页面场景。
- 空模型目录并非用户没有配置：旧 Host 仅检查 `auth.json` 凭据，漏掉 `models.json` 中明确的静态 Key。共享 `account-credential.mjs` 现被目录、主 RPC 和子任务入口使用；只为 CLI 显式引用增加 `models_json_key`，不新增环境变量、命令型 Key 或其他身份回退。GUI 仍须自有凭据存储。
- 定向本地模拟测试 **5 PASS**；实际配置的源码目录由 0 恢复为 9 个模型（只查目录，不调用模型）。覆盖 GUI 不借 CLI、实际请求身份、401 不换账号、配置不改写及删除静态 Key 后新 worker 拒绝启动。静态配置按 Pi 的 worker 生命周期加载，未承诺热运行 worker 即时感知外部删 Key。

| 检查 | 本轮结果 | 证据与限制 |
| --- | --- | --- |
| 新候选完整构建 | PASS | `candidate-9130d02-build.log`；首次短 SHA 参数被构建器拒绝，改为完整 SHA 后构建通过，未绕过源码绑定 |
| 安装、真实 RPC 无模型检查、回滚、再应用 | PASS | `isolated-install-d8iuXc/rehearsal.json`、`install-9130d02.log` |
| 账号、完整受控扩展集、安装 Host/PTY 联合回归 | **12 PASS / 0 FAIL / 0 SKIP** | `candidate-9130d02-acceptance.log`；账号/受控测试使用当前源码 Host + 新候选 Node/Pi/扩展，PTY 测试直接导入安装 Host；不统称所有测试都从安装包导入 |
| CPAR Grok 4.5 真实任务 | **FAIL，Provider 不可用** | 用户明确选 `cpar-grok-build`；临时 GUI 账号通过公开 API Key 存储，页面选择 low 并发起小型修改任务；Pi 回读 low 后 Provider 返回 HTTP 503、`CredentialUnavailable`、`no credential is available`。未进入审批/写入，proof.txt 仍为 `before\n` |
| 真实失败页面 | PASS，失败处理场景 | `live-cpar-9130d02/provider-unavailable.png` 已查看；显示任务失败、运行已停止、用量未知。这不证明成功执行、真实用量或受管 writer 通过 |
| 真实任务预算 | **1/3；失败重试 0/1** | `live-cpar-9130d02/report.json`；关闭自动重试，没有切换 Provider。未继续消耗相同不可用路由；余下受管写入及撤权/取消真实场景 NOT_RUN |
| 启动与进程树 | MEASURED | `cold-start-36FBe0/metrics.json`：新 Node 进程经安装 `runOmpEntrypoint` 到 Host 就绪和配对 **4,075.7 ms**，仅抑制默认浏览器打开；不是清空 OS 缓存后的冷启动，也不含首屏。真实失败任务 Host + RPC worker 的 2 秒采样峰值 **436,240,384 bytes（约 416 MiB）**，不含共享 Ego 浏览器 |
| 包体 | MEASURED | `candidate-9130d02-sizes.json`：Full 解包占用 **616,062,976 bytes**，Thin **20,865,024 bytes**，OMP 包 **80,261,120 bytes**；相对 bb4111e 的 Full/OMP 分别增加 4,096 bytes。是磁盘占用，不是压缩更新下载量；最终更新体积尚未测量 |

真实验收使用的临时凭据副本已删除并扫描确认无残留；用户原 CLI models.json 内容摘要前后一致。两个测试 Host 均已停止。未修改 CPAR 服务、日常安装或全局设置。

## 输入性能对照补充

同一 Ego Lite TaskSpace 3、同一 bb4111e 安装页面，在长历史、大输出和长 diff 打开时，以原生逐字输入到双 rAF 计时，持续 `Page.startScreencast` 并确认帧：30 样本 **P95 26.2 ms**，最大 100.7 ms。空白原生 textarea 同条件 30 样本 **P95 6.3 ms**。证据：`perf-bb4111e/input-capture-active.json`、`blank-capture-active.json`。

这是**指定绘制条件下达标**。关闭采集后此前的可见、已聚焦窗口样本仍达 **P95 1,002.1 ms**（`input-visible-window.json`）。本轮将 Ego Lite 置于 macOS 系统前台、确认窗口正常可见且页面 `visibility=visible`/`document.hasFocus()=true`，同一安装夹具无采集重测为 **P95 917.2 ms、最大 1,876.4 ms**（`perf-9130d02/input-frontmost-no-capture.json`）。因此“ChatGPT 位于系统前台”已排除，但持续 Screencast 仍会将 P95 降至 26.2ms，说明 Ego/Chromium 绘制调度或采集条件改变了节奏，尚不能归因于 React 业务代码或证明普通用户屏幕回显。没有修改产品或浏览器全局配置、没有放宽 100 ms 门槛，因此 F01 仍待确认；性能夹具已停止。

## bb4111e 历史候选与范围

- 产品源码：`bb4111ef59278105f3c28a9ccb597c4c3343a534`，分支 `codex/webui-phase1`。
- Full 栈：`sha256:2459d86c65820a7fc82e38b927e764f65d15ed92f777396907b95d6bd7279d77`；Pi 0.85.1、嵌入 Node 24.19.0、macOS arm64。
- 安装根：仓库外 `../artifacts/webui-phase2/isolated-install-s4S26k`。Ego Lite TaskSpace 3；隔离测试项目和凭据目录，未写入日常用户配置。
- `scripts/phase1-web-fixture.mjs` 增加可选安装包导入，并实际修改 3,000 行文件生成 diff。Host/UI 来自候选；模型执行使用确定性 Worker，不调用外部 Provider。这个夹具与新增测试不属于产品包。

## 验收结果

证据目录均相对于 `../artifacts/webui-phase2/`。

| 检查 | 结果 | 证据与边界 |
| --- | --- | --- |
| 完整构建、隔离安装、回滚、再应用 | PASS | `candidate-bb4111e-build.log`、`isolated-install-s4S26k/rehearsal.json` |
| 安装 Host + 真实 PTY | PASS，1 项 | `installed-host-bb4111e-metrics.log`；直接导入安装包的 Host/ownership，验证打包页面、真实文件写入、持锁与清理释放 |
| 受控 SDK 与扩展 | PASS，6 场景 | `installed-host-bb4111e.log` 前六项：approve/revoke/late/ordinary/scout/writer，真实 Pi 子进程、本地模型服务。该日志第七项曾因测试清理顺序失败；修正后单独复测通过，不能称原联合日志全通过 |
| 安装态终端页面 | PASS | `perf-bb4111e/installed-ui-terminal.json`：xterm 输入落盘、刷新同 terminalId、确认结束后释放；截图 `installed-terminal-closed.png` 已查看 |
| 安装态 Monaco 页面 | PASS，基本闭环 | `perf-bb4111e/installed-ui-editor.json`：手动模式、真实输入和保存、关闭释放锁；原组件/冲突负例见已有 2D 记录，并未在本轮逐项重跑 |
| 长历史和大输出 | PASS，浏览器定向 | 10,000 条记录按 50 条分页，第二页从第 50 条开始；5 MiB 工具输出首次读取 65,536 字符并提供继续读取；不是一次渲染全部 10,000 条 |
| 长 diff | PASS，浏览器定向 | 实际展示 174,318 字符的暂存+未暂存 diff，包含 3,000 行文件变更；`perf-bb4111e/history-output-diff.png` 已查看 |
| 窄屏用量弹窗 | PASS | 390×844；项目检查面板打开时按设计覆盖页面，关闭后“口径”打开正确用量弹窗；documentWidth=390；`mobile-inspector-open.png`、`mobile-usage.png` 已查看 |
| 取消本地确认 | PASS，30 样本 | 点击→“正在取消” aria-label DOM 更新，P95 **2.4 ms**，最大 **4.1 ms**；`perf-bb4111e/cancel-p95.json`。确定性 Worker，不是屏幕呈现或真实进程退出时间 |
| 输入绘制 P95 <100 ms | **未通过，环境待定位** | 见以下对照；不把快速 JS 处理时间冒充用户可见回显 |
| 真实 Provider / OAuth 互操作 | 当时 **NOT_RUN** | 当时 GUI 账号 0、CLI 目录 0；空目录的兼容缺陷已由 9130d02 修复。最新 CPAR 实测结果见上，不再解释为用户无配置；真实 OAuth 仍 NOT_RUN |
| 日常安装晋升 | NOT_RUN | 依赖剩余门禁和活动进程检查；最新阶段额度为 1/3、重试 0/1 |

## 性能证据与限制

- 安装 Host 初始化及首次索引 **46.4 ms**，该点 RSS 205,701,120 bytes；这是进程内初始化，非完整 CLI 冷启动。证据 `perf-bb4111e/web-fixture-y3ECto/startup.json`，状态改为 MEASURED，避免夹具启动成功被误解为阶段 PASS。
- 浏览器长历史/diff 之后 Host 树 RSS 样本 122,322,944 bytes，确定性 Worker 没有子进程。另在真实终端测试中，Host 测试进程+supervisor+zsh RSS **244,449,280 bytes（约 233 MiB）**。包含测试开销，不含共享 Ego 浏览器或真实模型 worker；不将这些口径混成完整应用峰值。
- 空闲真实 PTY 从关闭请求到清理收据 **1,365 ms**，与 2.4 ms 的取消界面确认是不同指标，只有一个关闭样本，不报 P95。
- 首次双 rAF 输入样本 P95 1,816 ms；逐字等待后仍约 1,041 ms。改用首帧与 Event Timing，应用前台 30 样本首帧 P95 **973.8 ms**，JS keydown 处理多为 0.5–1.8 ms。
- 同 Ego TaskSpace 内新建空白页，只放原生 textarea、不加载 React/Glacier，等待 2.2 秒后也复现 932–967 ms 的多数首帧延迟，Event Timing 多为 960–992 ms。这排除了“只有项目长历史导致”的解释，指向浏览器绘制/节流条件，尚不能确定具体根因。
- 证据：`input-p95.json`、`input-paced-p95.json`、`input-event-timing.json`、`input-foreground.json`、`blank-input-control.json`。空白页初开十帧曾正常，故不能只用该初始样本排除随后节流。未修改产品代码来规避测量，未更换浏览器工具或放宽阈值。

## 下一步与放行条件

1. 输入/空白对照已在持续采集条件下各收集 30 样本；继续确认普通前台绘制条件，避免把改变浏览器调度后的达标当作无条件 PASS。取消 DOM 确认已通过，不能据此声称绘制性能通过。
2. 用户选定的 CPAR Grok 路由恢复可用凭据后，在剩余 **2 个小任务 +1 次失败重试**内完成原小型修改重试、受管写入、撤权/取消。当前不自动换 Provider，不把模拟回执充作真实结果；重新运行脚本前必须继承已消耗的阶段额度。
3. 启动及真实 worker 树记录已补齐；尚需完整应用资源口径与最终更新下载量。聚合既有安装/安全/异常恢复证据，最终产品源码现为 9130d02。
4. 全部必要门禁通过后，检查日常活动会话，依既有安装授权做升级、回滚与再应用验收；再将 M2 标为完成。

用户原有 `2026-09-21-glacier-interaction-audit.md` 改动保留，未纳入本轮提交。未推送、发布、升级 Pi 或修改全局配置。
