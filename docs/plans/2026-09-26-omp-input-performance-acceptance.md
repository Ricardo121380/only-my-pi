# F01 普通窗口输入性能验收

结论：**9130d02 安装候选在 Ego Lite 0.5.1.13 的正常独立窗口中，通过本机输入 P95 <100ms 门槛。** 长历史、大输出和长 diff 同时打开时，30 样本输入到双 rAF 的 P95 为 **8.4ms**；同窗口空白输入框对照为 **10.9ms**，返回 OMP 后的 30 样本为 **9.1ms**。采样期间无截图、无 screencast、无设备尺寸模拟，未修改 OMP 产品代码或浏览器全局配置。

此前约 1 秒的慢样本仍保留。新诊断发现：Ego TaskSpace 的 active、页面 `visibility=visible` 和 `document.hasFocus()=true`，不足以证明该空间正在原生窗口正常展示；本轮慢样本时原生窗口仍显示其他空间。将同一验收空间通过 Ego 原生“在新窗口中打开空间”展示后，慢现象消失。**可确认测量前置条件有缺口、当前正常窗口满足门槛；没有进一步证明 Chromium 内部是哪一条节流机制，也不追溯判定所有旧慢样本同源。**

## 环境与数据

- 产品提交：`9130d0259bb53a82f8af290c994dc31fbdd8e028`，安装栈 `sha256:7444c7fb3a6a91bbe077ba2e15bd157b63265f368a480db8b81f959b43d9aea0`。
- 直接加载安装包 Host/UI；Node 24.19.0、Pi 0.85.1、macOS arm64。当前仓库提交 af950b5 只增加此前验收文档，不作为新产品候选。
- Ego Lite 0.5.1.13 / Chromium UA 152；本轮专用 TaskSpace 3/p1，与过去已不存在的空间3不是同一个空间。
- 使用既有 `scripts/phase1-web-fixture.mjs`：10,000 条历史按现有 50 条分页；5 MiB 工具输出实际打开首段 65,536 字符；实际 diff 174,318 字符、3,000 行文件变化。没有把一次渲染全部历史或全部输出作为声明。
- 正常独立窗口网页尺寸 1793×959、devicePixelRatio 1。只有合成数据和确定性 worker，真实模型请求 0，未读取模型凭据。
- 页面操作及计时全部通过 `ego-browser`；Ego 原生空间/窗口选择补用 CUA，未更换页面测试浏览器。原生普通窗口截图和 AX 由工具直接核对，页面截图保存在证据目录。

## 结果与口径

| 条件 | 样本 | 首 rAF P95 | 双 rAF P95 | Event Timing keydown P95 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 空间仅由 API 激活，原生窗口显示其他空间 | 30 | 985.9ms | 999.9ms | 1008ms | 诊断数据，不是正常窗口验收 |
| 调用应用激活与 Page.bringToFront；开始/结束前台应用不一致 | 30 | 997.8ms | 1976.6ms | 2008ms | 前置条件未满足，不放行 |
| 空间切换视图/标签激活后的 OMP | 10 | 9.7ms | 38.4ms | 96ms | 诊断数据，不代替正常窗口 |
| 空间切换视图中空白输入框 | 30 | 4.6ms | 13.2ms | 24ms | 诊断数据 |
| **正常独立窗口 OMP，长历史/输出/diff** | **30** | **1.7ms** | **8.4ms** | **24ms** | **PASS，本机门槛** |
| 正常独立窗口空白输入框 | 30 | 4.0ms | 10.9ms | 24ms | 对照通过 |
| **正常独立窗口返回 OMP，同负载** | **30** | **2.3ms** | **9.1ms** | **24ms** | **PASS，复测** |

P95 使用排序后的 `ceil(n × .95) - 1` 索引，不丢弃慢样本。所有样本均来自浏览器 keyboard API 触发的 trusted input，页面 visible、focused；这些状态是必要记录，不能单独取代原生窗口核验。每组聚焦后等待 2.2 秒，避免只采集刚切换页面时的短暂活跃帧。

