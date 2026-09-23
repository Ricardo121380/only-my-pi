# M2 候选验收记录（2026-09-23）

结论：**M2 仍为 IN_PROGRESS，不晋升日常安装，不进入 M3。** 本机协作式终端已实现并通过安装态 PTY 与浏览器基本闭环；最终输入绘制性能和真实模型矩阵尚未通过。此前 `TECHNICAL_PASS` 的阶段描述已纠正。

## 候选与范围

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
| 真实 Provider / OAuth 互操作 | **NOT_RUN** | 有效 configRoot `LOCAL_HOME/.pi/agent`，无环境覆盖；GUI 账号 0，CLI 只读目录模型 0。已询问已有账号/配置路径，未读取或输出秘密 |
| 日常安装晋升 | NOT_RUN | 依赖剩余门禁和活动进程检查；真实任务预算仍为 0/3，失败重试 0/1 |

## 性能证据与限制

- 安装 Host 初始化及首次索引 **46.4 ms**，该点 RSS 205,701,120 bytes；这是进程内初始化，非完整 CLI 冷启动。证据 `perf-bb4111e/web-fixture-y3ECto/startup.json`，状态改为 MEASURED，避免夹具启动成功被误解为阶段 PASS。
- 浏览器长历史/diff 之后 Host 树 RSS 样本 122,322,944 bytes，确定性 Worker 没有子进程。另在真实终端测试中，Host 测试进程+supervisor+zsh RSS **244,449,280 bytes（约 233 MiB）**。包含测试开销，不含共享 Ego 浏览器或真实模型 worker；不将这些口径混成完整应用峰值。
- 空闲真实 PTY 从关闭请求到清理收据 **1,365 ms**，与 2.4 ms 的取消界面确认是不同指标，只有一个关闭样本，不报 P95。
- 首次双 rAF 输入样本 P95 1,816 ms；逐字等待后仍约 1,041 ms。改用首帧与 Event Timing，应用前台 30 样本首帧 P95 **973.8 ms**，JS keydown 处理多为 0.5–1.8 ms。
- 同 Ego TaskSpace 内新建空白页，只放原生 textarea、不加载 React/Glacier，等待 2.2 秒后也复现 932–967 ms 的多数首帧延迟，Event Timing 多为 960–992 ms。这排除了“只有项目长历史导致”的解释，指向浏览器绘制/节流条件，尚不能确定具体根因。
- 证据：`input-p95.json`、`input-paced-p95.json`、`input-event-timing.json`、`input-foreground.json`、`blank-input-control.json`。空白页初开十帧曾正常，故不能只用该初始样本排除随后节流。未修改产品代码来规避测量，未更换浏览器工具或放宽阈值。

## 下一步与放行条件

1. 在 Ego Lite 中确认可稳定绘制的前台条件；同条件下空白输入对照与安装态长历史/diff 页面分别收集至少 30 样本。保留 input→下一绘制与事件处理口径，P95 <100 ms 才关闭 F01；取消 DOM 确认已通过，但不能据此声称绘制性能通过。
2. 使用用户指定的已有账号/配置目录，在既有 **3 个小任务 +1 次失败重试**预算内完成真实模型矩阵。不猜测账号、不复制其他项目秘密、不创建新的收费路由。核对 GUI 账号、强度、用量、受控执行/审批、失败与续接的实际回执。
3. 补齐可复现的完整启动与真实执行进程树记录；聚合既有安装/安全/异常恢复证据，检查最终产品 diff 是否仍与 bb4111e 相符。
4. 全部必要门禁通过后，检查日常活动会话，依既有安装授权做升级、回滚与再应用验收；再将 M2 标为完成。

用户原有 `2026-09-21-glacier-interaction-audit.md` 改动保留，未纳入本轮提交。未推送、发布、升级 Pi 或修改全局配置。