计时从 input listener 到下一次/第二次 requestAnimationFrame 回调，不是物理屏幕像素呈现时间。Event Timing 只收集 duration ≥16ms 的 keydown 条目，是补充观测，不把其样本集等同所有输入。正常 OMP 首组和复测 keydown 处理 P95 分别 0.6ms、0.7ms。

页面无账号、无模型是本夹具的预期配置：输入不会发起真实任务，不能据此评价真实模型执行性能。此处只关闭 F01 输入绘制项；取消本地确认沿用此前 30 样本 P95 2.4ms 的确定性 worker 证据，本轮未重新测量。

## 复测步骤与修正

1. 以安装栈 Node 启动 `scripts/phase1-web-fixture.mjs`，通过 `OMP_TEST_STACK_PACKAGE` 指定同一安装包，创建独立 artifacts 目录；使用临时配对 URL 接入，避免输出配对令牌。
2. 在同一 Ego TaskSpace/p1 打开历史、工具输出和变更面板，等待实际 DOM 的输出/diff 字符数满足样本。
3. **先核对原生窗口。** 如果看到其他空间或空间概览，选择本次空间；必要时使用原生“在新窗口中打开空间”。这只移动同一空间，不新建替代 TaskSpace、不接管其他空间、不修改其页面。
4. 确认正常窗口显示目标 URL、完整工作台和输入框。不能仅凭 `page.info()`、`active=true`、`visibilityState`、`hasFocus()` 或一次 `Page.bringToFront` 宣称已达成。
5. 从 `ego-browser nodejs` 导入 [browser-input-benchmark.mjs](../../scripts/browser-input-benchmark.mjs)，传入 page、输入框选择器、全新输出文件路径和环境说明。采样期间不调用 screenshot/screencast；输出记录完整样本、P95、trusted/visibility/focus及页面尺寸。输出以 `wx` 创建，避免覆盖旧证据。
6. 同一普通窗口/p1依次做 OMP → 空白 textarea → OMP 对照，截图只在采样完成后保存。若窗口条件无法确认，保留诊断结果，不填 PASS。

本轮新增的仓库代码只有可复用测量脚本，其逻辑与本次三组正常窗口实测的脚本相同；语法检查通过。未对 React 做猜测性优化，也没有用持续 screencast、全局关闭节流或降低验收阈值让测试通过。

## 证据与收尾

证据目录：`LOCAL_HOME/Agentprojects/only-my-pi/artifacts/webui-phase2/perf-sep26/`。

- `input-dedicated-window.json`、`blank-dedicated-window.json`、`input-dedicated-after-control.json`：正式的三组测量。
- `input-native-window.json`、`input-frontmost.json`、`input-frontmost-os.json`、`input-activated-target.json`、`blank-selected-space.json`：未通过前置条件或处于概览视图的诊断数据。文件名里的 frontmost/native 不代表已验收，以其上下文和本报告为准。
- `browser-version.json`、`final-page-state.json`：浏览器版本、最终页面状态和实际输出/diff长度。
- `final-page.png`、`dedicated-window-loaded.png`：采样后页面；`final-page.png` 已查看。另有 CUA 原生正常窗口截图保留在本次工具记录中。
- `web-fixture-xl5xvd/startup.json`、`cleanup.json`：安装栈身份、夹具初始化和清理；Host PID72857已退出，临时配对清单已删除，专用 Ego 空间已正常结束。合成项目和证据保留。

M2 继续 IN_PROGRESS：F01 输入门槛已关闭；下一项为完整应用资源口径和最终更新下载量，writer 真实 Host/页面终态仍须补证。真实任务预算保持 3/3、失败重试5/5，不因本轮离线检查重置。日常安装尚未晋升，不进入 M3。
